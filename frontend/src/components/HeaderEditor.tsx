import type { Header } from '../types';

interface Props {
  headers: Header[];
  onChange: (headers: Header[]) => void;
}

function genId() { return Math.random().toString(36).slice(2, 9); }

export default function HeaderEditor({ headers, onChange }: Props) {
  const update = (id: string, field: 'key' | 'value', val: string) =>
    onChange(headers.map(h => h.id === id ? { ...h, [field]: val } : h));

  const remove = (id: string) => onChange(headers.filter(h => h.id !== id));

  const add = () => onChange([...headers, { id: genId(), key: '', value: '' }]);

  return (
    <div>
      {headers.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {headers.map(h => (
            <div key={h.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 26px', gap: 6, marginBottom: 6, alignItems: 'center' }}>
              <input
                placeholder="Header name"
                value={h.key}
                onChange={e => update(h.id, 'key', e.target.value)}
              />
              <input
                placeholder="Value"
                value={h.value}
                onChange={e => update(h.id, 'value', e.target.value)}
              />
              <button className="btn-icon" onClick={() => remove(h.id)} title="Remove">
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
        Add header
      </button>
    </div>
  );
}
