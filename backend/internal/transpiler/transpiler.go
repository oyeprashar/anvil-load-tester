// Package transpiler converts an Anvil TestConfig into a valid k6 JavaScript
// test script. It dispatches to a protocol-specific template based on
// TestConfig.Protocol (http / grpc / kafka / redis).
package transpiler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"text/template"

	"github.com/shubhamprashar/anvil/internal/models"
)

// Generate takes a TestConfig and returns a k6-compatible JavaScript script.
// For gRPC configs it also returns the proto file content that must be written
// to disk beside the script (empty string for other protocols).
func Generate(cfg models.TestConfig) (script string, protoContent string, err error) {
	switch cfg.EffectiveProtocol() {
	case models.ProtocolGRPC:
		script, err = generateGRPC(cfg)
		if cfg.GRPCConfig != nil {
			protoContent = cfg.GRPCConfig.ProtoContent
		}
	case models.ProtocolKafka:
		script, err = generateKafka(cfg)
	case models.ProtocolRedis:
		script, err = generateRedis(cfg)
	default:
		script, err = generateHTTP(cfg)
	}
	return
}

// ── Template helpers ──────────────────────────────────────────

var funcMap = template.FuncMap{
	"jsString": func(s string) string {
		b, _ := json.Marshal(s)
		return string(b)
	},
	"jsStringSlice": func(ss []string) string {
		b, _ := json.Marshal(ss)
		return string(b)
	},
	"last":  func(i, n int) bool { return i == n-1 },
	"lower": strings.ToLower,
	"print": fmt.Sprintf,
}

func execTemplate(name, tmpl string, data any) (string, error) {
	t, err := template.New(name).Funcs(funcMap).Parse(tmpl)
	if err != nil {
		return "", fmt.Errorf("transpiler: parse template %s: %w", name, err)
	}
	var buf bytes.Buffer
	if err := t.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("transpiler: execute template %s: %w", name, err)
	}
	return buf.String(), nil
}

// ── Shared load-profile helpers ───────────────────────────────

type stageData struct {
	Duration string
	Target   int
}

type thresholdData struct {
	Metric    string
	Condition string
}

func buildLoadProfile(cfg models.TestConfig) ([]stageData, []thresholdData) {
	stages := make([]stageData, len(cfg.Stages))
	for i, s := range cfg.Stages {
		stages[i] = stageData{Duration: s.Duration, Target: s.Target}
	}
	thresholds := make([]thresholdData, len(cfg.Thresholds))
	for i, t := range cfg.Thresholds {
		thresholds[i] = thresholdData{Metric: t.Metric, Condition: t.Condition}
	}
	return stages, thresholds
}

// ── HTTP ──────────────────────────────────────────────────────

type httpTemplateData struct {
	Stages     []stageData
	Thresholds []thresholdData
	URL        string
	Method     string
	HasHeaders bool
	Headers    []struct{ Key, Value string }
	HasBody    bool
	Body       string
}

func generateHTTP(cfg models.TestConfig) (string, error) {
	path := cfg.Path
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := strings.TrimRight(cfg.BaseURL, "/") + path

	stages, thresholds := buildLoadProfile(cfg)

	headers := make([]struct{ Key, Value string }, 0)
	for _, h := range cfg.Headers {
		if strings.TrimSpace(h.Key) != "" {
			headers = append(headers, struct{ Key, Value string }{h.Key, h.Value})
		}
	}

	var bodyLiteral string
	if strings.TrimSpace(cfg.Body) != "" {
		var raw json.RawMessage
		if err := json.Unmarshal([]byte(cfg.Body), &raw); err != nil {
			bodyLiteral = fmt.Sprintf("%q", cfg.Body)
		} else {
			minified, _ := json.Marshal(raw)
			bodyLiteral = fmt.Sprintf("JSON.stringify(%s)", string(minified))
		}
	}

	data := httpTemplateData{
		Stages: stages, Thresholds: thresholds,
		URL: url, Method: strings.ToLower(string(cfg.Method)),
		HasHeaders: len(headers) > 0, Headers: headers,
		HasBody: bodyLiteral != "", Body: bodyLiteral,
	}
	return execTemplate("http", httpTemplate, data)
}

