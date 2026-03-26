import { useState, useEffect } from 'react';
import type { HistoryRecord } from '../types';
import { fetchRuns } from '../api/history';
import MetricsChart from './MetricsChart';
import ComparisonView from './ComparisonView';

const PROTOCOL_COLOR: Record<string, string> = {
  http: '#22c55e', grpc: '#3b82f6', kafka: '#f59e0b', redis: '#ef4444',
};

const STATUS_COLOR: Record<string, string> = {
  completed: '#22c55e', failed: '#ef4444', running: '#f59e0b',
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

function targetLabel(r: HistoryRecord): string {
  const cfg = r.config;
  if (cfg.grpcConfig?.host)        return cfg.grpcConfig.host;
  if (cfg.kafkaConfig?.brokers?.[0]) return cfg.kafkaConfig.brokers[0];
  if (cfg.redisConfig?.addr)       return cfg.redisConfig.addr;
  return cfg.baseUrl || '—';
}

export default function HistoryPanel() {
  const [records, setRecords]     = useState<HistoryRecord[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [selected, setSelected]   = useState<string | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]); // max 2

  useEffect(() => {
    fetchRuns()
      .then(setRecords)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  function toggleCompare(id: string) {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2)  return prev; // already 2 selected
      return [...prev, id];
    });
  }

  const selectedRecord  = records.find(r => r.id === selected);
  const compareRecords  = records.filter(r => compareIds.includes(r.id));
  const showComparison  = compareIds.length === 2;

  const detailContent = () => {
    if (showComparison) {
      return <ComparisonView a={compareRecords[0]} b={compareRecords[1]} />;
    }
    if (selectedRecord?.metrics) {
      return (
        <div style={{ padding: 20 }}>
          <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>
              {selectedRecord.config.name || 'Unnamed run'}
            </span>
            <span style={{
              fontSize: 11, padding: '2px 8px', borderRadius: 10,
              background: PROTOCOL_COLOR[selectedRecord.config.protocol ?? 'http'] + '22',
              color: PROTOCOL_COLOR[selectedRecord.config.protocol ?? 'http'],
              fontWeight: 600,
            }}>
              {(selectedRecord.config.protocol ?? 'http').toUpperCase()}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {timeAgo(selectedRecord.createdAt)} · {formatDuration(selectedRecord.durationMs)}
            </span>
          </div>
          <MetricsChart metrics={selectedRecord.metrics} />
        </div>
      );
    }
    if (selectedRecord && !selectedRecord.metrics) {
      return (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
          {selectedRecord.status === 'failed'
            ? `Test failed: ${selectedRecord.error || 'unknown error'}`
            : 'No metrics available for this run.'}
        </div>
      );
    }
    return (
      <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
        {compareIds.length === 1
          ? 'Select one more run to compare.'
          : 'Select a run to view its metrics.'}
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left: run list ──────────────────────────────────── */}
      <div style={{
        width: 360, minWidth: 300, borderRight: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>Run History</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {compareIds.length > 0 && (
              <button
                onClick={() => setCompareIds([])}
                style={{
                  fontSize: 11, padding: '3px 8px', borderRadius: 6,
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                Clear compare
              </button>
            )}
            {compareIds.length === 1 && (
              <span style={{ fontSize: 11, color: '#f59e0b' }}>Select 1 more to compare</span>
            )}
          </div>
        </div>

        {loading && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading…
          </div>
        )}
        {error && (
          <div style={{ padding: 16, color: '#ef4444', fontSize: 13 }}>Error: {error}</div>
        )}
        {!loading && records.length === 0 && (
          <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
            No runs yet. Start a test to see history.
          </div>
        )}

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {records.map(rec => {
            const proto = rec.config.protocol ?? 'http';
            const isSelected = selected === rec.id;
            const isCompared = compareIds.includes(rec.id);
            const statusColor = STATUS_COLOR[rec.status] ?? 'var(--text-muted)';

            return (
              <div
                key={rec.id}
                onClick={() => { setSelected(rec.id); if (showComparison) setCompareIds([]); }}
                style={{
                  padding: '10px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  background: isSelected ? 'var(--surface)' : 'transparent',
                  borderLeft: isSelected ? '3px solid var(--accent)' : '3px solid transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  {/* Compare checkbox */}
                  <input
                    type="checkbox"
                    checked={isCompared}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleCompare(rec.id)}
                    disabled={!isCompared && compareIds.length >= 2}
                    style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                    title="Select for comparison"
                  />
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 8,
                    background: PROTOCOL_COLOR[proto] + '22',
                    color: PROTOCOL_COLOR[proto],
                  }}>
                    {proto.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rec.config.name || 'Unnamed'}
                  </span>
                  <span style={{ fontSize: 10, color: statusColor, fontWeight: 600 }}>
                    {rec.status.toUpperCase()}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-muted)', paddingLeft: 22 }}>
                  <span>{targetLabel(rec)}</span>
                  {rec.metrics && (
                    <>
                      <span>p95: {rec.metrics.httpReqDuration.p95} ms</span>
                      <span>{rec.metrics.httpReqRate.rate.toFixed(1)} req/s</span>
                    </>
                  )}
                  <span style={{ marginLeft: 'auto' }}>{timeAgo(rec.createdAt)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Right: detail / comparison ──────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {detailContent()}
      </div>
    </div>
  );
}
