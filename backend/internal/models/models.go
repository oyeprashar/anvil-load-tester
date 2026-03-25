package models

import "time"

// ── Inbound config from the UI ────────────────────────────────

type HttpMethod string

const (
	GET    HttpMethod = "GET"
	POST   HttpMethod = "POST"
	PUT    HttpMethod = "PUT"
	PATCH  HttpMethod = "PATCH"
	DELETE HttpMethod = "DELETE"
)

type Stage struct {
	ID       string `json:"id"`
	Duration string `json:"duration"` // e.g. "30s", "2m"
	Target   int    `json:"target"`   // target VU count
}

type Header struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Value string `json:"value"`
}

type Threshold struct {
	ID        string `json:"id"`
	Metric    string `json:"metric"`    // e.g. "http_req_duration"
	Condition string `json:"condition"` // e.g. "p(95)<500"
}

type TestConfig struct {
	Name       string     `json:"name"`
	BaseURL    string     `json:"baseUrl"`
	Method     HttpMethod `json:"method"`
	Path       string     `json:"path"`
	Headers    []Header   `json:"headers"`
	Body       string     `json:"body"`
	Stages     []Stage    `json:"stages"`
	Thresholds []Threshold `json:"thresholds"`
}

// ── Run state ─────────────────────────────────────────────────

type RunStatus string

const (
	StatusRunning   RunStatus = "running"
	StatusCompleted RunStatus = "completed"
	StatusFailed    RunStatus = "failed"
)

// MetricsSummary mirrors the TypeScript MetricsSummary type exactly
// so the frontend can deserialise it without changes.
type MetricsSummary struct {
	HTTPReqDuration DurationMetrics `json:"httpReqDuration"`
	HTTPReqRate     RateMetrics     `json:"httpReqRate"`
	HTTPReqFailed   FailedMetrics   `json:"httpReqFailed"`
	VUsMax          int             `json:"vusMax"`
	Iterations      int             `json:"iterations"`
	TestDuration    string          `json:"testDuration"`
}

type DurationMetrics struct {
	P50 float64 `json:"p50"`
	P95 float64 `json:"p95"`
	P99 float64 `json:"p99"`
	Avg float64 `json:"avg"`
}

type RateMetrics struct {
	Rate  float64 `json:"rate"`
	Total int     `json:"total"`
}

type FailedMetrics struct {
	Rate  float64 `json:"rate"`
	Total int     `json:"total"`
}

type TestRun struct {
	ID          string          `json:"id"`
	Status      RunStatus       `json:"status"`
	Metrics     *MetricsSummary `json:"metrics,omitempty"`
	Error       string          `json:"error,omitempty"`
	StartedAt   *time.Time      `json:"startedAt,omitempty"`
	CompletedAt *time.Time      `json:"completedAt,omitempty"`
}

// ── k6 summary JSON structure (--summary-export output) ───────

// K6Summary is the top-level structure of k6's --summary-export file.
type K6Summary struct {
	Metrics map[string]K6Metric `json:"metrics"`
}

type K6Metric struct {
	Type     string             `json:"type"`
	Contains string             `json:"contains"`
	Values   map[string]float64 `json:"values"`
}