const httpTemplate = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
{{- range .Stages}}
    { duration: '{{.Duration}}', target: {{.Target}} },
{{- end}}
  ],
{{- if .Thresholds}}
  thresholds: {
{{- range .Thresholds}}
    '{{.Metric}}': ['{{.Condition}}'],
{{- end}}
  },
{{- end}}
};

export default function () {
  const url = {{jsString .URL}};

{{- if .HasHeaders}}
  const params = {
    headers: {
{{- range .Headers}}
      {{jsString .Key}}: {{jsString .Value}},
{{- end}}
    },
  };
{{- end}}

{{- if .HasBody}}
  const body = {{.Body}};
{{- end}}

{{- if eq .Method "get"}}
  const res = http.get(url{{if .HasHeaders}}, params{{end}});
{{- else if eq .Method "delete"}}
  const res = http.del(url{{if .HasHeaders}}, params{{end}});
{{- else}}
  const res = http.{{.Method}}(url, {{if .HasBody}}body{{else}}null{{end}}{{if .HasHeaders}}, params{{end}});
{{- end}}

  check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
  });

  sleep(1);
}
`

// ── gRPC ──────────────────────────────────────────────────────

type grpcTemplateData struct {
	Stages     []stageData
	Thresholds []thresholdData
	Host       string
	Service    string
	Method     string
	Payload    string // JSON object literal (may be "{}")
	TLS        bool
}

func generateGRPC(cfg models.TestConfig) (string, error) {
	if cfg.GRPCConfig == nil {
		return "", fmt.Errorf("transpiler: grpcConfig is required for gRPC protocol")
	}
	g := cfg.GRPCConfig
	stages, thresholds := buildLoadProfile(cfg)

	payload := strings.TrimSpace(g.Payload)
	if payload == "" {
		payload = "{}"
	}
	// Validate it's JSON; fall back to empty object if not
	var raw json.RawMessage
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		payload = "{}"
	}

	data := grpcTemplateData{
		Stages: stages, Thresholds: thresholds,
		Host: g.Host, Service: g.Service, Method: g.Method,
		Payload: payload, TLS: g.TLS,
	}
	return execTemplate("grpc", grpcTemplate, data)
}

const grpcTemplate = `import grpc from 'k6/net/grpc';
import { check, sleep } from 'k6';

export const options = {
  stages: [
{{- range .Stages}}
    { duration: '{{.Duration}}', target: {{.Target}} },
{{- end}}
  ],
{{- if .Thresholds}}
  thresholds: {
{{- range .Thresholds}}
    '{{.Metric}}': ['{{.Condition}}'],
{{- end}}
  },
{{- end}}
};

const client = new grpc.Client();
client.load(['.'], 'proto.proto');

export default function () {
  client.connect({{jsString .Host}}, { plaintext: {{if .TLS}}false{{else}}true{{end}} });

  const response = client.invoke(
    {{jsString (print .Service "/" .Method)}},
    {{.Payload}},
  );

  check(response, {
    'gRPC status is OK': (r) => r && r.status === grpc.StatusOK,
  });

  client.close();
  sleep(1);
}
`

// ── Kafka ─────────────────────────────────────────────────────

type kafkaTemplateData struct {
	Stages     []stageData
	Thresholds []thresholdData
	Brokers    string // JSON array literal
	Topic      string
	Message    string
}

func generateKafka(cfg models.TestConfig) (string, error) {
	if cfg.KafkaConfig == nil {
		return "", fmt.Errorf("transpiler: kafkaConfig is required for kafka protocol")
	}
	k := cfg.KafkaConfig
	stages, thresholds := buildLoadProfile(cfg)

	brokersJSON, _ := json.Marshal(k.Brokers)
	message := k.Message
	if message == "" {
		message = "anvil-load-test"
	}

	data := kafkaTemplateData{
		Stages: stages, Thresholds: thresholds,
		Brokers: string(brokersJSON), Topic: k.Topic, Message: message,
	}
	return execTemplate("kafka", kafkaTemplate, data)
}

const kafkaTemplate = `import { Writer, SchemaRegistry, SCHEMA_TYPE_STRING } from 'k6/x/kafka';
import { check, sleep } from 'k6';

