// Package metrics exposes Prometheus metrics for Anvil itself —
// not for the target system under test, but for the load testing
// framework's own health (goroutines, memory, active runs, API latency).
package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	// ActiveRuns is the number of k6 subprocesses currently running.
	ActiveRuns = promauto.NewGauge(prometheus.GaugeOpts{
		Name: "anvil_active_runs",
		Help: "Number of k6 test runs currently in progress.",
	})

	// RunsTotal counts completed runs labelled by final status.
	RunsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "anvil_runs_total",
		Help: "Total number of completed k6 runs, partitioned by status.",
	}, []string{"status"})

	// HTTPRequestDuration tracks Anvil API latency per route.
	HTTPRequestDuration = promauto.NewHistogramVec(prometheus.HistogramOpts{
		Name:    "anvil_http_request_duration_seconds",
		Help:    "Duration of HTTP requests handled by the Anvil API.",
		Buckets: prometheus.DefBuckets,
	}, []string{"method", "path", "status"})

	// HTTPRequestsTotal counts API calls per route and status code.
	HTTPRequestsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "anvil_http_requests_total",
		Help: "Total number of HTTP requests handled by the Anvil API.",
	}, []string{"method", "path", "status"})
)
