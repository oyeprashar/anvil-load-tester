package api

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/shubhamprashar/anvil/internal/llm"
	"github.com/shubhamprashar/anvil/internal/models"
	"github.com/shubhamprashar/anvil/internal/runner"
)

type llmHandlers struct {
	summarizer llm.Summarizer  // nil when LLM is disabled
	mgr        *runner.Manager
}

// ── GET /api/llm/status ───────────────────────────────────────
// Returns whether LLM is enabled and which provider/model is active.
// The frontend uses this to decide whether to show the AI Summary tab.

func (h *llmHandlers) status(w http.ResponseWriter, _ *http.Request) {
	if h.summarizer == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"enabled": false,
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"enabled":  true,
		"provider": h.summarizer.Provider(),
		"model":    h.summarizer.Model(),
	})
}

// ── POST /api/llm/summarize/{id} ─────────────────────────────
// Looks up the completed run from history, sends metrics to the LLM,
// and returns a plain-English summary paragraph.

func (h *llmHandlers) summarize(w http.ResponseWriter, r *http.Request) {
	if h.summarizer == nil {
		writeError(w, http.StatusNotImplemented, "LLM summarization is disabled — set LLM_PROVIDER to enable it")
		return
	}

	id := r.PathValue("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, "run id is required")
		return
	}

	rec := h.mgr.GetHistoryEntry(id)
	if rec == nil {
		// Fall back to the active runs map — the run may have just completed
		// but the history commit hasn't been observed yet (unlikely after the
		// race-condition fix, but handled here for safety).
		activeRun := h.mgr.Get(id)
		if activeRun == nil {
			writeError(w, http.StatusNotFound, "run not found: "+id)
			return
		}
		completedAt := activeRun.CompletedAt
		if completedAt.IsZero() {
			completedAt = time.Now()
		}
		rec = &models.HistoryRecord{
			ID:          activeRun.ID,
			CreatedAt:   activeRun.StartedAt,
			CompletedAt: completedAt,
			Status:      activeRun.Status,
			Config:      activeRun.Config,
			Metrics:     activeRun.Metrics,
			Error:       activeRun.Error,
			DurationMs:  completedAt.Sub(activeRun.StartedAt).Milliseconds(),
		}
	}

	summary, err := h.summarizer.Summarize(r.Context(), rec)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "LLM error: "+err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"summary": summary})
}

// decodeJSON is a shared helper for decoding request bodies.
func decodeJSON(r *http.Request, v any) error {
	return json.NewDecoder(r.Body).Decode(v)
}
