import { useEffect, useRef, useState } from 'react';
import type { TestRun, MetricsSummary } from '../types';

// k6 web dashboard always binds on this port (mapped in docker-compose).
const DASHBOARD_URL = 'http://localhost:5665';

interface Props {
  run: TestRun | null;
  onAbort?: () => void;
}

type Tab = 'dashboard' | 'logs';

// How long to wait before mounting the iframe, giving k6's dashboard
// HTTP server time to start listening on port 5665.
const DASHBOARD_BOOT_MS = 2500;

export default function ResultsPanel({ run, onAbort }: Props) {
  const logRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<Tab>('dashboard');
  const [dashboardReady, setDashboardReady] = useState(false);

  // Auto-scroll logs to bottom as they stream in
  useEffect(() => {
    if (tab === 'logs' && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [run?.logs.length, tab]);

  // Switch to dashboard tab automatically when a test starts, and
  // delay mounting the iframe until k6's dashboard server is up.
  useEffect(() => {
    if (run?.status === 'running') {
      setTab('dashboard');
      setDashboardReady(false);
      const t = setTimeout(() => setDashboardReady(true), DASHBOARD_BOOT_MS);
      return () => clearTimeout(t);
    }
  }, [run?.id]);

  if (!run) return <EmptyState />;

  const htmlReportUrl = `http://localhost:8080/api/test/${run.id}/html-report`;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: 12 }}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>

      {/* ── Status bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '12px 16px',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={run.status} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
            {STATUS_LABELS[run.status]}
          </span>
          <span className={`badge badge-${run.status}`}>{run.status}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* HTML report link — shown once the run has an ID (report written on completion) */}
          {(run.status === 'completed' || run.status === 'failed') && run.id && (
            <a
              href={htmlReportUrl}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontSize: 11, color: 'var(--accent)', textDecoration: 'none',
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', border: '1px solid rgba(79,110,247,0.35)',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/>
                <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
              HTML Report
            </a>
          )}
          {run.startedAt && (
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              {run.status === 'running' ? 'Started' : 'Completed'}{' '}
              {run.startedAt.toLocaleTimeString()}
            </span>
          )}
          {run.status === 'running' && onAbort && (
            <button
              onClick={onAbort}
              className="btn-ghost"
              style={{ fontSize: 11, padding: '4px 10px', color: 'var(--error)', borderColor: 'rgba(239,68,68,0.35)' }}
            >
              ■ Abort
            </button>
          )}
        </div>
      </div>

      {/* ── Metrics cards (only when completed) ── */}
      {run.status === 'completed' && run.metrics && (
        <MetricsGrid metrics={run.metrics} />
      )}

      {/* ── Error box ── */}
      {run.status === 'failed' && run.error && (
        <div style={{
          background: 'var(--error-bg)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 'var(--radius-md)', padding: '12px 14px',
          fontSize: 12, color: 'var(--error)', fontFamily: 'var(--font-mono)',
          flexShrink: 0,
        }}>
          {run.error}
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: 2, flexShrink: 0,
        borderBottom: '1px solid var(--border)', paddingBottom: 0,
      }}>
        {(['dashboard', 'logs'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '6px 14px', fontSize: 12, fontWeight: 600,
              color: tab === t ? 'var(--accent)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1, textTransform: 'capitalize', letterSpacing: '0.03em',
            }}
          >
            {t === 'dashboard' ? '📊 Live Dashboard' : '📋 Logs'}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>

        {/* Dashboard iframe */}
        {tab === 'dashboard' && (
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            {run.status === 'running' ? (
              dashboardReady ? (
                <iframe
                  src={DASHBOARD_URL}
                  style={{
                    width: '100%', height: '100%', minHeight: 480,
                    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                    background: '#fff',
                  }}
                  title="k6 Live Dashboard"
                />
              ) : (
                <div style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center',
                  justifyContent: 'center', height: 480, gap: 14,
                  border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                  color: 'var(--text-muted)', fontSize: 13,
                }}>
                  <span style={{
                    display: 'inline-block', width: 28, height: 28,
                    border: '3px solid var(--border)',
                    borderTopColor: 'var(--accent)',
                    borderRadius: '50%',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                  Starting dashboard…
                </div>
              )
            ) : (
              <div style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', height: 300, gap: 12,
                color: 'var(--text-muted)', fontSize: 13,
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
              }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.3 }}>
                  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M9 21V9"/>
                </svg>
                <span>Dashboard available during active test runs</span>
                {(run.status === 'completed' || run.status === 'failed') && run.id && (
                  <a href={htmlReportUrl} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 12, color: 'var(--accent)' }}>
                    Open the HTML report instead →
                  </a>
                )}
              </div>
            )}
          </div>
        )}

        {/* Log output */}
        {tab === 'logs' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <div style={{
              fontSize: 11, fontWeight: 700, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: 'var(--text-muted)',
              marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8,
            }}>
              Output
              {run.status === 'running' && (
                <span style={{
                  display: 'inline-block', width: 6, height: 6,
                  borderRadius: '50%', background: 'var(--warning)',
                  animation: 'pulse 1s ease-in-out infinite',
                }} />
              )}
              <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            </div>
            <div
              ref={logRef}
              style={{
                flex: 1, background: '#0a0c12',
                border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
                padding: '12px 14px', fontFamily: 'var(--font-mono)',
                fontSize: 12, lineHeight: 1.7, overflowY: 'auto',
                minHeight: 240, color: 'var(--text-secondary)',
              }}
            >
              {run.logs.length === 0 ? (
                <span style={{ color: 'var(--text-muted)' }}>Waiting for output...</span>
              ) : (
                run.logs.map((line, i) => <LogLine key={i} line={line} />)
              )}
              {run.status === 'running' && (
                <span style={{ color: 'var(--accent)', opacity: 0.7 }}>█</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 14,
      color: 'var(--text-muted)', textAlign: 'center', padding: 40,
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.3 }}>
        <path d="M22 12h-4l-3 9L9 3l-3 9H2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          No test run yet
        </p>
        <p style={{ fontSize: 12 }}>
          Configure your test on the left and hit Run to see results here.
        </p>
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: TestRun['status'] }) {
  const colors: Record<TestRun['status'], string> = {
    idle:      'var(--text-muted)',
    running:   'var(--warning)',
    completed: 'var(--success)',
    failed:    'var(--error)',
  };
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: colors[status],
      boxShadow: status === 'running' ? `0 0 6px var(--warning)` : undefined,
      animation: status === 'running' ? 'pulse 1s ease-in-out infinite' : undefined,
    }} />
  );
}

