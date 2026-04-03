// Package llm provides a provider-agnostic LLM interface for generating
// plain-English summaries of k6 load test results.
//
// Enable by setting LLM_PROVIDER, LLM_API_KEY, and optionally LLM_MODEL.
// Leave LLM_PROVIDER unset to disable the feature entirely — Anvil will
// behave exactly as before with no errors or degraded experience.
package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/shubhamprashar/anvil/internal/models"
)

// Summarizer is the single interface every LLM provider implements.
type Summarizer interface {
	// Summarize returns a plain-English paragraph analysing the test results.
	Summarize(ctx context.Context, run *models.HistoryRecord) (string, error)
	// Provider returns the provider name for display ("openai", "anthropic", "ollama").
	Provider() string
	// Model returns the model name being used.
	Model() string
}

// Config holds everything needed to construct a Summarizer.
type Config struct {
	Provider string // "openai" | "anthropic" | "ollama"
	APIKey   string
	Model    string
	BaseURL  string // override endpoint (useful for Ollama or proxies)
}

// FromEnv reads LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_BASE_URL from
// the environment and returns a Config. Provider will be empty if unset.
func FromEnv() Config {
	return Config{
		Provider: strings.ToLower(strings.TrimSpace(os.Getenv("LLM_PROVIDER"))),
		APIKey:   os.Getenv("LLM_API_KEY"),
		Model:    os.Getenv("LLM_MODEL"),
		BaseURL:  os.Getenv("LLM_BASE_URL"),
	}
}

// New constructs the correct Summarizer for the given config.
// Returns (nil, nil) when Provider is empty — callers treat nil as "disabled".
func New(cfg Config) (Summarizer, error) {
	switch cfg.Provider {
	case "":
		return nil, nil // feature disabled
	case "openai":
		return newOpenAI(cfg)
	case "anthropic":
		return newAnthropic(cfg)
	case "ollama":
		return newOllama(cfg)
	case "mock":
		return newMock(), nil
	default:
		return nil, fmt.Errorf("llm: unknown provider %q (supported: openai, anthropic, ollama, mock)", cfg.Provider)
	}
}

// ── Prompt builder ────────────────────────────────────────────

func buildPrompt(run *models.HistoryRecord) string {
	m := run.Metrics
	var sb strings.Builder
	sb.WriteString("You are an expert in load testing and API performance.\n")
	sb.WriteString("Analyse the following k6 load test results and write a concise 2-3 sentence plain-English summary.\n")
	sb.WriteString("Focus on what the numbers mean for the system under test — highlight anything concerning and anything that looks healthy.\n")
	sb.WriteString("Do not repeat the raw numbers verbatim; interpret them.\n\n")
	sb.WriteString(fmt.Sprintf("Test name: %s\n", run.Config.Name))
	sb.WriteString(fmt.Sprintf("Protocol: %s\n", run.Config.EffectiveProtocol()))
	sb.WriteString(fmt.Sprintf("Status: %s\n", run.Status))
	sb.WriteString(fmt.Sprintf("Duration: %dms\n", run.DurationMs))
	if m != nil {
		sb.WriteString(fmt.Sprintf("HTTP request duration — avg: %.1fms  p50: %.1fms  p95: %.1fms  p99: %.1fms\n",
			m.HTTPReqDuration.Avg, m.HTTPReqDuration.P50, m.HTTPReqDuration.P95, m.HTTPReqDuration.P99))
		sb.WriteString(fmt.Sprintf("Request rate: %.2f req/s  Total requests: %d\n",
			m.HTTPReqRate.Rate, m.HTTPReqRate.Total))
		sb.WriteString(fmt.Sprintf("Error rate: %.4f  Total errors: %d\n",
			m.HTTPReqFailed.Rate, m.HTTPReqFailed.Total))
		sb.WriteString(fmt.Sprintf("Peak VUs: %d\n", m.VUsMax))
	}
	if run.Error != "" {
		sb.WriteString(fmt.Sprintf("Run error: %s\n", run.Error))
	}
	return sb.String()
}

// ── Shared HTTP helper ────────────────────────────────────────

var httpClient = &http.Client{Timeout: 30 * time.Second}

func doPost(ctx context.Context, url string, headers map[string]string, body any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("llm: marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, fmt.Errorf("llm: create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("llm: http request: %w", err)
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("llm: read response: %w", err)
	}
	if resp.StatusCode >= 400 {
		return nil, fmt.Errorf("llm: provider returned %d: %s", resp.StatusCode, string(data))
	}
	return data, nil
}

// ── OpenAI ────────────────────────────────────────────────────

type openAIProvider struct {
	apiKey  string
	model   string
	baseURL string
}

