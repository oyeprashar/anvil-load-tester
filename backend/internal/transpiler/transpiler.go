// Package transpiler converts an Anvil TestConfig into a valid k6 JavaScript
// test script that can be executed directly by the k6 binary.
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
func Generate(cfg models.TestConfig) (string, error) {
	data, err := buildTemplateData(cfg)
	if err != nil {
		return "", fmt.Errorf("transpiler: building template data: %w", err)
	}

	tmpl, err := template.New("k6script").Funcs(funcMap).Parse(k6Template)
	if err != nil {
		return "", fmt.Errorf("transpiler: parsing template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, data); err != nil {
		return "", fmt.Errorf("transpiler: executing template: %w", err)
	}

	return buf.String(), nil
}

// ── Template data ─────────────────────────────────────────────

type templateData struct {
	Stages     []stageData
	Thresholds []thresholdData
	URL        string
	Method     string
	HasHeaders bool
	Headers    []headerData
	HasBody    bool
	Body       string // JSON-safe string literal
}

type stageData struct {
	Duration string
	Target   int
}

type thresholdData struct {
	Metric    string
	Condition string
}

type headerData struct {
	Key   string
	Value string
}

func buildTemplateData(cfg models.TestConfig) (templateData, error) {
	// Build URL
	path := cfg.Path
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := strings.TrimRight(cfg.BaseURL, "/") + path

	// Stages
	stages := make([]stageData, len(cfg.Stages))
	for i, s := range cfg.Stages {
		stages[i] = stageData{Duration: s.Duration, Target: s.Target}
	}

	// Thresholds — group multiple conditions under the same metric key
	thresholds := make([]thresholdData, len(cfg.Thresholds))
	for i, t := range cfg.Thresholds {
		thresholds[i] = thresholdData{Metric: t.Metric, Condition: t.Condition}
	}

	// Headers
	headers := make([]headerData, 0, len(cfg.Headers))
	for _, h := range cfg.Headers {
		if strings.TrimSpace(h.Key) == "" {
			continue
		}
		headers = append(headers, headerData{Key: h.Key, Value: h.Value})
	}

	// Body — marshal to a JS string literal so it is always safe to embed
	var bodyLiteral string
	if strings.TrimSpace(cfg.Body) != "" {
		// Re-marshal to ensure it is valid JSON, then produce a JS string
		var raw json.RawMessage
		if err := json.Unmarshal([]byte(cfg.Body), &raw); err != nil {
			// Not valid JSON — treat as plain string
			bodyLiteral = fmt.Sprintf("%q", cfg.Body)
		} else {
			minified, _ := json.Marshal(raw)
			bodyLiteral = fmt.Sprintf("JSON.stringify(%s)", string(minified))
		}
	}

	return templateData{
		Stages:     stages,
		Thresholds: thresholds,
		URL:        url,
		Method:     strings.ToLower(string(cfg.Method)),
		HasHeaders: len(headers) > 0,
		Headers:    headers,
		HasBody:    bodyLiteral != "",
		Body:       bodyLiteral,
	}, nil
}

// ── Template helpers ──────────────────────────────────────────

var funcMap = template.FuncMap{
	"jsString": func(s string) string {
		b, _ := json.Marshal(s)
		return string(b)
	},
	"last": func(i, n int) bool { return i == n-1 },
}

// ── k6 script template ────────────────────────────────────────

const k6Template = `import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
{{- range $i, $s := .Stages}}
    { duration: '{{$s.Duration}}', target: {{$s.Target}} },
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
