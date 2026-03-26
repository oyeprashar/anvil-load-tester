// Package runner manages k6 test executions. Each run gets a unique ID,
// a temp directory for its script + summary file, and a broadcast channel
// so multiple SSE subscribers can receive log lines in real time.
package runner

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/shubhamprashar/anvil/internal/metrics"
	"github.com/shubhamprashar/anvil/internal/models"
	"github.com/shubhamprashar/anvil/internal/transpiler"
)

// DashboardPort is the port the k6 web dashboard binds to.
// The browser connects here directly — make sure it's mapped in docker-compose.
const DashboardPort = "5665"

// ── Run ───────────────────────────────────────────────────────

// Run holds the live state of a single k6 test execution.
type Run struct {
	ID             string
	Status         models.RunStatus
	Metrics        *models.MetricsSummary
	Error          string
	StartedAt      time.Time
	CompletedAt    time.Time
	HTMLReportPath string // path to the exported k6 web dashboard HTML report

	cancel context.CancelFunc // cancels the k6 subprocess

	// subscribers receive log lines as they stream from k6 stdout
	mu          sync.RWMutex
	subscribers []chan string
	logs        []string // buffered so late subscribers get history
}

func (r *Run) subscribe() chan string {
	ch := make(chan string, 512)
	r.mu.Lock()
	// Replay buffered history into the channel first
	for _, line := range r.logs {
		ch <- line
	}
	// If the run is already done, close immediately after history
	if r.Status == models.StatusCompleted || r.Status == models.StatusFailed {
		r.mu.Unlock()
		close(ch)
		return ch
	}
	r.subscribers = append(r.subscribers, ch)
	r.mu.Unlock()
	return ch
}

func (r *Run) unsubscribe(ch chan string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, sub := range r.subscribers {
		if sub == ch {
			r.subscribers = append(r.subscribers[:i], r.subscribers[i+1:]...)
			close(ch)
			return
		}
	}
}

func (r *Run) broadcast(line string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.logs = append(r.logs, line)
	for _, ch := range r.subscribers {
		select {
		case ch <- line:
		default: // drop if subscriber is slow
		}
	}
}

// ── Manager ───────────────────────────────────────────────────

// Manager owns all active and recent runs, plus an in-memory history.
type Manager struct {
	runs   sync.Map // map[string]*Run
	k6Path string

	histMu  sync.RWMutex
	history []*models.HistoryRecord // ordered oldest-first, capped at 200
}

// New creates a Manager. k6Path is the path to the k6 binary
// (defaults to "k6" which relies on PATH).
func New(k6Path string) *Manager {
	if k6Path == "" {
		k6Path = "k6"
	}
	return &Manager{k6Path: k6Path}
}

// DefaultTimeout is the maximum wall-clock time a single test run is allowed
// to take before Anvil forcibly cancels it.
const DefaultTimeout = 30 * time.Minute

// Start transpiles cfg into a k6 script, launches k6, and returns
// the run ID immediately. The test runs asynchronously.
func (m *Manager) Start(ctx context.Context, cfg models.TestConfig) (string, error) {
	// Generate a unique run ID
	id := fmt.Sprintf("%d", time.Now().UnixNano())

	// Transpile config → k6 JS (and proto file content for gRPC)
	script, protoContent, err := transpiler.Generate(cfg)
	if err != nil {
		return "", fmt.Errorf("runner: transpile: %w", err)
	}

	// Write script to a temp directory
	dir, err := os.MkdirTemp("", "anvil-run-"+id)
	if err != nil {
		return "", fmt.Errorf("runner: mkdtemp: %w", err)
	}

	scriptPath      := filepath.Join(dir, "script.js")
	summaryPath     := filepath.Join(dir, "summary.json")
	// HTML report lives outside the temp dir so it survives the defer cleanup.
	htmlReportPath  := filepath.Join(os.TempDir(), "anvil-report-"+id+".html")

	// Inject handleSummary so k6 writes the aggregate JSON to summaryPath.
	// This is the k6 v1.x-recommended replacement for --summary-export.
	script += "\nexport function handleSummary(data) {\n  return { " +
		strconv.Quote(summaryPath) + ": JSON.stringify(data) };\n}\n"

	if err := os.WriteFile(scriptPath, []byte(script), 0644); err != nil {
		os.RemoveAll(dir)
		return "", fmt.Errorf("runner: write script: %w", err)
	}

	// Write the proto file for gRPC tests so k6 can find it beside the script.
	if protoContent != "" {
		protoPath := filepath.Join(dir, "proto.proto")
		if err := os.WriteFile(protoPath, []byte(protoContent), 0644); err != nil {
			os.RemoveAll(dir)
			return "", fmt.Errorf("runner: write proto: %w", err)
		}
	}

	// Create a cancellable context with a hard timeout so a stuck test
	// never runs forever.
	runCtx, cancel := context.WithTimeout(ctx, DefaultTimeout)

	now := time.Now()
	run := &Run{
		ID:             id,
		Status:         models.StatusRunning,
		StartedAt:      now,
		cancel:         cancel,
		HTMLReportPath: htmlReportPath,
	}
	m.runs.Store(id, run)
	metrics.ActiveRuns.Inc()

	// Run k6 asynchronously
	go m.execute(runCtx, run, cfg, dir, scriptPath, summaryPath)

	return id, nil
}

