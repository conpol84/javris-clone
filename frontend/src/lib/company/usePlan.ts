import { useEffect, useState } from 'react';
import { loadPlanUsage, type PlanUsage } from './billing';
import { listOwnKeys, type OwnKeyRow } from './ownKeys';

/** The company's plan (null while loading or when it cannot be read). */
export function usePlanUsage(orgId: string | undefined): PlanUsage | null {
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  useEffect(() => {
    let live = true;
    setPlan(null);
    if (orgId) loadPlanUsage(orgId).then((p) => live && setPlan(p)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [orgId]);
  return plan;
}

export const planHas = (plan: PlanUsage | null, feature: string) =>
  !!plan && (plan.plan.features.includes(feature) || plan.plan.features.includes('everything'));

/** The company's connected own keys (hints and models only, never the key). */
export function useOwnKeys(orgId: string | undefined): [OwnKeyRow[], () => void] {
  const [rows, setRows] = useState<OwnKeyRow[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    if (orgId) listOwnKeys(orgId).then((r) => live && setRows(r)).catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [orgId, tick]);
  return [rows, () => setTick((n) => n + 1)];
}
