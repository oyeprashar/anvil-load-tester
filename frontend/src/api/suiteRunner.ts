/**
 * suiteRunner.ts
 *
 * Connects the Anvil suite UI to the Go backend.
 *
 * Endpoints:
 *   POST /api/suite/run          → { suiteRunId: string }
 *   GET  /api/suite/:id/status   → SuiteRun snapshot
 *   GET  /api/suite/:id/stream   → SSE of SuiteEvents + final "done" event
 */

import type { Suite, SuiteRun, SuiteEvent, SuiteNodeRun, RunStatus } from '../types';

type OnUpdate = (run: SuiteRun) => void;

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export async function runSuite(suite: Suite, onUpdate: OnUpdate): Promise<void> {
  const id = await startSuiteRun(suite);
  const startedAt = new Date();

  // Build initial pending state
  const initial: SuiteRun = {
    id,
    suite,
    status: 'running',
    nodeRuns: suite.nodes.map(n => ({ nodeId: n.id, status: 'pending' })),
    startedAt,
  };
  onUpdate(initial);

  await streamSuiteEvents(id, initial, onUpdate);
}

async function startSuiteRun(suite: Suite): Promise<string> {
  const res = await fetch(`${API_BASE}/api/suite/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(suite),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Failed to start suite');
  }
  const { suiteRunId } = await res.json();
  return suiteRunId;
}

function streamSuiteEvents(
  id: string,
  initial: SuiteRun,
  onUpdate: OnUpdate,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Deep-clone so we can mutate locally
    const run: SuiteRun = JSON.parse(JSON.stringify(initial));
    const nodeRunMap = new Map<string, SuiteNodeRun>(
      run.nodeRuns.map(nr => [nr.nodeId, nr]),
    );

    const es = new EventSource(`${API_BASE}/api/suite/${id}/stream`);

    es.onmessage = (e) => {
      try {
        const event: SuiteEvent = JSON.parse(e.data);
        if (event.type === 'node_update' && event.nodeRun) {
          const nr = nodeRunMap.get(event.nodeRun.nodeId);
          if (nr) {
            nr.status  = event.nodeRun.status;
            nr.runId   = event.nodeRun.runId;
            nr.error   = event.nodeRun.error;
          }
          onUpdate({ ...run, nodeRuns: [...run.nodeRuns] });
        }
      } catch {
        // non-JSON heartbeat comment — ignore
      }
    };

    es.addEventListener('done', async (e: MessageEvent) => {
      es.close();
      try {
        const payload: SuiteEvent = JSON.parse(e.data ?? '{}');
        // Fetch final snapshot for accurate status
        const snap = await fetchSuiteStatus(id);
        onUpdate({
          ...run,
          status: (payload.status ?? snap?.status ?? 'failed') as RunStatus,
          nodeRuns: snap?.nodeRuns ?? run.nodeRuns,
          completedAt: new Date(),
        });
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    es.onerror = () => {
      es.close();
      reject(new Error('Lost connection to suite stream'));
    };
  });
}

async function fetchSuiteStatus(id: string): Promise<SuiteRun | null> {
  const res = await fetch(`${API_BASE}/api/suite/${id}/status`);
  if (!res.ok) return null;
  return res.json();
}
