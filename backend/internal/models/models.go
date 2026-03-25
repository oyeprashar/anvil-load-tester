package models

import "time"

// ── Protocol ──────────────────────────────────────────────────

type Protocol string

const (
	ProtocolHTTP  Protocol = "http"
	ProtocolGRPC  Protocol = "grpc"
	ProtocolKafka Protocol = "kafka"
	ProtocolRedis Protocol = "redis"
)

// ── HTTP primitives ───────────────────────────────────────────

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

// ── Protocol-specific config ──────────────────────────────────

// GRPCConfig holds everything needed to generate a k6 gRPC script.
// ProtoContent is the raw text of the .proto file (uploaded by the user).
type GRPCConfig struct {
	Host         string `json:"host"`         // e.g. "api.example.com:443"
	ProtoContent string `json:"protoContent"` // raw .proto file text
	Service      string `json:"service"`      // e.g. "helloworld.Greeter"
	Method       string `json:"method"`       // e.g. "SayHello"
	Payload      string `json:"payload"`      // JSON string for the request message
	TLS          bool   `json:"tls"`
}

// KafkaConfig holds everything needed to generate a k6/x/kafka script.
type KafkaConfig struct {
	Brokers []string `json:"brokers"` // e.g. ["localhost:9092"]
	Topic   string   `json:"topic"`
	Message string   `json:"message"` // message body template
}

// RedisConfig holds everything needed to generate a k6/x/redis script.
type RedisConfig struct {
	Addr    string `json:"addr"`    // e.g. "localhost:6379"
	Command string `json:"command"` // "SET", "GET", "INCR", "LPUSH", etc.
	Key     string `json:"key"`
	Value   string `json:"value"` // used for SET/LPUSH
}

// ── Unified test config ───────────────────────────────────────

type TestConfig struct {
	Name     string   `json:"name"`
	Protocol Protocol `json:"protocol"` // defaults to "http" if empty

	// HTTP-specific (only when Protocol == "http")
	BaseURL string     `json:"baseUrl,omitempty"`
	Method  HttpMethod `json:"method,omitempty"`
	Path    string     `json:"path,omitempty"`
	Headers []Header   `json:"headers,omitempty"`
	Body    string     `json:"body,omitempty"`

	// Protocol-specific configs
	GRPCConfig  *GRPCConfig  `json:"grpcConfig,omitempty"`
	KafkaConfig *KafkaConfig `json:"kafkaConfig,omitempty"`
	RedisConfig *RedisConfig `json:"redisConfig,omitempty"`

	// Common load profile
	Stages     []Stage     `json:"stages"`
	Thresholds []Threshold `json:"thresholds,omitempty"`
}

// EffectiveProtocol returns "http" if Protocol is empty, for backwards compat.
func (tc TestConfig) EffectiveProtocol() Protocol {
	if tc.Protocol == "" {
		return ProtocolHTTP
	}
	return tc.Protocol
}

// ── Run state ─────────────────────────────────────────────────

type RunStatus string

const (
	StatusPending   RunStatus = "pending"
	StatusRunning   RunStatus = "running"
	StatusCompleted RunStatus = "completed"
	StatusFailed    RunStatus = "failed"
	StatusSkipped   RunStatus = "skipped"
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

// ── History ───────────────────────────────────────────────────

// HistoryRecord is a completed run persisted in the in-memory store.
type HistoryRecord struct {
	ID          string          `json:"id"`
	CreatedAt   time.Time       `json:"createdAt"`
	CompletedAt time.Time       `json:"completedAt"`
	Status      RunStatus       `json:"status"`
	Config      TestConfig      `json:"config"`
	Metrics     *MetricsSummary `json:"metrics,omitempty"`
	Error       string          `json:"error,omitempty"`
	DurationMs  int64           `json:"durationMs"`
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

// ── Suite / DAG types ─────────────────────────────────────────

// Position stores the x/y coordinates of a node in the DAG editor canvas.
type Position struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

// SuiteNode is one vertex in the test-suite DAG.
// Dependencies lists IDs of nodes that must complete before this node runs.
// If IsGate is true and this node fails, all reachable downstream nodes are skipped.
type SuiteNode struct {
	ID           string     `json:"id"`
	TestConfig   TestConfig `json:"testConfig"`
	Dependencies []string   `json:"dependencies"`
	IsGate       bool       `json:"isGate"`
	Position     Position   `json:"position"`
}

// Suite is a named, saveable collection of test nodes and their dependency edges.
type Suite struct {
	ID    string      `json:"id"`
	Name  string      `json:"name"`
	Nodes []SuiteNode `json:"nodes"`
}

// SuiteNodeRun tracks the execution state of a single node within a suite run.
type SuiteNodeRun struct {
	NodeID string    `json:"nodeId"`
	RunID  string    `json:"runId,omitempty"` // k6 run ID once started
	Status RunStatus `json:"status"`
	Error  string    `json:"error,omitempty"`
}

// SuiteRun holds the live state of an entire suite execution.
type SuiteRun struct {
	ID          string         `json:"id"`
	Suite       Suite          `json:"suite"`
	Status      RunStatus      `json:"status"`
	NodeRuns    []SuiteNodeRun `json:"nodeRuns"`
	StartedAt   time.Time      `json:"startedAt"`
	CompletedAt *time.Time     `json:"completedAt,omitempty"`
}

// SuiteEvent is emitted over SSE whenever a node or the suite changes state.
type SuiteEvent struct {
	Type    string        `json:"type"`    // "node_update" | "suite_done"
	NodeRun *SuiteNodeRun `json:"nodeRun,omitempty"`
	Status  RunStatus     `json:"status,omitempty"`
	Error   string        `json:"error,omitempty"`
}
