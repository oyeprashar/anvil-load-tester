import type { HistoryRecord } from '../types';

const BASE = '/api';

export async function fetchRuns(): Promise<HistoryRecord[]> {
  const res = await fetch(`${BASE}/runs`);
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.statusText}`);
  return res.json();
}

export async function fetchRun(id: string): Promise<HistoryRecord> {
  const res = await fetch(`${BASE}/runs/${id}`);
  if (!res.ok) throw new Error(`Failed to fetch run ${id}: ${res.statusText}`);
  return res.json();
}