// execute runs k6, streams output, then parses the summary.
func (m *Manager) execute(ctx context.Context, run *Run, cfg models.TestConfig, dir, scriptPath, summaryPath string) {
	defer os.RemoveAll(dir)

	cmd := exec.CommandContext(ctx,
		m.k6Path, "run",
		"--no-color",
		scriptPath,
	)
	// Enable the k6 web dashboard so users can watch metrics live.
	// K6_WEB_DASHBOARD_HOST=0.0.0.0 is required in Docker so the host can reach it.
	// K6_WEB_DASHBOARD_EXPORT writes the session as a standalone HTML report.
	cmd.Env = append(os.Environ(),
		"K6_WEB_DASHBOARD=true",
		"K6_WEB_DASHBOARD_HOST=0.0.0.0",
		"K6_WEB_DASHBOARD_PORT="+DashboardPort,
		"K6_WEB_DASHBOARD_OPEN=false",
		"K6_WEB_DASHBOARD_EXPORT="+run.HTMLReportPath,
	)

	// Use an io.Pipe so we can merge stdout + stderr into one stream
	// without fighting with StdoutPipe ownership rules.
	pr, pw := io.Pipe()
	cmd.Stdout = pw
	cmd.Stderr = pw

	if err := cmd.Start(); err != nil {
		pw.Close()
		pr.Close()
		m.fail(run, fmt.Sprintf("could not start k6: %v", err))
		return
	}

	// Close the write end of the pipe once k6 exits so the scanner below
	// sees EOF. Do this in a separate goroutine to avoid deadlock.
	go func() {
		cmd.Wait() // nolint: errcheck — we capture the error below via cmd.ProcessState
		pw.Close()
	}()

	// Stream every line of output to subscribers
	scanner := bufio.NewScanner(pr)
	for scanner.Scan() {
		run.broadcast(scanner.Text())
	}
	pr.Close()

	// cmd.Wait() has already been called in the goroutine above; check exit code
	// via ProcessState so we don't call Wait() twice.
	var cmdErr error
	if run.Status != models.StatusFailed {
		if ps := cmd.ProcessState; ps != nil && !ps.Success() {
			// Distinguish between user abort and timeout
			switch ctx.Err() {
			case context.Canceled:
				cmdErr = fmt.Errorf("test aborted by user")
			case context.DeadlineExceeded:
				cmdErr = fmt.Errorf("test exceeded maximum duration (%s)", DefaultTimeout)
			default:
				cmdErr = fmt.Errorf("k6 exited with code %d", ps.ExitCode())
			}
		}
	}

	// Parse the summary file regardless of exit code (thresholds can cause
	// non-zero exit even on a "successful" test).
	metricsSummary, parseErr := parseSummary(summaryPath)

	run.mu.Lock()
	run.CompletedAt = time.Now()
	if cmdErr != nil && metricsSummary == nil {
		// Hard failure — k6 didn't even produce a summary
		run.Status = models.StatusFailed
		run.Error = fmt.Sprintf("k6 exited with error: %v", cmdErr)
		if parseErr != nil {
			run.Error += fmt.Sprintf("; summary parse error: %v", parseErr)
		}
	} else {
		// k6 ran to completion (even if some thresholds failed)
		run.Status = models.StatusCompleted
		run.Metrics = metricsSummary
		if cmdErr != nil {
			run.Error = "one or more thresholds failed"
		}
	}
	// Drain and close all subscriber channels to signal end-of-stream
	for _, ch := range run.subscribers {
		close(ch)
	}
	run.subscribers = nil
	run.mu.Unlock()

	// Update Prometheus metrics
	metrics.ActiveRuns.Dec()
	metrics.RunsTotal.WithLabelValues(string(run.Status)).Inc()

	// Persist to in-memory history (cap at 200 entries)
	rec := &models.HistoryRecord{
		ID:          run.ID,
		CreatedAt:   run.StartedAt,
		CompletedAt: run.CompletedAt,
		Status:      run.Status,
		Config:      cfg,
		Metrics:     run.Metrics,
		Error:       run.Error,
		DurationMs:  run.CompletedAt.Sub(run.StartedAt).Milliseconds(),
	}
	m.histMu.Lock()
	m.history = append(m.history, rec)
	if len(m.history) > 200 {
		m.history = m.history[len(m.history)-200:]
	}
	m.histMu.Unlock()
}

