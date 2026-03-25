import type { TestConfig, HttpMethod } from '../types';
import HeaderEditor from './HeaderEditor';
import StageBuilder from './StageBuilder';
import ThresholdEditor from './ThresholdEditor';

interface Props {
  config: TestConfig;
  onChange: (config: TestConfig) => void;
  onRun: () => void;
  isRunning: boolean;
}

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const METHOD_COLORS: Record<HttpMethod, string> = {
  GET:    '#22c55e',
  POST:   '#f59e0b',
  PUT:    '#3b82f6',
  PATCH:  '#a855f7',
  DELETE: '#ef4444',
};

export default function TestConfigForm({ config, onChange, onRun, isRunning }: Props) {
  const set = <K extends keyof TestConfig>(key: K, val: TestConfig[K]) =>
    onChange({ ...config, [key]: val });

  const showBody = ['POST', 'PUT', 'PATCH'].includes(config.method);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

      {/* ── Test Setup ── */}
      <div className="section">
        <div className="section-title">Test Setup</div>

        <div className="field">
          <label>Test Name</label>
          <input
            placeholder="e.g. checkout-api-load-test"
            value={config.name}
            onChange={e => set('name', e.target.value)}
          />
        </div>

        <div className="field">
          <label>Base URL</label>
          <input
            placeholder="https://api.example.com"
            value={config.baseUrl}
            onChange={e => set('baseUrl', e.target.value)}
          />
        </div>
      </div>

      {/* ── Request ── */}
      <div className="section">
        <div className="section-title">Request</div>

        <div className="field-row" style={{ gridTemplateColumns: '120px 1fr' }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Method</label>
            <select
              value={config.method}
              onChange={e => set('method', e.target.value as HttpMethod)}
              style={{ color: METHOD_COLORS[config.method], fontWeight: 600 }}
            >
              {HTTP_METHODS.map(m => (
                <option key={m} value={m} style={{ color: METHOD_COLORS[m] }}>{m}</option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <label>Path</label>
            <input
              placeholder="/v1/endpoint"
              value={config.path}
              onChange={e => set('path', e.target.value)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
        </div>

        <div className="field" style={{ marginTop: 12 }}>
          <label>Headers</label>
          <HeaderEditor
            headers={config.headers}
            onChange={headers => set('headers', headers)}
          />
        </div>

        {showBody && (
          <div className="field" style={{ marginTop: 12 }}>
            <label>Request body (JSON)</label>
            <textarea
              rows={5}
              placeholder={'{\n  "key": "value"\n}'}
              value={config.body}
              onChange={e => set('body', e.target.value)}
            />
          </div>
        )}
      </div>

      {/* ── Load Profile ── */}
      <div className="section">
        <div className="section-title">Load Profile</div>
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Define how virtual users ramp up and down over time.
        </div>
        <StageBuilder stages={config.stages} onChange={stages => set('stages', stages)} />
      </div>

      {/* ── Thresholds ── */}
      <div className="section">
        <div className="section-title">Thresholds</div>
        <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          Assertions that determine whether the test passes or fails.
        </div>
        <ThresholdEditor thresholds={config.thresholds} onChange={t => set('thresholds', t)} />
      </div>

      {/* ── Run button ── */}
      <div style={{ padding: '4px 0 8px' }}>
        <button
          className="btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
          onClick={onRun}
          disabled={isRunning || !config.baseUrl || !config.stages.length}
        >
          {isRunning ? (
            <>
              <SpinnerIcon />
              Running test...
            </>
          ) : (
            <>
              <PlayIcon />
              Run Load Test
            </>
          )}
        </button>

        {!config.baseUrl && (
          <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            Set a base URL to enable the run button
          </p>
        )}
        {config.baseUrl && !config.stages.length && (
          <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
            Add at least one load stage to run
          </p>
        )}
      </div>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
      style={{ animation: 'spin 0.8s linear infinite' }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  );
}
