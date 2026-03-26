package api

import (
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/shubhamprashar/anvil/internal/metrics"
	"github.com/shubhamprashar/anvil/internal/runner"
)

// idPattern matches long numeric path segments (nanosecond run IDs).
// Replaced with {id} to keep Prometheus label cardinality low.
var idPattern = regexp.MustCompile(`/\d{10,}`)

func normalizePath(p string) string {
	return idPattern.ReplaceAllString(p, "/{id}")
}

// statusRecorder wraps ResponseWriter to capture the HTTP status code.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

// Server wires together the HTTP mux and the run managers.
type Server struct {
	manager      *runner.Manager
	suiteManager *runner.SuiteManager
	mux          *http.ServeMux
}

func NewServer(manager *runner.Manager, suiteManager *runner.SuiteManager) *Server {
	s := &Server{
		manager:      manager,
		suiteManager: suiteManager,
		mux:          http.NewServeMux(),
	}
	s.registerRoutes()
	return s
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// CORS — allow the Vite dev server (port 5173) and any localhost origin
	origin := r.Header.Get("Origin")
	if origin != "" {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		w.Header().Set("Access-Control-Allow-Credentials", "true")
	}
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// Skip instrumentation for the /metrics scrape endpoint itself
	if r.URL.Path == "/metrics" {
		s.mux.ServeHTTP(w, r)
		return
	}

	// Instrument every other request with latency + count metrics
	sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
	start := time.Now()
	s.mux.ServeHTTP(sr, r)
	elapsed := time.Since(start).Seconds()

	path := normalizePath(r.URL.Path)
	code := strconv.Itoa(sr.status)
	metrics.HTTPRequestDuration.WithLabelValues(r.Method, path, code).Observe(elapsed)
	metrics.HTTPRequestsTotal.WithLabelValues(r.Method, path, code).Inc()
}

func (s *Server) registerRoutes() {
	h := &handlers{manager: s.manager, suiteManager: s.suiteManager}

	// Single test
	s.mux.HandleFunc("POST /api/test/run",               h.startRun)
	s.mux.HandleFunc("GET /api/test/{id}/stream",        h.streamRun)
	s.mux.HandleFunc("GET /api/test/{id}/report",        h.getReport)
	s.mux.HandleFunc("GET /api/test/{id}/html-report",   h.getHTMLReport)
	s.mux.HandleFunc("GET /api/test/{id}/script",        h.getScript)
	s.mux.HandleFunc("DELETE /api/test/{id}",            h.abortRun)

	// Suite / DAG
	s.mux.HandleFunc("POST /api/suite/run",              h.startSuiteRun)
	s.mux.HandleFunc("GET /api/suite/{id}/status",       h.getSuiteStatus)
	s.mux.HandleFunc("GET /api/suite/{id}/stream",       h.streamSuiteRun)

	// Run history
	s.mux.HandleFunc("GET /api/runs",                    h.listHistory)
	s.mux.HandleFunc("GET /api/runs/{id}",               h.getHistoryEntry)

	s.mux.HandleFunc("GET /health",                      h.health)

	// Prometheus scrape endpoint — served by the official promhttp handler
	s.mux.Handle("GET /metrics", promhttp.Handler())
}

func (s *Server) ListenAndServe(addr string) error {
	fmt.Printf("Anvil backend listening on %s\n", addr)
	return http.ListenAndServe(addr, s)
}
