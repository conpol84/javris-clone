import { requireClient } from './client';

export interface PendingInference {
  request_id: string;
  source: 'agent-chat' | 'mission-runner' | 'agent-runner';
  status: 'reserved' | 'reconcile_required';
  reserved_usd: number;
  age_seconds: number;
}

export interface AccountingSnapshot {
  contract: 'firbo-accounting-snapshot/v1';
  organization_id: string;
  observed_at: string;
  month_start: string;
  read_only: true;
  open_count: number;
  reserved_count: number;
  reconcile_required_count: number;
  potential_liability_usd: number;
  stale_open_count: number;
  stale_minutes: number;
  settled_month_count: number;
  platform_settled_month_usd: number;
  unknown_settled_cost_count: number;
  byok_settled_month_count: number;
  zero_cost_settled_month_count: number;
  overrun_month_count: number;
  detail_limit: number;
  details: PendingInference[];
}

export class AccountingError extends Error {
  constructor(public code: 'forbidden' | 'unavailable') { super(code); }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const counts = ['open_count', 'reserved_count', 'reconcile_required_count', 'stale_open_count',
  'settled_month_count', 'unknown_settled_cost_count', 'byok_settled_month_count',
  'zero_cost_settled_month_count', 'overrun_month_count'] as const;
const nonnegative = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const integer = (v: unknown): v is number => nonnegative(v) && Number.isSafeInteger(v);
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v));

/** Copy only the documented safe fields. Reject stale/mismatched tenant receipts. */
export function parseAccountingSnapshot(value: unknown, orgId: string): AccountingSnapshot {
  if (!value || typeof value !== 'object') throw new AccountingError('unavailable');
  const v = value as Record<string, unknown>;
  if (v.contract !== 'firbo-accounting-snapshot/v1' || v.read_only !== true || v.organization_id !== orgId
    || !date(v.observed_at) || !date(v.month_start) || !counts.every(k => integer(v[k]))
    || !nonnegative(v.potential_liability_usd) || !nonnegative(v.platform_settled_month_usd)
    || !integer(v.detail_limit) || v.detail_limit < 1 || v.detail_limit > 200
    || !integer(v.stale_minutes) || v.stale_minutes < 1 || v.stale_minutes > 10080
    || !Array.isArray(v.details) || v.details.length > v.detail_limit
    || v.details.length > Number(v.open_count)
    || Number(v.open_count) !== Number(v.reserved_count) + Number(v.reconcile_required_count)
    || Number(v.stale_open_count) > Number(v.open_count)
    || ['unknown_settled_cost_count', 'byok_settled_month_count', 'zero_cost_settled_month_count', 'overrun_month_count']
      .some(k => Number(v[k]) > Number(v.settled_month_count))) throw new AccountingError('unavailable');
  const seen = new Set<string>();
  const details = v.details.map((row: unknown): PendingInference => {
    if (!row || typeof row !== 'object') throw new AccountingError('unavailable');
    const r = row as Record<string, unknown>;
    if (typeof r.request_id !== 'string' || !uuid.test(r.request_id) || seen.has(r.request_id)
      || !['agent-chat', 'mission-runner', 'agent-runner'].includes(String(r.source))
      || !['reserved', 'reconcile_required'].includes(String(r.status))
      || !nonnegative(r.reserved_usd) || !integer(r.age_seconds)) throw new AccountingError('unavailable');
    seen.add(r.request_id);
    return { request_id: r.request_id, source: r.source as PendingInference['source'],
      status: r.status as PendingInference['status'], reserved_usd: r.reserved_usd, age_seconds: r.age_seconds };
  });
  const safe = Object.fromEntries(counts.map(k => [k, v[k]])) as Pick<AccountingSnapshot, typeof counts[number]>;
  return { ...safe, contract: 'firbo-accounting-snapshot/v1', organization_id: orgId,
    observed_at: v.observed_at, month_start: v.month_start, read_only: true,
    potential_liability_usd: v.potential_liability_usd, platform_settled_month_usd: v.platform_settled_month_usd,
    stale_minutes: v.stale_minutes, detail_limit: v.detail_limit, details };
}

export async function loadAccountingSnapshot(orgId: string, signal: AbortSignal): Promise<AccountingSnapshot> {
  if (!uuid.test(orgId)) throw new AccountingError('unavailable');
  const { data, error } = await requireClient().rpc('firbo_accounting_snapshot', {
    p_org: orgId, p_limit: 20, p_stale_minutes: 60,
  }).abortSignal(signal);
  if (error) throw new AccountingError(error.code === '42501' ? 'forbidden' : 'unavailable');
  return parseAccountingSnapshot(data, orgId);
}
