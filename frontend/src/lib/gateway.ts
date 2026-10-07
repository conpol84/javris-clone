import { useCallback, useEffect, useState } from 'react';
import { apiFetch, getBase } from './gateway-api';
import { companyClient } from './company/client';

export interface GatewayOverview {
  connected: boolean;
  host: string;
  has_key: boolean;
  models: {
    total: number;
    providers: { provider: string; models: number }[];
    combo_ids: string[];
  };
  connections: { provider: string; connections: number; active: number; healthy: number; limited: number }[];
  combos: { name: string; strategy: string; steps: number }[];
  stats: {
    provider: string;
    requests: number;
    success_rate: number | null;
    avg_latency_ms: number | null;
    tokens_in: number;
    tokens_out: number;
  }[];
  errors: Record<string, string>;
}

export type GatewayState =
  | { status: 'loading' }
  | { status: 'unreachable'; reason: string } // Firbo backend not reachable
  | { status: 'ready'; data: GatewayOverview };

/** GET a gateway route on the Firbo API. Signed-in users authenticate with their own session; the server's API key never reaches the browser. */
export async function gatewayGet<T>(path: string): Promise<T> {
  const session = companyClient ? (await companyClient.auth.getSession()).data.session : null;
  const res = session
    ? await fetch(`${getBase()}${path}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
    : await apiFetch(path);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // A static host answering with its index.html means the server address was never configured.
  if (!(res.headers.get('content-type') ?? '').includes('json')) throw new Error('not_json');
  return (await res.json()) as T;
}

/** POST to a gateway route with the signed-in user's session. Throws the server's message on failure. */
export async function gatewayPost<T>(path: string, body: unknown): Promise<T> {
  const session = companyClient ? (await companyClient.auth.getSession()).data.session : null;
  const res = await fetch(`${getBase()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (typeof j?.detail === 'string') detail = j.detail;
    } catch {
      /* keep status text */
    }
    const err = new Error(detail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

export interface GatewayHealthRow {
  provider: string;
  status: 'healthy' | 'degraded' | 'down' | 'idle';
  requests: number;
  success_rate: number | null;
  avg_latency_ms: number | null;
  last_request_at: string | null;
  last_error_at: string | null;
}
export interface GatewayCombo {
  name: string;
  strategy: string;
  models: string[];
  enabled: boolean;
}
export interface GatewaySavings {
  available: boolean;
  error: string | null;
  compression: { enabled: boolean; mode: string };
  modes: string[];
  cache: Record<string, number>;
}

export interface GatewayUsage {
  range: string;
  available: boolean;
  error: string | null;
  requests: number;
  tokens_in: number;
  tokens_out: number;
  success_rate: number | null;
  avg_latency_ms: number;
  cost: number;
  fallbacks: number;
  models: { model: string; provider: string; requests: number; tokens: number; cost: number; avg_latency_ms: number }[];
  providers: { provider: string; requests: number; tokens: number; cost: number }[];
  daily: { date: string; requests: number; tokens: number; cost: number }[];
}

export interface GatewayCall {
  id: string;
  at: string;
  provider: string;
  model: string;
  status: number;
  duration_ms: number;
  tokens_in: number;
  tokens_out: number;
  combo: string | null;
  failed: boolean;
  active: boolean;
}

export interface QuotaProvider {
  provider: string;
  name: string;
  plan: string;
  fetched_at: string;
  windows: { name: string; remaining_pct: number | null; used: number | null; total: number | null; reset_at: string | null; unlimited: boolean }[];
}

export interface GatewayKey {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  max_per_day: number | null;
  max_per_minute: number | null;
  expires_at: string | null;
}

export interface FreeModel {
  provider: string;
  model: string;
  name: string;
  monthly_tokens: number | null;
  free_type: string;
}

/** Load a gateway route once and whenever `path` changes (refresh on demand with `reload`). */
export function useGatewayData<T>(path: string, intervalMs = 0): { data: T | null; error: string; loading: boolean; reload: () => void } {
  const [state, setState] = useState<{ data: T | null; error: string; loading: boolean }>({ data: null, error: '', loading: true });
  const load = useCallback(async () => {
    try {
      setState({ data: await gatewayGet<T>(path), error: '', loading: false });
    } catch (err) {
      setState({ data: null, error: err instanceof Error ? err.message : 'error', loading: false });
    }
  }, [path]);
  useEffect(() => {
    setState((s) => ({ ...s, loading: true }));
    void load();
    if (!intervalMs) return;
    const id = window.setInterval(() => !document.hidden && void load(), intervalMs);
    return () => window.clearInterval(id);
  }, [load, intervalMs]);
  return { ...state, reload: () => void load() };
}

export async function fetchGatewayOverview(): Promise<GatewayOverview> {
  const body = await gatewayGet<GatewayOverview>('/v1/gateway/overview');
  if (typeof body?.connected !== 'boolean') throw new Error('Unexpected response');
  return body;
}

export function useGateway(intervalMs = 15_000): GatewayState & { reload: () => void } {
  const [state, setState] = useState<GatewayState>({ status: 'loading' });
  const load = useCallback(async () => {
    try {
      setState({ status: 'ready', data: await fetchGatewayOverview() });
    } catch (err) {
      setState({ status: 'unreachable', reason: err instanceof Error ? err.message : 'unreachable' });
    }
  }, []);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [load, intervalMs]);
  return { ...state, reload: () => void load() };
}

/** Human labels for OmniRoute's routing strategies. */
export const STRATEGY_INFO: Record<string, string> = {
  priority: 'Drain targets in order',
  'fill-first': 'Fill each quota before moving on',
  weighted: 'Weighted random',
  'round-robin': 'Cycle through targets',
  p2c: 'Power-of-two-choices',
  'least-used': 'Lowest current load',
  random: 'Uniform random',
  'strict-random': 'Random, repeats allowed',
  'cost-optimized': 'Cheapest per request',
  headroom: 'Most remaining quota',
  'reset-window': 'Soonest quota reset',
  'reset-aware': 'Rank by quota reset time',
  'context-relay': 'Hand off long contexts',
  'context-optimized': 'Best fit for context size',
  'cache-optimized': 'Maximise prompt-cache hits',
  lkgp: 'Last known good provider',
  auto: 'Live 16-factor scoring',
  fusion: 'Model panel + judge',
  pipeline: 'Chain steps',
};
