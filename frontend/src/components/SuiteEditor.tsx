/**
 * SuiteEditor — visual DAG editor for Anvil test suites.
 *
 * Left panel : add/configure a node (test config form in compact mode)
 * Canvas     : React Flow graph — drag nodes, draw edges for dependencies
 * Right panel: properties of the selected node (gate toggle, config preview)
 */

import { useState, useCallback, useId } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  MarkerType,
  Handle,
  Position,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import type { Suite, SuiteNode, TestConfig, RunStatus } from '../types';
import TestConfigForm from './TestConfigForm';

// ── Node data shape ───────────────────────────────────────────

interface NodeData extends Record<string, unknown> {
  suiteNode: SuiteNode;
  status?: RunStatus;  // set during a live suite run
  onUpdate: (updated: SuiteNode) => void;
  onDelete: (id: string) => void;
}

// ── Custom React Flow node ────────────────────────────────────

const PROTOCOL_COLORS: Record<string, string> = {
  http: '#22c55e', grpc: '#3b82f6', kafka: '#f59e0b', redis: '#ef4444',
};

const STATUS_COLORS: Partial<Record<RunStatus, string>> = {
  running:   '#f59e0b',
  completed: '#22c55e',
  failed:    '#ef4444',
  skipped:   '#6b7280',
  pending:   '#4f6ef7',
};

