package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/shubhamprashar/anvil/internal/models"
)

// ── POST /api/suite/run ───────────────────────────────────────
// Accepts a Suite JSON body, starts the DAG execution, returns the suite run ID.

func (h *handlers) startSuiteRun(w http.ResponseWriter, r *http.Request) {
	var suite models.Suite
	if err := json.NewDecoder(r.Body).Decode(&suite); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body: "+err.Error())
		return
	}
	if suite.Name == "" {
		writeError(w, http.StatusBadRequest, "suite name is required")
		return
	}
	if len(suite.Nodes) == 0 {
		writeError(w, http.StatusBadRequest, "suite must have at least one node")
		return
	}

	id, err := h.suiteManager.StartSuite(context.Background(), suite)
	if err != nil {
		writeError(w, http.StatusBadRequest, "failed to start suite: "+err.Error())
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"suiteRunId": id})
}

// ── GET /api/suite/{id}/status ────────────────────────────────
// Returns a JSON snapshot of the suite run (node statuses + overall status).

func (h *handlers) getSuiteStatus(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	sr := h.suiteManager.GetSuiteRun(id)
	if sr == nil {
		writeError(w, http.StatusNotFound, "suite run not found: "+id)
		return
	}
	writeJSON(w, http.StatusOK, sr)
}

// ── GET /api/suite/{id}/stream ────────────────────────────────
// SSE stream — emits SuiteEvent JSON whenever a node changes state.
// A final "done" event is sent when the entire suite finishes.

func (h *handlers) streamSuiteRun(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	flusher, ok := w.(http.Flusher)
	if !ok {
		writeError(w, http.StatusInternalServerError, "streaming not supported")
		return
	}

	ch := h.suiteManager.SubscribeSuite(id)
	if ch == nil {
		writeError(w, http.StatusNotFound, "suite run not found: "+id)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no")

	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case event, open := <-ch:
			if !open {
				// Suite finished — send final status
				sr := h.suiteManager.GetSuiteRun(id)
				if sr != nil {
					b, _ := json.Marshal(models.SuiteEvent{
						Type:   "suite_done",
						Status: sr.Status,
					})
					fmt.Fprintf(w, "event: done\ndata: %s\n\n", b)
					flusher.Flush()
				}
				return
			}
			b, _ := json.Marshal(event)
			fmt.Fprintf(w, "data: %s\n\n", b)
			flusher.Flush()

		case <-ticker.C:
			fmt.Fprintf(w, ": heartbeat\n\n")
			flusher.Flush()

		case <-r.Context().Done():
			h.suiteManager.UnsubscribeSuite(id, ch)
			return
		}
	}
}
