import type { SuiteRun, SuiteNodeRun, RunStatus, SuiteNode } from '../types';

interface Props {
  suiteRun: SuiteRun | null;
}

const STATUS_COLOR: Record<RunStatus, string> = {
  idle:      'var(--text-muted)',
  pending:   'var(--text-muted)',
  running:   'var(--warning)',
  completed: 'var(--success)',
  failed:    'var(--error)',
  skipped:   '#6b7280',
};

const STATUS_ICON: Record<RunStatus, string> = {
  idle:      '○',
  pending:   '○',
  running:   '⟳',
  completed: '✓',
  failed:    '✗',
  skipped:   '⤼',
};

export default function SuiteResultsPanel({ suiteRun }: Props) {
  if (!suiteRun) return <EmptyState />;

  const nodeById = new Map<string, SuiteNode>(
    suiteRun.suite.nodes.map(n => [n.id, n]),
  );

  const total     = suiteRun.nodeRuns.length;
  const completed = suiteRun.nodeRuns.filter(nr => nr.status === 'completed').length;
  const failed    = suiteRun.nodeRuns.filter(nr => nr.status === 'failed').length;
  const skipped   = suiteRun.nodeRuns.filter(nr => nr.status === 'skipped').length;
  const running   = suiteRun.nodeRuns.filter(nr => nr.status === 'running').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, height: '100%' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Suite status bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: '12px 16px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusDot status={suiteRun.status} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
            {suiteRun.suite.name}
          </span>
          <span className={`badge badge-${suiteRun.status}`}>{suiteRun.status}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {suiteRun.startedAt instanceof Date
            ? suiteRun.startedAt.toLocaleTimeString()
            : new Date(suiteRun.startedAt).toLocaleTimeString()}
        </span>
      </div>

      {/* ── Progress summary ── */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8,
      }}>
        {[
          { label: 'Completed', value: completed, color: 'var(--success)' },
          { label: 'Failed',    value: failed,    color: 'var(--error)' },
          { label: 'Skipped',   value: skipped,   color: '#6b7280' },
          { label: 'Running',   value: running,   color: 'var(--warning)' },
        ].map(c => (
          <div key={c.label} style={{
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', padding: '8px 12px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: c.color, fontFamily: 'var(--font-mono)' }}>
              {c.value}
            </div>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {c.label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Progress bar ── */}
      <div style={{
        height: 6, background: 'var(--bg-surface)', borderRadius: 3,
        border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <div style={{
          height: '100%',
          width: `${total ? (completed + failed + skipped) / total * 100 : 0}%`,
          background: failed > 0 ? 'var(--error)' : 'var(--success)',
          transition: 'width 0.4s ease',
        }} />
      </div>

      {/* ── Node list ── */}
      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {suiteRun.nodeRuns.map(nr => (
          <NodeRow
            key={nr.nodeId}
            nodeRun={nr}
            node={nodeById.get(nr.nodeId)}
          />
        ))}
      </div>
    </div>
  );
}

function NodeRow({ nodeRun, node }: { nodeRun: SuiteNodeRun; node?: SuiteNode }) {
  const cfg = node?.testConfig;
  const protocol = cfg?.protocol ?? 'http';
  const status = nodeRun.status;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      background: 'var(--bg-surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '10px 14px',
      borderLeft: `3px solid ${STATUS_COLOR[status]}`,
    }}>
      {/* Status icon */}
      <span style={{
        fontSize: 14, fontWeight: 700, color: STATUS_COLOR[status], width: 14, textAlign: 'center',
        animation: status === 'running' ? 'spin 1s linear infinite' : 'none',
        display: 'inline-block',
      }}>
        {STATUS_ICON[status]}
      </span>

      {/* Name + protocol */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {cfg?.name || <span style={{ fontStyle: 'italic', color: 'var(--text-muted)' }}>Unnamed</span>}
          {node?.isGate && (
            <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: 'var(--error)',
              background: '#ef444422', border: '1px solid var(--error)',
              borderRadius: 3, padding: '1px 4px', letterSpacing: '0.06em' }}>
              GATE
            </span>
          )}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
          {protocol.toUpperCase()} · {cfg?.stages?.map(s => `${s.target}VU/${s.duration}`).join(' → ')}
        </div>
        {nodeRun.error && (
          <div style={{ fontSize: 10, color: 'var(--error)', marginTop: 3,
            fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {nodeRun.error}
          </div>
        )}
      </div>

      {/* Run ID link (open HTML report if available) */}
      {nodeRun.runId && (nodeRun.status === 'completed' || nodeRun.status === 'failed') && (
        <a
          href={`http://localhost:8080/api/test/${nodeRun.runId}/html-report`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0, textDecoration: 'none' }}
        >
          Report ↗
        </a>
      )}

      <span className={`badge badge-${status}`} style={{ flexShrink: 0, fontSize: 10 }}>
        {status}
      </span>
    </div>
  );
}

function StatusDot({ status }: { status: RunStatus }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: STATUS_COLOR[status],
      boxShadow: status === 'running' ? `0 0 6px ${STATUS_COLOR[status]}` : undefined,
      animation: status === 'running' ? 'pulse 1s ease-in-out infinite' : undefined,
    }} />
  );
}

function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100%', gap: 14,
      color: 'var(--text-muted)', textAlign: 'center', padding: 40,
    }}>
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" style={{ opacity: 0.25 }}>
        <circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/>
        <path d="M8 12h8M16.5 6.5l-9 4M16.5 17.5l-9-4"/>
      </svg>
      <div>
        <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
          No suite run yet
        </p>
        <p style={{ fontSize: 12 }}>
          Build your DAG on the left and click Run Suite.
        </p>
      </div>
    </div>
  );
}