func (m *Manager) fail(run *Run, msg string) {
	run.mu.Lock()
	run.Status = models.StatusFailed
	run.Error = msg
	run.CompletedAt = time.Now()
	for _, ch := range run.subscribers {
		close(ch)
	}
	run.subscribers = nil
	run.mu.Unlock()
}

// Get returns the run with the given ID, or nil if not found.
func (m *Manager) Get(id string) *Run {
	v, ok := m.runs.Load(id)
	if !ok {
		return nil
	}
	return v.(*Run)
}

// Subscribe returns a channel that receives log lines for the given run.
// The channel is closed when the run finishes. Returns nil if run not found.
func (m *Manager) Subscribe(id string) chan string {
	run := m.Get(id)
	if run == nil {
		return nil
	}
	return run.subscribe()
}

// Unsubscribe removes a subscriber channel from a run.
func (m *Manager) Unsubscribe(id string, ch chan string) {
	run := m.Get(id)
	if run == nil {
		return
	}
	run.unsubscribe(ch)
}

// ListHistory returns completed runs, most-recent first (up to limit entries).
func (m *Manager) ListHistory(limit int) []*models.HistoryRecord {
	m.histMu.RLock()
	defer m.histMu.RUnlock()
	n := len(m.history)
	if limit <= 0 || limit > n {
		limit = n
	}
	// Return a reversed copy (newest first)
	out := make([]*models.HistoryRecord, limit)
	for i := 0; i < limit; i++ {
		out[i] = m.history[n-1-i]
	}
	return out
}

// GetHistoryEntry returns a single history record by run ID.
func (m *Manager) GetHistoryEntry(id string) *models.HistoryRecord {
	m.histMu.RLock()
	defer m.histMu.RUnlock()
	for i := len(m.history) - 1; i >= 0; i-- {
		if m.history[i].ID == id {
			return m.history[i]
		}
	}
	return nil
}

// Cancel aborts a running test by cancelling its context, which kills the
// k6 subprocess. No-op if the run doesn't exist or has already finished.
func (m *Manager) Cancel(id string) bool {
	run := m.Get(id)
	if run == nil {
		return false
	}
	run.mu.RLock()
	status := run.Status
	cancel := run.cancel
	run.mu.RUnlock()

	if status != models.StatusRunning {
		return false
	}
	if cancel != nil {
		cancel()
	}
	return true
}

// ── k6 summary parser ─────────────────────────────────────────

func parseSummary(path string) (*models.MetricsSummary, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read summary: %w", err)
	}

	var summary models.K6Summary
	if err := json.Unmarshal(data, &summary); err != nil {
		return nil, fmt.Errorf("unmarshal summary: %w", err)
	}

	ms := &models.MetricsSummary{}

	if m, ok := summary.Metrics["http_req_duration"]; ok {
		ms.HTTPReqDuration = models.DurationMetrics{
			Avg: roundMs(m.Values["avg"]),
			P50: roundMs(m.Values["med"]),
			P95: roundMs(m.Values["p(95)"]),
			P99: roundMs(m.Values["p(99)"]),
		}
	}

	if m, ok := summary.Metrics["http_reqs"]; ok {
		ms.HTTPReqRate = models.RateMetrics{
			Rate:  math.Round(m.Values["rate"]*100) / 100,
			Total: int(m.Values["count"]),
		}
		ms.Iterations = int(m.Values["count"])
	}

	if m, ok := summary.Metrics["http_req_failed"]; ok {
		ms.HTTPReqFailed = models.FailedMetrics{
			Rate:  math.Round(m.Values["rate"]*10000) / 10000,
			Total: int(m.Values["passes"]), // k6 counts "passes" as failures
		}
	}

	if m, ok := summary.Metrics["vus_max"]; ok {
		ms.VUsMax = int(m.Values["value"])
	}

	return ms, nil
}

func roundMs(v float64) float64 {
	return math.Round(v*10) / 10
}
