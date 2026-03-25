export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface Stage {
  id: string;
  duration: string;   // e.g. "30s", "2m"
  target: number;     // target VU count
}

export interface Header {
  id: string;
  key: string;
  value: string;
}

export interface Threshold {
  id: string;
  metric: 'http_req_duration' | 'http_req_failed' | 'http_reqs';
  condition: string;  // e.g. "p(95)<500", "rate<0.01"
}

export interface TestConfig {
  name: string;
  baseUrl: string;
  method: HttpMethod;
  path: string;
  headers: Header[];
  body: string;
  stages: Stage[];
  thresholds: Threshold[];
}

export interface MetricsSummary {
  httpReqDuration: { p50: number; p95: number; p99: number; avg: number };
  httpReqRate:     { rate: number; total: number };
  httpReqFailed:   { rate: number; total: number };
  vusMax:          number;
  iterations:      number;
  testDuration:    string;
}

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface TestRun {
  id: string;
  status: RunStatus;
  logs: string[];
  metrics?: MetricsSummary;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}
