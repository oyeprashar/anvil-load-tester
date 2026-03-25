package api

import (
	"fmt"
	"net/http"

	"github.com/shubhamprashar/anvil/internal/runner"
)

// Server wires together the HTTP mux and the run manager.
type Server struct {
	manager *runner.Manager
	mux     *http.ServeMux
}

func NewServer(manager *runner.Manager) *Server {
	s := &Server{
		manager: manager,
		mux:     http.NewServeMux(),
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
	s.mux.ServeHTTP(w, r)
}

func (s *Server) registerRoutes() {
	h := &handlers{manager: s.manager}

	s.mux.HandleFunc("POST /api/test/run",               h.startRun)
	s.mux.HandleFunc("GET /api/test/{id}/stream",        h.streamRun)
	s.mux.HandleFunc("GET /api/test/{id}/report",        h.getReport)
	s.mux.HandleFunc("GET /api/test/{id}/html-report",   h.getHTMLReport)
	s.mux.HandleFunc("GET /api/test/{id}/script",        h.getScript)
	s.mux.HandleFunc("DELETE /api/test/{id}",            h.abortRun)
	s.mux.HandleFunc("GET /health",                      h.health)
}

func (s *Server) ListenAndServe(addr string) error {
	fmt.Printf("Anvil backend listening on %s\n", addr)
	return http.ListenAndServe(addr, s)
}