const STATUS_LABELS: Record<TestRun['status'], string> = {
  idle:      'Idle',
  running:   'Test running',
  completed: 'Test completed',
  failed:    'Test failed',
};

function MetricsGrid({ metrics }: { metrics: MetricsSummary }) {
  const cards = [
    { label: 'p50 Response',  value: `${metrics.httpReqDuration.p50}ms`, color: 'var(--success)' },
    { label: 'p95 Response',  value: `${metrics.httpReqDuration.p95}ms`, color: 'var(--warning)' },
    { label: 'p99 Response',  value: `${metrics.httpReqDuration.p99}ms`, color: 'var(--error)' },
    { label: 'Avg Response',  value: `${metrics.httpReqDuration.avg}ms`, color: 'var(--text-secondary)' },
    { label: 'Req/s',         value: metrics.httpReqRate.rate.toFixed(1),  color: 'var(--accent)' },
    { label: 'Total Requests',value: metrics.httpReqRate.total.toLocaleString(), color: 'var(--text-secondary)' },
    { label: 'Error Rate',    value: `${(metrics.httpReqFailed.rate * 100).toFixed(2)}%`,
      color: metrics.httpReqFailed.rate > 0.01 ? 'var(--error)' : 'var(--success)' },
    { label: 'Peak VUs',      value: metrics.vusMax.toString(),  color: 'var(--accent)' },
  ];

  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
    }}>
      {cards.map(c => (
        <div key={c.label} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)', padding: '10px 12px',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
            {c.label}
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: c.color, fontFamily: 'var(--font-mono)' }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  // Colour-code log lines by content
  let color = 'var(--text-secondary)';
  if (line.includes('✓') || line.includes('passed') || line.includes('✔')) color = 'var(--success)';
  else if (line.includes('✗') || line.includes('failed') || line.includes('ERRO')) color = 'var(--error)';
  else if (line.includes('WARN')) color = 'var(--warning)';
  else if (line.startsWith('  default')) color = 'var(--accent)';
  else if (line.includes('running') || line.includes('iteration')) color = 'var(--text-primary)';

  return <div style={{ color }}>{line}</div>;
}