function TestNode({ data, selected }: NodeProps) {
  const d = data as NodeData;
  const { suiteNode, status } = d;
  const cfg = suiteNode.testConfig;
  const protocol = cfg.protocol ?? 'http';
  const protocolColor = PROTOCOL_COLORS[protocol] ?? '#4f6ef7';
  const statusColor = status ? (STATUS_COLORS[status] ?? 'var(--border)') : 'var(--border)';

  return (
    <div style={{
      minWidth: 180, padding: '10px 12px',
      background: 'var(--bg-surface)',
      border: `2px solid ${selected ? 'var(--accent)' : statusColor}`,
      borderRadius: 10,
      boxShadow: selected ? '0 0 0 3px rgba(79,110,247,0.2)' : '0 2px 8px rgba(0,0,0,0.4)',
      position: 'relative',
      userSelect: 'none',
    }}>
      {/* Source handle (right) — draw edges FROM this node */}
      <Handle type="source" position={Position.Right}
        style={{ background: 'var(--accent)', border: 'none', width: 10, height: 10 }} />
      {/* Target handle (left) — accept edges TO this node */}
      <Handle type="target" position={Position.Left}
        style={{ background: 'var(--text-muted)', border: 'none', width: 10, height: 10 }} />

      {/* Gate badge */}
      {suiteNode.isGate && (
        <div style={{
          position: 'absolute', top: -8, right: 6,
          background: '#ef444422', border: '1px solid #ef4444',
          borderRadius: 4, fontSize: 9, fontWeight: 700,
          color: '#ef4444', padding: '1px 5px', letterSpacing: '0.06em',
        }}>
          GATE
        </div>
      )}

      {/* Protocol tag */}
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '0.08em',
        color: protocolColor, marginBottom: 4, textTransform: 'uppercase',
      }}>
        {protocol}
      </div>

      {/* Test name */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: 'var(--text-primary)',
        maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {cfg.name || <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Unnamed test</span>}
      </div>

      {/* Target */}
      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>
        {protocol === 'http' && (cfg.baseUrl ?? '—')}
        {protocol === 'grpc' && (cfg.grpcConfig?.host ?? '—')}
        {protocol === 'kafka' && `topic: ${cfg.kafkaConfig?.topic ?? '—'}`}
        {protocol === 'redis' && (cfg.redisConfig?.addr ?? '—')}
      </div>

      {/* Live status indicator */}
      {status && (
        <div style={{
          marginTop: 6, fontSize: 10, fontWeight: 600,
          color: STATUS_COLORS[status] ?? 'var(--text-muted)',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <span style={{
            display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
            background: STATUS_COLORS[status] ?? 'var(--border)',
            animation: status === 'running' ? 'pulse 1s ease-in-out infinite' : 'none',
          }} />
          {status}
        </div>
      )}
    </div>
  );
}

const nodeTypes = { testNode: TestNode };

// ── Default new test config ───────────────────────────────────

function defaultTestConfig(): TestConfig {
  return {
    name: '',
    protocol: 'http',
    baseUrl: '',
    method: 'GET',
    path: '/',
    headers: [],
    body: '',
    stages: [{ id: `s-${Date.now()}`, duration: '30s', target: 10 }],
    thresholds: [],
  };
}

// ── SuiteEditor ───────────────────────────────────────────────

interface Props {
  /** If provided, overlays live run status onto nodes */
  suiteRunNodeStatuses?: Record<string, RunStatus>;
  onRunSuite: (suite: Suite) => void;
  isRunning: boolean;
}

export default function SuiteEditor({ suiteRunNodeStatuses, onRunSuite, isRunning }: Props) {
  const uid = useId();
  const nextId = useCallback(() => `node-${uid}-${Date.now()}`, [uid]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Selected node for the right-panel config editor
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Suite name
  const [suiteName, setSuiteName] = useState('My Test Suite');

  // ── Node / edge callbacks ──────────────────────────────────

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({
      ...params,
      markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' },
      style: { stroke: 'var(--accent)', strokeWidth: 2 },
      animated: isRunning,
    }, eds));
  }, [setEdges, isRunning]);

  const updateSuiteNode = useCallback((updated: SuiteNode) => {
    setNodes(nds => nds.map(n =>
      n.id === updated.id
        ? { ...n, data: { ...(n.data as NodeData), suiteNode: updated } }
        : n,
    ));
  }, [setNodes]);

  const deleteNode = useCallback((id: string) => {
    setNodes(nds => nds.filter(n => n.id !== id));
    setEdges(eds => eds.filter(e => e.source !== id && e.target !== id));
    if (selectedNodeId === id) setSelectedNodeId(null);
  }, [setNodes, setEdges, selectedNodeId]);

  const addNode = useCallback(() => {
    const id = nextId();
    const newSuiteNode: SuiteNode = {
      id,
      testConfig: defaultTestConfig(),
      dependencies: [],
      isGate: false,
      position: { x: 120 + nodes.length * 220, y: 180 },
    };
    const rfNode: Node = {
      id,
      type: 'testNode',
      position: newSuiteNode.position,
      data: {
        suiteNode: newSuiteNode,
        status: undefined,
        onUpdate: updateSuiteNode,
        onDelete: deleteNode,
      } as NodeData,
    };
    setNodes(nds => [...nds, rfNode]);
    setSelectedNodeId(id);
  }, [nodes.length, nextId, setNodes, updateSuiteNode, deleteNode]);

  // ── Build Suite from current graph ────────────────────────

  const buildSuite = useCallback((): Suite => {
    // Reconstruct dependencies from edges: edge (source → target) means
    // target depends on source.
    const depMap = new Map<string, string[]>();
    edges.forEach(e => {
      const deps = depMap.get(e.target) ?? [];
      deps.push(e.source);
      depMap.set(e.target, deps);
    });

    const suiteNodes: SuiteNode[] = nodes.map(n => {
      const d = n.data as NodeData;
      return {
        ...d.suiteNode,
        dependencies: depMap.get(n.id) ?? [],
        position: { x: n.position.x, y: n.position.y },
      };
    });

    return {
      id: `suite-${Date.now()}`,
      name: suiteName,
      nodes: suiteNodes,
    };
  }, [nodes, edges, suiteName]);

  // ── Selection ──────────────────────────────────────────────

  const selectedNode = nodes.find(n => n.id === selectedNodeId);
  const selectedSuiteNode = selectedNode ? (selectedNode.data as NodeData).suiteNode : null;

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // Sync live statuses onto node data
  const nodesWithStatus: Node[] = nodes.map(n => {
    const liveStatus = suiteRunNodeStatuses?.[n.id];
    const d = n.data as NodeData;
    if (d.status === liveStatus) return n;
    return { ...n, data: { ...d, status: liveStatus } };
  });

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

      {/* ── Left toolbar ── */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: '1px solid var(--border)',
        background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column',
        padding: 12, gap: 10,
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Suite
        </div>

        <input
          value={suiteName}
          onChange={e => setSuiteName(e.target.value)}
          style={{ fontSize: 12, fontWeight: 600 }}
          placeholder="Suite name"
        />

        <button className="btn-ghost" style={{ fontSize: 11, padding: '7px 0', justifyContent: 'center' }}
          onClick={addNode}>
          + Add Test Node
        </button>

        <div style={{ height: 1, background: 'var(--border)' }} />

        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>{nodes.length}</strong> nodes,{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>{edges.length}</strong> edges
        </div>

        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ display: 'block', color: 'var(--text-secondary)', marginBottom: 2 }}>How to build a DAG:</strong>
          1. Add test nodes<br />
          2. Drag from a node's right handle to another's left handle to set a dependency<br />
          3. Toggle "Gate" on nodes that should block downstream on failure
        </div>

        <div style={{ flex: 1 }} />

        <button
          className="btn-primary"
          style={{ justifyContent: 'center', padding: '10px 0', fontSize: 12 }}
          onClick={() => onRunSuite(buildSuite())}
          disabled={isRunning || nodes.length === 0}
        >
          {isRunning ? '⏳ Running…' : '▶ Run Suite'}
        </button>
      </div>

      {/* ── React Flow canvas ── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodesWithStatus}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={handleNodeClick}
          onPaneClick={handlePaneClick}
          nodeTypes={nodeTypes}
          fitView
          style={{ background: 'var(--bg-base)' }}
        >
          <Background color="var(--border)" gap={20} size={1} />
          <Controls style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
          <MiniMap
            nodeColor={() => 'var(--accent)'}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          />
        </ReactFlow>

        {nodes.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none', gap: 10,
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--border)" strokeWidth="1.2">
              <circle cx="5" cy="12" r="3"/><circle cx="19" cy="5" r="3"/><circle cx="19" cy="19" r="3"/>
              <path d="M8 12h8M16.5 6.5l-9 4M16.5 17.5l-9-4"/>
            </svg>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              Click "Add Test Node" to start building your suite DAG
            </span>
          </div>
        )}
      </div>

      {/* ── Right panel: selected node config ── */}
      {selectedSuiteNode && (
        <div style={{
          width: 340, flexShrink: 0, borderLeft: '1px solid var(--border)',
          background: 'var(--bg-base)', overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderBottom: '1px solid var(--border)',
            background: 'var(--bg-surface)', flexShrink: 0,
          }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>
              Node Config
            </span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {/* Gate toggle */}
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11,
                color: selectedSuiteNode.isGate ? 'var(--error)' : 'var(--text-muted)',
                cursor: 'pointer', fontWeight: 600,
              }}>
                <input
                  type="checkbox"
                  checked={selectedSuiteNode.isGate}
                  onChange={e => updateSuiteNode({ ...selectedSuiteNode, isGate: e.target.checked })}
                />
                Gate
              </label>
              <button
                onClick={() => deleteNode(selectedSuiteNode.id)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-muted)', fontSize: 14, padding: '0 4px',
                }}
                title="Remove node"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Compact test config form */}
          <div style={{ padding: '8px 14px', flex: 1 }}>
            <TestConfigForm
              config={selectedSuiteNode.testConfig}
              onChange={tc => updateSuiteNode({ ...selectedSuiteNode, testConfig: tc })}
              compact
            />
          </div>
        </div>
      )}
    </div>
  );
}
