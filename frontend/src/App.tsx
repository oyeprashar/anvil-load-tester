import { useState, useCallback, useRef } from 'react';
import type { TestConfig, TestRun, HttpMethod } from './types';
import TestConfigForm from './components/TestConfigForm';
import ResultsPanel from './components/ResultsPanel';
import { runTest, abortRun } from './api/testRunner';

// ─── Default form state ───────────────────────────────────────
const DEFAULT_CONFIG: TestConfig = {
  name: '',
  baseUrl: '',
  method: 'GET' as HttpMethod,
  path: '/',
  headers: [],
  body: '',
  stages: [
    { id: 'stage-1', duration: '30s', target: 10 },
    { id: 'stage-2', duration: '1m',  target: 50 },
    { id: 'stage-3', duration: '30s', target: 0  },
  ],
  thresholds: [
    { id: 'thr-1', metric: 'http_req_duration', condition: 'p(95)<500' },
    { id: 'thr-2', metric: 'http_req_failed',   condition: 'rate<0.01'  },
  ],
};

export default function App() {
  const [config, setConfig] = useState<TestConfig>(DEFAULT_CONFIG);
  const [run, setRun]       = useState<TestRun | null>(null);
  const runIdRef            = useRef<string>('');

  const handleRun = useCallback(async () => {
    setRun({ id: '', status: 'running', logs: [], startedAt: new Date() });
    runIdRef.current = '';
    try {
      await runTest(config, (updatedRun) => {
        // Capture the run ID as soon as we get it so abort can use it
        if (updatedRun.id) runIdRef.current = updatedRun.id;
        setRun({ ...updatedRun });
      });
    } catch (err) {
      setRun(prev => prev ? {
        ...prev,
        status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completedAt: new Date(),
      } : null);
    }
  }, [config]);

  const handleAbort = useCallback(async () => {
    if (runIdRef.current) {
      await abortRun(runIdRef.current);
      // The SSE "done" event will update the run state automatically.
      // Optimistically mark it so the button disappears immediately.
      setRun(prev => prev ? { ...prev, status: 'failed', error: 'Test aborted by user' } : null);
    }
  }, []);

  const isRunning = run?.status === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 24px', height: 52,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <LogoIcon />
          <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            <span style={{ color: 'var(--accent)' }}>Anvil</span>
          </span>
          <span style={{
            fontSize: 10, fontWeight: 600, color: 'var(--text-muted)',
            background: 'var(--bg-raised)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '2px 6px', letterSpacing: '0.05em',
          }}>M1</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {run?.status === 'completed' && (
            <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
              </svg>
              Test passed
            </span>
          )}
          {run?.status === 'failed' && (
            <span style={{ fontSize: 12, color: 'var(--error)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
              </svg>
              Test failed
            </span>
          )}
          <a
            href="https://grafana.com/docs/k6/latest/"
            target="_blank" rel="noopener noreferrer"
            style={{ fontSize: 12, color: 'var(--text-muted)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 5 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>
            </svg>
            k6 docs
          </a>
        </div>
      </header>

      {/* ── Main split layout ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: '420px 1fr',
        flex: 1, overflow: 'hidden',
      }}>

        {/* Left: Config form */}
        <aside style={{
          borderRight: '1px solid var(--border)',
          overflowY: 'auto', padding: '16px',
          background: 'var(--bg-base)',
        }}>
          <TestConfigForm
            config={config}
            onChange={setConfig}
            onRun={handleRun}
            isRunning={isRunning}
          />
        </aside>

        {/* Right: Results */}
        <main style={{
          overflowY: 'auto', padding: '16px',
          background: 'var(--bg-base)',
        }}>
          <ResultsPanel run={run} onAbort={handleAbort} />
        </main>
      </div>
    </div>
  );
}

function LogoIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect width="24" height="24" rx="6" fill="var(--accent)" fillOpacity="0.15" />
      <path d="M7 17l3-6 2 4 2-7 3 9" stroke="var(--accent)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
