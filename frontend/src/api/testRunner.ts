/**
 * testRunner.ts
 *
 * Connects the Anvil UI to the Go backend.
 *
 * Endpoints (all proxied through nginx in Docker, or hit directly on :8080 in dev):
 *   POST   /api/test/run            → { runId: string }
 *   GET    /api/test/:id/stream     → SSE stream of log lines + final "done" event
 *   GET    /api/test/:id/report     → { id, status, metrics, error, ... }
 *   DELETE /api/test/:id            → cancels a running test
 */

import type { TestConfig, TestRun, MetricsSummary } from '../types';

type OnUpdate = (run: TestRun) => void;

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function runTest(config: TestConfig, onUpdate: OnUpdate): Promise<void> {
  const id = await startRun(config);
  const startedAt = new Date();

  onUpdate({ id, status: 'running', logs: [], startedAt });

  await streamLogs(id, startedAt, onUpdate);
}

// ── Step 1: POST the config, get a run ID ─────────────────────

async function startRun(config: TestConfig): Promise<string> {
  const res = await fetch(`${API_BASE}/api/test/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to start run');
  }

  const { runId } = await res.json();
  return runId;
}

// ── Step 2: Subscribe to the SSE stream ───────────────────────

function streamLogs(id: string, startedAt: Date, onUpdate: OnUpdate): Promise<void> {
  return new Promise((resolve, reject) => {
    const logs: string[] = [];
    const es = new EventSource(`${API_BASE}/api/test/${id}/stream`);

    es.onmessage = (e) => {
      logs.push(e.data);
      onUpdate({ id, status: 'running', logs: [...logs], startedAt });
    };

    // The backend sends a named "done" event when k6 finishes
    es.addEventListener('done', async (e: MessageEvent) => {
      es.close();
      try {
        const donePayload = JSON.parse(e.data ?? '{}');
        const report = await fetchReport(id);
        const status = report.status === 'completed' ? 'completed' : 'failed';

        onUpdate({
          id,
          status,
          logs: [...logs],
          metrics: report.metrics,
          error: donePayload.error || report.error,
          startedAt,
          completedAt: new Date(),
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    es.onerror = () => {
      es.close();
      reject(new Error('Lost connection to backend stream'));
    };
  });
}

// ── Abort: DELETE the run ─────────────────────────────────────

export async function abortRun(id: string): Promise<void> {
  await fetch(`${API_BASE}/api/test/${id}`, { method: 'DELETE' });
  // We don't throw on error — the SSE stream will surface the final state.
}

// ── Step 3: Fetch the final report ────────────────────────────

async function fetchReport(id: string): Promise<{
  status: 'completed' | 'failed';
  metrics?: MetricsSummary;
  error?: string;
}> {
  const res = await fetch(`${API_BASE}/api/test/${id}/report`);
  if (!res.ok) throw new Error('Failed to fetch report');
  return res.json();
}
