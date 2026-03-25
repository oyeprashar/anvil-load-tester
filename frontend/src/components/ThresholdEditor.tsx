import type { Threshold } from '../types';

interface Props {
  thresholds: Threshold[];
  onChange: (thresholds: Threshold[]) => void;
}

function genId() { return Math.random().toString(36).slice(2, 9); }

const METRIC_OPTIONS = [
  { value: 'http_req_duration', label: 'Response time' },
  { value: 'http_req_failed',   label: 'Error rate' },
  { value: 'http_reqs',         label: 'Request rate' },
] as const;

// Sensible default conditions per metric
const DEFAULT_CONDITIONS: Record<string, string> = {
  http_req_duration: 'p(95)<500',
  http_req_failed:   'rate<0.01',
  http_reqs:         'rate>10',
};

const CONDITION_HINTS: Record<string, string[]> = {
  http_req_duration: ['p(95)<500', 'p(99)<1000', 'avg<200'],
  http_req_failed:   ['rate<0.01', 'rate<0.05'],
  http_reqs:         ['rate>10', 'rate>100'],
};

export default function ThresholdEditor({ thresholds, onChange }: Props) {
  const update = (id: string, field: keyof Threshold, val: string) => {
    onChange(thresholds.map(t => {
      if (t.id !== id) return t;
      if (field === 'metric') {
        return { ...t, metric: val as Threshold['metric'], condition: DEFAULT_CONDITIONS[val] ?? '' };
      }
      return { ...t, [field]: val };
    }));
  };

  const remove = (id: string) => onChange(thresholds.filter(t => t.id !== id));

  const add = () => onChange([...thresholds, {
    id: genId(),
    metric: 'http_req_duration',
    condition: 'p(95)<500',
  }]);

  return (
    <div>
      {thresholds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 26px', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Metric</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Condition</span>
            <span />
          </div>

          {thresholds.map(t => (
            <div key={t.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 26px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <select value={t.metric} onChange={e => update(t.id, 'metric', e.target.value)}>
                {METRIC_OPTIONS.map(m => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>

              <div>
                <input
                  list={`conditions-${t.id}`}
                  placeholder="e.g. p(95)<500"
                  value={t.condition}
                  onChange={e => update(t.id, 'condition', e.target.value)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
                <datalist id={`conditions-${t.id}`}>
                  {(CONDITION_HINTS[t.metric] ?? []).map(h => <option key={h} value={h} />)}
                </datalist>
              </div>

              <button className="btn-icon" onClick={() => remove(t.id)} title="Remove threshold">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      <button className="btn-ghost" onClick={add}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add threshold
      </button>
    </div>
  );
}
