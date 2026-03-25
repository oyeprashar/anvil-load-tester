import { useState, useCallback, useRef } from 'react';
import type { TestConfig, TestRun, HttpMethod, Suite, SuiteRun, RunStatus } from './types';
import TestConfigForm from './components/TestConfigForm';
import ResultsPanel from './components/ResultsPanel';
import SuiteEditor from './components/SuiteEditor';
import SuiteResultsPanel from './components/SuiteResultsPanel';
import HistoryPanel from './components/HistoryPanel';
import { runTest, abortRun } from './api/testRunner';
import { runSuite } from './api/suiteRunner';

// ─── Default form state ───────────────────────────────────────
const DEFAULT_CONFIG: TestConfig = {
  name: '',
  protocol: 'http',
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

type AppMode = 'single' | 'suite' | 'history';

export default function App() {
  const [mode, setMode] = useState<AppMode>('single');

  // ── Single-test state ──────────────────────────────────────
  const [config, setConfig] = useState<TestConfig>(DEFAULT_CONFIG);
  const [run, setRun]       = useState<TestRun | null>(null);
  const runIdRef            = useRef<string>('');

  const handleRun = useCallback(async () => {
    setRun({ id: '', status: 'running', logs: [], startedAt: new Date() });
    runIdRef.current = '';
    try {
      await runTest(config, (updatedRun) => {
        if (updatedRun.id) runIdRef.current = updatedRun.id;
        setRun({ ...updatedRun });
      });
    } catch (err) {
      setRun(prev => prev ? {
        ...prev, status: 'failed',
        error: err instanceof Error ? err.message : 'Unknown error',
        completedAt: new Date(),
      } : null);
    }
  }, [config]);

  const handleAbort = useCallback(async () => {
    if (runIdRef.current) {
      await abortRun(runIdRef.current);
      setRun(prev => prev ? { ...prev, status: 'failed', error: 'Test aborted by user' } : null);
    }
  }, []);

  const isRunning = run?.status === 'running';

  // ── Suite state ────────────────────────────────────────────
  const [suiteRun, setSuiteRun]     = useState<SuiteRun | null>(null);
  const [suiteRunning, setSuiteRunning] = useState(false);

  const handleRunSuite = useCallback(async (suite: Suite) => {
    setSuiteRunning(true);
    setSuiteRun(null);
    try {
      await runSuite(suite, (updatedRun) => setSuiteRun({ ...updatedRun }));
    } catch (err) {
      console.error('Suite run failed:', err);
    } finally {
      setSuiteRunning(false);
    }
  }, []);

  // Build a node-id → status map for the DAG node overlay
  const suiteNodeStatuses: Record<string, RunStatus> = {};
  suiteRun?.nodeRuns.forEach(nr => {
    suiteNodeStatuses[nr.nodeId] = nr.status;
  });

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
          }}>M3</span>

          {/* Mode switcher */}
          <div style={{
            display: 'flex', marginLeft: 16,
            background: 'var(--bg-raised)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: 2, gap: 2,
          }}>
            {(['single', 'suite', 'history'] as AppMode[]).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'var(--accent)' : 'none',
                  border: 'none', cursor: 'pointer',
                  padding: '4px 12px', borderRadius: 'var(--radius-sm)',
                  fontSize: 11, fontWeight: 600,
                  color: mode === m ? '#fff' : 'var(--text-muted)',
                  textTransform: 'capitalize',
                }}
              >
                {m === 'single' ? 'Single Test' : m === 'suite' ? 'Test Suite' : '📋 History'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {mode === 'single' && run?.status === 'completed' && (
            <span style={{ fontSize: 12, color: 'var(--success)', display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M20 6L9 17l-5-5" strokeLinecap="round" />
              </svg>
              Test passed
            </span>
          )}
          {mode === 'single' && run?.status === 'failed' && (
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

      {/* ── Single test layout ── */}
      {mode === 'single' && (
        <div style={{
          display: 'grid', gridTemplateColumns: '420px 1fr',
          flex: 1, overflow: 'hidden',
        }}>
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
          <main style={{ overflowY: 'auto', padding: '16px', background: 'var(--bg-base)' }}>
            <ResultsPanel run={run} onAbort={handleAbort} />
          </main>
        </div>
      )}

      {/* ── Suite layout ── */}
      {mode === 'suite' && (
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 360px',
          flex: 1, overflow: 'hidden',
        }}>
          {/* DAG canvas */}
          <div style={{ overflow: 'hidden', borderRight: '1px solid var(--border)' }}>
            <SuiteEditor
              suiteRunNodeStatuses={suiteRunning || suiteRun ? suiteNodeStatuses : undefined}
              onRunSuite={handleRunSuite}
              isRunning={suiteRunning}
            />
          </div>
          {/* Suite results */}
          <div style={{ overflowY: 'auto', padding: '16px', background: 'var(--bg-base)' }}>
            <SuiteResultsPanel suiteRun={suiteRun} />
          </div>
        </div>
      )}

      {/* ── History layout ── */}
      {mode === 'history' && (
        <div style={{ flex: 1, overflow: 'hidden', background: 'var(--bg-base)' }}>
          <HistoryPanel />
        </div>
      )}
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
