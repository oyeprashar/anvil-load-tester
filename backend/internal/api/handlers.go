package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/shubhamprashar/anvil/internal/models"
	"github.com/shubhamprashar/anvil/internal/runner"
	"github.com/shubhamprashar/anvil/internal/transpiler"
)

type handlers struct {
	manager      *runner.Manager
	suiteManager *runner.SuiteManager
}

// ── POST /api/test/run ────────────────────────────────────────
// Accepts a TestConfig JSON body, starts the k6 run, returns the run ID.

type startRunResponse struct {
	RunID string `json:"runId"`
}

func (h *handlers) startRun(w http.ResponseWriter, r *http.Request) {
	var cfg models.TestConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}

	if cfg.BaseURL == "" {
		writeError(w, http.StatusBadRequest, "baseUrl is required")
		return
	}
	if len(cfg.Stages) == 0 {
		writeError(w, http.StatusBadRequest, "at least one stage is required")
		return
	}

	id, err := h.manager.Start(context.Background(), cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to start run: "+err.Error())
		return
	}

	writeJSON(w, http.StatusAccepted, startRunResponse{RunID: id})
}

// ── GET /api/test/{id}/stream ─────────────────────────────────
// SSE stream — sends log lines as they arrive from k6 stdout.
// The stream ends with a final "done" event carrying the run status.

func (h *handlers) streamRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	ch := h.manager.Subscribe(id)
	if ch == nil {
		writeError(w, http.StatusNotFound, "run not found: "+id)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // disable nginx buffering if present

	// Send a heartbeat every 15 s to keep the connection alive
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case line, open := <-ch:
			if !open {
				// Run finished — send a final "done" event
				run := h.manager.Get(id)
				var donePayload string
				if run != nil {
					b, _ := json.Marshal(map[string]string{
						"status": string(run.Status),
						"error":  run.Error,
					})
					donePayload = string(b)
				}
				fmt.Fprintf(w, "event: done\ndata: %s\n\n", donePayload)
				flusher.Flush()
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", line)
			flusher.Flush()

		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()

		case <-r.Context().Done():
			h.manager.Unsubscribe(id, ch)
			return
		}
	}
}

// ── GET /api/test/{id}/report ─────────────────────────────────
// Returns the completed run's metrics as JSON.

type reportResponse struct {
	ID          string                 `json:"id"`
	Status      models.RunStatus       `json:"status"`
	Metrics     *models.MetricsSummary `json:"metrics,omitempty"`
	Error       string                 `json:"error,omitempty"`
	StartedAt   string                 `json:"startedAt,omitempty"`
	CompletedAt string                 `json:"completedAt,omitempty"`
}

func (h *handlers) getReport(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run := h.manager.Get(id)
	if run == nil {
		writeError(w, http.StatusNotFound, "run not found: "+id)
		return
	}

	resp := reportResponse{
		ID:      run.ID,
		Status:  run.Status,
		Metrics: run.Metrics,
		Error:   run.Error,
	}
	if !run.StartedAt.IsZero() {
		resp.StartedAt = run.StartedAt.Format(time.RFC3339)
	}
	if !run.CompletedAt.IsZero() {
		resp.CompletedAt = run.CompletedAt.Format(time.RFC3339)
	}

	writeJSON(w, http.StatusOK, resp)
}

// ── GET /api/test/{id}/script ─────────────────────────────────
// Returns the generated k6 JS script for a given config (debug helper).

func (h *handlers) getScript(w http.ResponseWriter, r *http.Request) {
	var cfg models.TestConfig
	if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
		writeError(w, http.StatusBadRequest, "invalid body: "+err.Error())
		return
	}

	// TODO : protoContent is not being used here
	script, _, err := transpiler.Generate(cfg)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	fmt.Fprint(w, script)
}

// ── GET /api/test/{id}/html-report ───────────────────────────
// Serves the k6 web dashboard HTML export for a completed run.

func (h *handlers) getHTMLReport(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run := h.manager.Get(id)
	if run == nil {
		writeError(w, http.StatusNotFound, "run not found: "+id)
		return
	}
	if run.HTMLReportPath == "" {
		writeError(w, http.StatusNotFound, "no html report for this run")
		return
	}
	// Serve the file — http.ServeFile handles ETag, Range, etc.
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, run.HTMLReportPath)
}

// ── DELETE /api/test/{id} ─────────────────────────────────────
// Cancels a running test. Returns 200 if cancelled, 404 if not found,
// 409 if the test is already finished.

func (h *handlers) abortRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	run := h.manager.Get(id)
	if run == nil {
		writeError(w, http.StatusNotFound, "run not found: "+id)
		return
	}
	if !h.manager.Cancel(id) {
		writeError(w, http.StatusConflict, "run is not in progress")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

// ── GET /api/runs ─────────────────────────────────────────────
// Returns the last N completed runs, newest first.

func (h *handlers) listHistory(w http.ResponseWriter, r *http.Request) {
	records := h.manager.ListHistory(100)
	writeJSON(w, http.StatusOK, records)
}

// ── GET /api/runs/{id} ────────────────────────────────────────
// Returns a single historical run record.

func (h *handlers) getHistoryEntry(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	rec := h.manager.GetHistoryEntry(id)
	if rec == nil {
		writeError(w, http.StatusNotFound, "run not found: "+id)
		return
	}
	writeJSON(w, http.StatusOK, rec)
}

// ── GET /health ───────────────────────────────────────────────

func (h *handlers) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ── Helpers ───────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}
