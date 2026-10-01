import { useCallback, useEffect, useState } from 'react';
import { apiFetch, getBase } from './api';
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

export async function fetchGatewayOverview(): Promise<GatewayOverview> {
  // Signed-in Firbo users authenticate with their own session; the server's API key never reaches the browser.
  const session = companyClient ? (await companyClient.auth.getSession()).data.session : null;
  const res = session
    ? await fetch(`${getBase()}/v1/gateway/overview`, { headers: { Authorization: `Bearer ${session.access_token}` } })
    : await apiFetch('/v1/gateway/overview');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as GatewayOverview;
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
