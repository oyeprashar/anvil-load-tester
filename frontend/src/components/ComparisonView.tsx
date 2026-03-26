import type { HistoryRecord, MetricsSummary } from '../types';

interface Props {
  a: HistoryRecord;
  b: HistoryRecord;
}

function delta(aVal: number, bVal: number, lowerIsBetter = true): { pct: string; color: string } {
  if (aVal === 0) return { pct: '—', color: 'var(--text-muted)' };
  const pct = ((bVal - aVal) / aVal) * 100;
  const improved = lowerIsBetter ? pct < 0 : pct > 0;
  return {
    pct: (pct > 0 ? '+' : '') + pct.toFixed(1) + '%',
    color: Math.abs(pct) < 1 ? 'var(--text-muted)' : improved ? '#22c55e' : '#ef4444',
  };
}

interface RowProps {
  label: string;
  aVal: string;
  bVal: string;
  raw_a: number;
  raw_b: number;
  lowerIsBetter?: boolean;
}

function MetricRow({ label, aVal, bVal, raw_a, raw_b, lowerIsBetter = true }: RowProps) {
  const d = delta(raw_a, raw_b, lowerIsBetter);
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={{ padding: '9px 12px', fontSize: 13, color: 'var(--text-muted)' }}>{label}</td>
      <td style={{ padding: '9px 12px', fontSize: 14, fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{aVal}</td>
      <td style={{ padding: '9px 12px', fontSize: 14, fontWeight: 500, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{bVal}</td>
      <td style={{ padding: '9px 12px', fontSize: 13, fontWeight: 600, textAlign: 'right', color: d.color }}>{d.pct}</td>
    </tr>
  );
}

function RunHeader({ rec, label }: { rec: HistoryRecord; label: string }) {
  const proto = rec.config.protocol ?? 'http';
  const PROTO_COLOR: Record<string, string> = {
    http: '#22c55e', grpc: '#3b82f6', kafka: '#f59e0b', redis: '#ef4444',
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{
        fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 8,
        background: PROTO_COLOR[proto] + '22', color: PROTO_COLOR[proto],
      }}>
        {label}
      </span>
      <span style={{ fontWeight: 600, fontSize: 14 }}>{rec.config.name || 'Unnamed'}</span>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        {new Date(rec.createdAt).toLocaleString()}
      </span>
    </div>
  );
}

function noMetrics(rec: HistoryRecord) {
  return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
      No metrics for this run ({rec.status}).
    </div>
  );
}

export default function ComparisonView({ a, b }: Props) {
  if (!a.metrics || !b.metrics) {
    if (!a.metrics) return noMetrics(a);
    return noMetrics(b);
  }

  const am: MetricsSummary = a.metrics;
  const bm: MetricsSummary = b.metrics;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 24 }}>
        <RunHeader rec={a} label="A" />
        <span style={{ color: 'var(--text-muted)', fontSize: 14 }}>vs</span>
        <RunHeader rec={b} label="B" />
      </div>

      <div style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        overflow: 'hidden',
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
              <th style={{ padding: '8px 12px', textAlign: 'left',  fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>METRIC</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>A</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>B</th>
              <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>DELTA</th>
            </tr>
          </thead>
          <tbody>
            <MetricRow label="p50 latency"  aVal={`${am.httpReqDuration.p50} ms`}  bVal={`${bm.httpReqDuration.p50} ms`}  raw_a={am.httpReqDuration.p50}  raw_b={bm.httpReqDuration.p50} />
            <MetricRow label="p95 latency"  aVal={`${am.httpReqDuration.p95} ms`}  bVal={`${bm.httpReqDuration.p95} ms`}  raw_a={am.httpReqDuration.p95}  raw_b={bm.httpReqDuration.p95} />
            <MetricRow label="p99 latency"  aVal={`${am.httpReqDuration.p99} ms`}  bVal={`${bm.httpReqDuration.p99} ms`}  raw_a={am.httpReqDuration.p99}  raw_b={bm.httpReqDuration.p99} />
            <MetricRow label="avg latency"  aVal={`${am.httpReqDuration.avg} ms`}  bVal={`${bm.httpReqDuration.avg} ms`}  raw_a={am.httpReqDuration.avg}  raw_b={bm.httpReqDuration.avg} />
            <MetricRow label="req / s"      aVal={am.httpReqRate.rate.toFixed(1)}   bVal={bm.httpReqRate.rate.toFixed(1)}   raw_a={am.httpReqRate.rate}      raw_b={bm.httpReqRate.rate}      lowerIsBetter={false} />
            <MetricRow label="total reqs"   aVal={am.httpReqRate.total.toLocaleString()} bVal={bm.httpReqRate.total.toLocaleString()} raw_a={am.httpReqRate.total} raw_b={bm.httpReqRate.total} lowerIsBetter={false} />
            <MetricRow label="error rate"   aVal={`${(am.httpReqFailed.rate * 100).toFixed(2)}%`} bVal={`${(bm.httpReqFailed.rate * 100).toFixed(2)}%`} raw_a={am.httpReqFailed.rate} raw_b={bm.httpReqFailed.rate} />
            <MetricRow label="peak VUs"     aVal={String(am.vusMax)}                bVal={String(bm.vusMax)}                raw_a={am.vusMax}               raw_b={bm.vusMax}               lowerIsBetter={false} />
          </tbody>
        </table>
      </div>
    </div>
  );
}
