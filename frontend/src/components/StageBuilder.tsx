import type { Stage } from '../types';

interface Props {
  stages: Stage[];
  onChange: (stages: Stage[]) => void;
}

function genId() { return Math.random().toString(36).slice(2, 9); }

const DURATION_PRESETS = ['10s', '30s', '1m', '2m', '5m', '10m'];

export default function StageBuilder({ stages, onChange }: Props) {
  const update = (id: string, field: keyof Stage, val: string | number) =>
    onChange(stages.map(s => s.id === id ? { ...s, [field]: val } : s));

  const remove = (id: string) => onChange(stages.filter(s => s.id !== id));

  const add = () => onChange([...stages, { id: genId(), duration: '30s', target: 50 }]);

  return (
    <div>
      {stages.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {/* Column labels */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 26px', gap: 6, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Duration</span>
            <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Target VUs</span>
            <span />
          </div>

          {stages.map((s, i) => (
            <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 26px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              {/* Duration with datalist presets */}
              <div style={{ position: 'relative' }}>
                <input
                  list={`durations-${s.id}`}
                  placeholder="e.g. 30s"
                  value={s.duration}
                  onChange={e => update(s.id, 'duration', e.target.value)}
                />
                <datalist id={`durations-${s.id}`}>
                  {DURATION_PRESETS.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>

              {/* VU target */}
              <div style={{ position: 'relative' }}>
                <input
                  type="number"
                  min={0}
                  placeholder="VUs"
                  value={s.target}
                  onChange={e => update(s.id, 'target', parseInt(e.target.value) || 0)}
                />
                {/* Visual ramp arrow between stages */}
              </div>

              <button className="btn-icon" onClick={() => remove(s.id)} title="Remove stage">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>

              {/* Connector hint between stages */}
              {i < stages.length - 1 && (
                <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2">
                    <path d="M12 5v14M5 12l7 7 7-7" />
                  </svg>
                  <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button className="btn-ghost" onClick={add}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add stage
      </button>
    </div>
  );
}