export const options = {
  stages: [
{{- range .Stages}}
    { duration: '{{.Duration}}', target: {{.Target}} },
{{- end}}
  ],
{{- if .Thresholds}}
  thresholds: {
{{- range .Thresholds}}
    '{{.Metric}}': ['{{.Condition}}'],
{{- end}}
  },
{{- end}}
};

const brokers = {{.Brokers}};
const topic   = {{jsString .Topic}};

const writer = new Writer({ brokers, topic });
const schemaRegistry = new SchemaRegistry();

export default function () {
  const err = writer.produce({
    messages: [
      {
        value: schemaRegistry.serialize({
          data: {{jsString .Message}},
          schemaType: SCHEMA_TYPE_STRING,
        }),
      },
    ],
  });

  check(err, { 'produced without error': (e) => e === undefined });
  sleep(1);
}

export function teardown() {
  writer.close();
}
`

// ── Redis ─────────────────────────────────────────────────────

type redisTemplateData struct {
	Stages     []stageData
	Thresholds []thresholdData
	Addr       string
	Command    string
	Key        string
	Value      string
	IsWrite    bool // SET / LPUSH etc.
	IsRead     bool // GET / LRANGE etc.
	IsCounter  bool // INCR / DECR
}

func generateRedis(cfg models.TestConfig) (string, error) {
	if cfg.RedisConfig == nil {
		return "", fmt.Errorf("transpiler: redisConfig is required for redis protocol")
	}
	r := cfg.RedisConfig
	stages, thresholds := buildLoadProfile(cfg)

	cmd := strings.ToUpper(strings.TrimSpace(r.Command))
	isWrite := cmd == "SET" || cmd == "LPUSH" || cmd == "RPUSH" || cmd == "SADD" || cmd == "HSET"
	isRead := cmd == "GET" || cmd == "LRANGE" || cmd == "SMEMBERS" || cmd == "HGET"
	isCounter := cmd == "INCR" || cmd == "DECR" || cmd == "INCRBY"

	data := redisTemplateData{
		Stages: stages, Thresholds: thresholds,
		Addr: r.Addr, Command: cmd,
		Key: r.Key, Value: r.Value,
		IsWrite: isWrite, IsRead: isRead, IsCounter: isCounter,
	}
	return execTemplate("redis", redisTemplate, data)
}

const redisTemplate = `import { Client } from 'k6/experimental/redis';
import { check, sleep } from 'k6';

export const options = {
  stages: [
{{- range .Stages}}
    { duration: '{{.Duration}}', target: {{.Target}} },
{{- end}}
  ],
{{- if .Thresholds}}
  thresholds: {
{{- range .Thresholds}}
    '{{.Metric}}': ['{{.Condition}}'],
{{- end}}
  },
{{- end}}
};

// k6/experimental/redis is built into standard k6 — no extension required.
const client = new Client('redis://{{.Addr}}');

export default async function () {
{{- if .IsWrite}}
  const err = await client.{{.Command | lower}}({{jsString .Key}}, {{jsString .Value}});
  check(err, { 'write succeeded': (e) => e === null || e === undefined });
{{- else if .IsRead}}
  const val = await client.{{.Command | lower}}({{jsString .Key}});
  check(val, { 'read returned value': (v) => v !== null && v !== undefined });
{{- else if .IsCounter}}
  const val = await client.{{.Command | lower}}({{jsString .Key}});
  check(val, { 'counter incremented': (v) => typeof v === 'number' });
{{- else}}
  await client.{{.Command | lower}}({{jsString .Key}}{{if .Value}}, {{jsString .Value}}{{end}});
{{- end}}

  sleep(1);
}
`
