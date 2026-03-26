import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import type { MetricsSummary } from '../types';

interface Props {
  metrics: MetricsSummary;
  compact?: boolean; // smaller card layout for history list
}

const ACCENT  = '#4f6ef7';
const SUCCESS = '#22c55e';
const WARNING = '#f59e0b';
const ERROR   = '#ef4444';

function statCard(label: string, value: string, sub?: string, color = 'var(--text)') {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 16px',
      minWidth: 110,
      flex: '1 1 110px',
    }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default function MetricsChart({ metrics, compact }: Props) {
  const { httpReqDuration: d, httpReqRate: r, httpReqFailed: f, vusMax, iterations } = metrics;

  const latencyData = [
    { name: 'p50',  value: d.p50 },
    { name: 'avg',  value: d.avg },
    { name: 'p95',  value: d.p95 },
    { name: 'p99',  value: d.p99 },
  ];

  const barColor = (name: string) => {
    if (name === 'p99') return ERROR;
    if (name === 'p95') return WARNING;
    return ACCENT;
  };

  const errorPct = (f.rate * 100).toFixed(2);
  const errorColor = f.rate > 0.05 ? ERROR : f.rate > 0.01 ? WARNING : SUCCESS;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stat cards row */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {statCard('p95 latency',   `${d.p95} ms`)}
        {statCard('req / s',       r.rate.toFixed(1))}
        {statCard('total reqs',    r.total.toLocaleString())}
        {statCard('error rate',    `${errorPct}%`, undefined, errorColor)}
        {!compact && statCard('peak VUs', String(vusMax))}
        {!compact && statCard('iterations', iterations.toLocaleString())}
      </div>

      {/* Latency bar chart */}
      {!compact && (
        <div style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '16px 12px 8px',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
            Latency percentiles (ms)
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={latencyData} margin={{ top: 0, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" tick={{ fontSize: 12, fill: 'var(--text-muted)' }} />
              <YAxis tick={{ fontSize: 11, fill: 'var(--text-muted)' }} unit=" ms" />
              <Tooltip
                formatter={(v: number) => [`${v} ms`, 'latency']}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {latencyData.map((entry) => (
                  <Cell key={entry.name} fill={barColor(entry.name)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
