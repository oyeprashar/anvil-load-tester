// ── Protocol ──────────────────────────────────────────────────

export type Protocol = 'http' | 'grpc' | 'kafka' | 'redis';

// ── HTTP primitives ───────────────────────────────────────────

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Stage {
  id: string;
  duration: string;
  target: number;
}

export interface Header {
  id: string;
  key: string;
  value: string;
}

export interface Threshold {
  id: string;
  metric: 'http_req_duration' | 'http_req_failed' | 'http_reqs' | 'grpc_req_duration';
  condition: string;
}

// ── Protocol-specific configs ─────────────────────────────────

export interface GRPCConfig {
  host: string;           // e.g. "api.example.com:443"
  protoContent: string;   // raw text of the .proto file
  service: string;        // e.g. "helloworld.Greeter"
  method: string;         // e.g. "SayHello"
  payload: string;        // JSON string for the request message
  tls: boolean;
}

export interface KafkaConfig {
  brokers: string[];      // e.g. ["localhost:9092"]
  topic: string;
  message: string;
}

export interface RedisConfig {
  addr: string;           // e.g. "localhost:6379"
  command: string;        // "SET" | "GET" | "INCR" | "LPUSH"
  key: string;
  value: string;
}

// ── Unified test config ───────────────────────────────────────

export interface TestConfig {
  name: string;
  protocol: Protocol;

  // HTTP-specific
  baseUrl?: string;
  method?: HttpMethod;
  path?: string;
  headers?: Header[];
  body?: string;

  // Protocol-specific
  grpcConfig?: GRPCConfig;
  kafkaConfig?: KafkaConfig;
  redisConfig?: RedisConfig;

  // Common load profile
  stages: Stage[];
  thresholds?: Threshold[];
}

// ── Run state ─────────────────────────────────────────────────

export type RunStatus = 'pending' | 'idle' | 'running' | 'completed' | 'failed' | 'skipped';

export interface MetricsSummary {
  httpReqDuration: { p50: number; p95: number; p99: number; avg: number };
  httpReqRate:     { rate: number; total: number };
  httpReqFailed:   { rate: number; total: number };
  vusMax:          number;
  iterations:      number;
  testDuration:    string;
}

export interface TestRun {
  id: string;
  status: RunStatus;
  logs: string[];
  metrics?: MetricsSummary;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

// ── History ───────────────────────────────────────────────────

export interface HistoryRecord {
  id:          string;
  createdAt:   string;   // ISO timestamp
  completedAt: string;   // ISO timestamp
  status:      RunStatus;
  config:      TestConfig;
  metrics?:    MetricsSummary;
  error?:      string;
  durationMs:  number;
}

// ── Suite / DAG types ─────────────────────────────────────────

export interface SuiteNodePosition {
  x: number;
  y: number;
}

export interface SuiteNode {
  id: string;
  testConfig: TestConfig;
  dependencies: string[];  // IDs of nodes that must finish before this one
  isGate: boolean;         // if true and fails, downstream nodes are skipped
  position: SuiteNodePosition;
}

export interface Suite {
  id: string;
  name: string;
  nodes: SuiteNode[];
}

export interface SuiteNodeRun {
  nodeId: string;
  runId?: string;
  status: RunStatus;
  error?: string;
}

export interface SuiteRun {
  id: string;
  suite: Suite;
  status: RunStatus;
  nodeRuns: SuiteNodeRun[];
  startedAt: Date;
  completedAt?: Date;
}

export interface SuiteEvent {
  type: 'node_update' | 'suite_done';
  nodeRun?: SuiteNodeRun;
  status?: RunStatus;
  error?: string;
}
