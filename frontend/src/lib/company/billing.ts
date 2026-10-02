import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type LimitKey = 'agents' | 'daily_runs' | 'integrations' | 'members' | 'shifts' | 'memories';
export const LIMIT_KEYS: LimitKey[] = ['agents', 'daily_runs', 'integrations', 'members', 'shifts', 'memories'];

export interface PlanRow {
  id: 'free' | 'pro' | 'business' | 'enterprise';
  name: string;
  price_month_usd: number | null;
  price_year_usd: number | null;
  limits: Record<LimitKey, number>;
  features: string[];
  sort: number;
  purchasable: boolean;
}

export interface PlanUsage {
  plan: PlanRow;
  status: 'active' | 'trialing' | 'past_due' | 'canceled';
  renews_at: string | null;
  has_subscription: boolean;
  usage: Record<LimitKey, number>;
}

export async function loadPlans(): Promise<PlanRow[]> {
  const { data, error } = await requireClient().from('plans').select('*').order('sort');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PlanRow[];
}

export async function loadPlanUsage(orgId: string): Promise<PlanUsage> {
  const { data, error } = await requireClient().rpc('get_plan_usage', { p_org: orgId });
  if (error) throw new Error(error.message);
  return data as unknown as PlanUsage;
}

/** The database raises "plan_limit:<key>" when a company hits what its plan allows. */
export function planLimitKey(err: unknown): LimitKey | null {
  const msg = err instanceof Error ? err.message : typeof err === 'object' && err && 'message' in err ? String((err as { message: unknown }).message) : '';
  const m = /plan_limit:?([a-z_]*)/.exec(msg);
  if (!m) return null;
  return (LIMIT_KEYS as string[]).includes(m[1]) ? (m[1] as LimitKey) : 'agents';
}

export type BillingErrorCode = 'not_configured' | 'forbidden' | 'no_subscription' | 'stripe_error' | 'unknown';
export class BillingError extends Error {
  constructor(public code: BillingErrorCode) {
    super(code);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('billing', { body });
  if (error) {
    let code: BillingErrorCode = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (['not_configured', 'forbidden', 'no_subscription', 'stripe_error'].includes(b?.error)) code = b.error;
      } catch {
        /* keep unknown */
      }
    }
    throw new BillingError(code);
  }
  return data as T;
}

export const startCheckout = (organization_id: string, plan: string, interval: 'month' | 'year') =>
  call<{ url: string }>({ action: 'checkout', organization_id, plan, interval });
export const openPortal = (organization_id: string) => call<{ url: string }>({ action: 'portal', organization_id });
export const setPlanManually = (organization_id: string, plan: string) => call<{ ok: true }>({ action: 'set_plan', organization_id, plan });