func newOpenAI(cfg Config) (Summarizer, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("llm: LLM_API_KEY is required for openai provider")
	}
	model := cfg.Model
	if model == "" {
		model = "gpt-4o-mini"
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "https://api.openai.com"
	}
	return &openAIProvider{apiKey: cfg.APIKey, model: model, baseURL: baseURL}, nil
}

func (p *openAIProvider) Provider() string { return "openai" }
func (p *openAIProvider) Model() string    { return p.model }

func (p *openAIProvider) Summarize(ctx context.Context, run *models.HistoryRecord) (string, error) {
	body := map[string]any{
		"model": p.model,
		"messages": []map[string]string{
			{"role": "user", "content": buildPrompt(run)},
		},
		"max_tokens": 300,
	}
	data, err := doPost(ctx, p.baseURL+"/v1/chat/completions",
		map[string]string{"Authorization": "Bearer " + p.apiKey}, body)
	if err != nil {
		return "", err
	}
	var resp struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", fmt.Errorf("llm: parse openai response: %w", err)
	}
	if len(resp.Choices) == 0 {
		return "", fmt.Errorf("llm: openai returned no choices")
	}
	return strings.TrimSpace(resp.Choices[0].Message.Content), nil
}

// ── Anthropic ─────────────────────────────────────────────────

type anthropicProvider struct {
	apiKey  string
	model   string
	baseURL string
}

func newAnthropic(cfg Config) (Summarizer, error) {
	if cfg.APIKey == "" {
		return nil, fmt.Errorf("llm: LLM_API_KEY is required for anthropic provider")
	}
	model := cfg.Model
	if model == "" {
		model = "claude-haiku-4-5-20251001"
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "https://api.anthropic.com"
	}
	return &anthropicProvider{apiKey: cfg.APIKey, model: model, baseURL: baseURL}, nil
}

func (p *anthropicProvider) Provider() string { return "anthropic" }
func (p *anthropicProvider) Model() string    { return p.model }

func (p *anthropicProvider) Summarize(ctx context.Context, run *models.HistoryRecord) (string, error) {
	body := map[string]any{
		"model":      p.model,
		"max_tokens": 300,
		"messages": []map[string]string{
			{"role": "user", "content": buildPrompt(run)},
		},
	}
	data, err := doPost(ctx, p.baseURL+"/v1/messages",
		map[string]string{
			"x-api-key":         p.apiKey,
			"anthropic-version": "2023-06-01",
		}, body)
	if err != nil {
		return "", err
	}
	var resp struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", fmt.Errorf("llm: parse anthropic response: %w", err)
	}
	if len(resp.Content) == 0 {
		return "", fmt.Errorf("llm: anthropic returned no content")
	}
	return strings.TrimSpace(resp.Content[0].Text), nil
}

// ── Ollama ────────────────────────────────────────────────────

type ollamaProvider struct {
	model   string
	baseURL string
}

func newOllama(cfg Config) (Summarizer, error) {
	model := cfg.Model
	if model == "" {
		model = "llama3"
	}
	baseURL := cfg.BaseURL
	if baseURL == "" {
		baseURL = "http://localhost:11434"
	}
	return &ollamaProvider{model: model, baseURL: baseURL}, nil
}

func (p *ollamaProvider) Provider() string { return "ollama" }
func (p *ollamaProvider) Model() string    { return p.model }

func (p *ollamaProvider) Summarize(ctx context.Context, run *models.HistoryRecord) (string, error) {
	body := map[string]any{
		"model":  p.model,
		"stream": false,
		"messages": []map[string]string{
			{"role": "user", "content": buildPrompt(run)},
		},
	}
	data, err := doPost(ctx, p.baseURL+"/api/chat", nil, body)
	if err != nil {
		return "", err
	}
	var resp struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	}
	if err := json.Unmarshal(data, &resp); err != nil {
		return "", fmt.Errorf("llm: parse ollama response: %w", err)
	}
	return strings.TrimSpace(resp.Message.Content), nil
}

// ── Mock (local testing only) ─────────────────────────────────

type mockProvider struct{}

func newMock() Summarizer { return &mockProvider{} }

func (p *mockProvider) Provider() string { return "mock" }
func (p *mockProvider) Model() string    { return "mock-model" }

func (p *mockProvider) Summarize(_ context.Context, run *models.HistoryRecord) (string, error) {
	status := "completed successfully"
	if run.Status == "failed" {
		status = "failed"
	}
	return fmt.Sprintf(
		"[Mock AI Summary] The load test \"%s\" %s in %dms. "+
			"This is a dummy response for local UI testing — set LLM_PROVIDER to openai, anthropic, or ollama to get real AI summaries.",
		run.Config.Name, status, run.DurationMs,
	), nil
}
