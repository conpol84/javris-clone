import { useCallback, useEffect, useState } from 'react';
import { loadPlanUsage, type PlanUsage } from './billing';
import { listOwnKeys, type OwnKeyRow } from './ownKeys';

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface ResourceState { status: ResourceStatus; loading: boolean; error: Error | null; retry: () => void }
async function readPlan(orgId: string): Promise<PlanUsage> {
  const plan = await loadPlanUsage(orgId);
  if (!plan?.plan?.id || !Array.isArray(plan.plan.features)) throw new Error('plan_unavailable');
  return plan;
}

/** A result belongs to the company that requested it, even before effect cleanup runs. */
function useOrgResource<T>(orgId: string | undefined, read: (id: string) => Promise<T>): { data: T | null } & ResourceState {
  const [value, setValue] = useState<{ orgId: string | undefined; status: ResourceStatus; data: T | null; error: Error | null }>({ orgId, status: orgId ? 'loading' : 'idle', data: null, error: null });
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick(n => n + 1), []);
  useEffect(() => {
    let live = true;
    setValue({ orgId, status: orgId ? 'loading' : 'idle', data: null, error: null });
    if (orgId) void read(orgId).then(data => {
      if (live) setValue({ orgId, status: 'ready', data, error: null });
    }).catch(error => {
      if (live) setValue({ orgId, status: 'error', data: null, error: error instanceof Error ? error : new Error('configuration_unavailable') });
    });
    return () => { live = false; };
  }, [orgId, tick, read]);
  const current = value.orgId === orgId ? value : { status: orgId ? 'loading' as const : 'idle' as const, data: null, error: null };
  return { ...current, loading: current.status === 'loading', retry };
}

/** Includes loading/failure separately from a successfully read plan. */
export function usePlanUsageState(orgId: string | undefined): { plan: PlanUsage | null } & ResourceState {
  const { data, ...state } = useOrgResource(orgId, readPlan);
  return { plan: data, ...state };
}

/** Backward-compatible plan-only view for consumers that do not show configuration status. */
export const usePlanUsage = (orgId: string | undefined): PlanUsage | null => usePlanUsageState(orgId).plan;

export const planHas = (plan: PlanUsage | null, feature: string) =>
  !!plan && (plan.plan.features.includes(feature) || plan.plan.features.includes('everything'));

/** The company's connected own keys (hints and models only, never the key). */
export function useOwnKeys(orgId: string | undefined): [OwnKeyRow[], () => void, ResourceState] {
  const { data, ...state } = useOrgResource(orgId, listOwnKeys);
  return [data ?? [], state.retry, state];
}
