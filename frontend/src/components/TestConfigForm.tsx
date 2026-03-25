import { useRef } from 'react';
import type { TestConfig, HttpMethod, Protocol, GRPCConfig, KafkaConfig, RedisConfig } from '../types';
import HeaderEditor from './HeaderEditor';
import StageBuilder from './StageBuilder';
import ThresholdEditor from './ThresholdEditor';

interface Props {
  config: TestConfig;
  onChange: (config: TestConfig) => void;
  onRun?: () => void;
  isRunning?: boolean;
  /** When true, hides the Run button (used inside the SuiteEditor node panel) */
  compact?: boolean;
}

const PROTOCOLS: { value: Protocol; label: string; color: string }[] = [
  { value: 'http',  label: 'HTTP',  color: '#22c55e' },
  { value: 'grpc',  label: 'gRPC',  color: '#3b82f6' },
  { value: 'kafka', label: 'Kafka', color: '#f59e0b' },
  { value: 'redis', label: 'Redis', color: '#ef4444' },
];

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const METHOD_COLORS: Record<HttpMethod, string> = {
  GET: '#22c55e', POST: '#f59e0b', PUT: '#3b82f6', PATCH: '#a855f7', DELETE: '#ef4444',
};

export default function TestConfigForm({ config, onChange, onRun, isRunning, compact }: Props) {
  const set = <K extends keyof TestConfig>(key: K, val: TestConfig[K]) =>
    onChange({ ...config, [key]: val });

  const protocol = config.protocol ?? 'http';

  const setGRPC  = (patch: Partial<GRPCConfig>)  =>
    set('grpcConfig',  { host: '', protoContent: '', service: '', method: '', payload: '', tls: false, ...config.grpcConfig,  ...patch });
  const setKafka = (patch: Partial<KafkaConfig>) =>
    set('kafkaConfig', { brokers: [], topic: '', message: '', ...config.kafkaConfig, ...patch });
  const setRedis = (patch: Partial<RedisConfig>) =>
    set('redisConfig', { addr: '', command: 'SET', key: '', value: '', ...config.redisConfig, ...patch });

  // Proto file upload ref
  const protoInputRef = useRef<HTMLInputElement>(null);

  const handleProtoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      setGRPC({ protoContent: ev.target?.result as string });
    };
    reader.readAsText(file);
  };

  // Validation for Run button
  const canRun = (() => {
    if (!config.stages.length) return false;
    if (protocol === 'http')  return !!config.baseUrl;
    if (protocol === 'grpc')  return !!config.grpcConfig?.host && !!config.grpcConfig?.protoContent;
    if (protocol === 'kafka') return !!config.kafkaConfig?.brokers?.length && !!config.kafkaConfig?.topic;
    if (protocol === 'redis') return !!config.redisConfig?.addr && !!config.redisConfig?.key;
    return false;
  })();

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

        {/* Protocol selector */}
        <div className="field">
          <label>Protocol</label>
          <div style={{ display: 'flex', gap: 6 }}>
            {PROTOCOLS.map(p => (
              <button
                key={p.value}
                onClick={() => set('protocol', p.value)}
                style={{
                  flex: 1, padding: '6px 0', fontSize: 11, fontWeight: 700,
                  borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                  border: protocol === p.value ? `2px solid ${p.color}` : '2px solid var(--border)',
                  background: protocol === p.value ? `${p.color}22` : 'var(--bg-raised)',
                  color: protocol === p.value ? p.color : 'var(--text-muted)',
                  letterSpacing: '0.04em',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Protocol-specific config ── */}
      {protocol === 'http' && (
        <div className="section">
          <div className="section-title">Request</div>

          <div className="field">
            <label>Base URL</label>
            <input
              placeholder="https://api.example.com"
              value={config.baseUrl ?? ''}
              onChange={e => set('baseUrl', e.target.value)}
            />
          </div>

          <div className="field-row" style={{ gridTemplateColumns: '120px 1fr' }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Method</label>
              <select
                value={config.method ?? 'GET'}
                onChange={e => set('method', e.target.value as HttpMethod)}
                style={{ color: METHOD_COLORS[config.method ?? 'GET'], fontWeight: 600 }}
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
                value={config.path ?? ''}
                onChange={e => set('path', e.target.value)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Headers</label>
            <HeaderEditor
              headers={config.headers ?? []}
              onChange={headers => set('headers', headers)}
            />
          </div>

          {['POST', 'PUT', 'PATCH'].includes(config.method ?? '') && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Request body (JSON)</label>
              <textarea
                rows={4}
                placeholder={'{\n  "key": "value"\n}'}
                value={config.body ?? ''}
                onChange={e => set('body', e.target.value)}
              />
            </div>
          )}
        </div>
      )}

      {protocol === 'grpc' && (
        <div className="section">
          <div className="section-title">gRPC Config</div>

          <div className="field">
            <label>Host : Port</label>
            <input
              placeholder="api.example.com:443"
              value={config.grpcConfig?.host ?? ''}
              onChange={e => setGRPC({ host: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          <div className="field">
            <label>Proto file</label>
            <input type="file" accept=".proto" ref={protoInputRef} onChange={handleProtoUpload} style={{ display: 'none' }} />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn-ghost" style={{ fontSize: 11, padding: '5px 12px' }}
                onClick={() => protoInputRef.current?.click()}>
                Upload .proto
              </button>
              {config.grpcConfig?.protoContent ? (
                <span style={{ fontSize: 11, color: 'var(--success)' }}>✓ proto loaded ({config.grpcConfig.protoContent.length} chars)</span>
              ) : (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>No file selected</span>
              )}
            </div>
          </div>

          <div className="field-row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Service</label>
              <input
                placeholder="helloworld.Greeter"
                value={config.grpcConfig?.service ?? ''}
                onChange={e => setGRPC({ service: e.target.value })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Method</label>
              <input
                placeholder="SayHello"
                value={config.grpcConfig?.method ?? ''}
                onChange={e => setGRPC({ method: e.target.value })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          </div>

          <div className="field" style={{ marginTop: 12 }}>
            <label>Request payload (JSON)</label>
            <textarea
              rows={3}
              placeholder='{ "name": "world" }'
              value={config.grpcConfig?.payload ?? ''}
              onChange={e => setGRPC({ payload: e.target.value })}
            />
          </div>

          <div className="field" style={{ marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={config.grpcConfig?.tls ?? false}
                onChange={e => setGRPC({ tls: e.target.checked })}
              />
              Use TLS
            </label>
          </div>
        </div>
      )}

      {protocol === 'kafka' && (
        <div className="section">
          <div className="section-title">Kafka Config</div>

          <div className="field">
            <label>Brokers (comma-separated)</label>
            <input
              placeholder="localhost:9092, broker2:9092"
              value={(config.kafkaConfig?.brokers ?? []).join(', ')}
              onChange={e => setKafka({ brokers: e.target.value.split(',').map(b => b.trim()).filter(Boolean) })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          <div className="field">
            <label>Topic</label>
            <input
              placeholder="my-topic"
              value={config.kafkaConfig?.topic ?? ''}
              onChange={e => setKafka({ topic: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          <div className="field">
            <label>Message template</label>
            <textarea
              rows={3}
              placeholder='{"event": "load-test", "ts": "${Date.now()}"}'
              value={config.kafkaConfig?.message ?? ''}
              onChange={e => setKafka({ message: e.target.value })}
            />
          </div>
        </div>
      )}

      {protocol === 'redis' && (
        <div className="section">
          <div className="section-title">Redis Config</div>

          <div className="field">
            <label>Address</label>
            <input
              placeholder="localhost:6379"
              value={config.redisConfig?.addr ?? ''}
              onChange={e => setRedis({ addr: e.target.value })}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          <div className="field-row">
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Command</label>
              <select
                value={config.redisConfig?.command ?? 'SET'}
                onChange={e => setRedis({ command: e.target.value })}
              >
                {['SET','GET','INCR','DECR','LPUSH','RPUSH','SADD','HSET','HGET'].map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Key</label>
              <input
                placeholder="counter"
                value={config.redisConfig?.key ?? ''}
                onChange={e => setRedis({ key: e.target.value })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          </div>

          {['SET','LPUSH','RPUSH','SADD','HSET'].includes(config.redisConfig?.command ?? '') && (
            <div className="field" style={{ marginTop: 12 }}>
              <label>Value</label>
              <input
                placeholder="test-value"
                value={config.redisConfig?.value ?? ''}
                onChange={e => setRedis({ value: e.target.value })}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
          )}
        </div>
      )}

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
        <ThresholdEditor thresholds={config.thresholds ?? []} onChange={t => set('thresholds', t)} />
      </div>

      {/* ── Run button (hidden in compact/suite-editor mode) ── */}
      {!compact && onRun && (
        <div style={{ padding: '4px 0 8px' }}>
          <button
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', padding: '12px' }}
            onClick={onRun}
            disabled={isRunning || !canRun}
          >
            {isRunning ? <><SpinnerIcon /> Running test...</> : <><PlayIcon /> Run Load Test</>}
          </button>
          {!canRun && (
            <p style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center' }}>
              Fill in the required fields above to enable the run button
            </p>
          )}
        </div>
      )}
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
