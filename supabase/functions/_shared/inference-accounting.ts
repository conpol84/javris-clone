/**
 * Server-owned inference admission and settlement.
 *
 * Chat and mission calls share the same admission boundary. The database RPC owns
 * concurrency; this module owns bounded request estimates and fail-closed RPC
 * parsing.  Never turn an RPC error into an unmetered provider call.
 */

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_COST_USD = 1000;
const enc = new TextEncoder();

export type CostRoute = { priceIn: number; priceOut: number; maxOutputTokens: number };
export type Reservation = { requestId: string; duplicate: boolean };

const finiteRate = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1_000_000;

/**
 * A conservative upper bound: one input token per UTF-8 byte, plus the exact
 * output-token cap.  Direct-provider fallback routes are added because more
 * than one provider can be attempted.  The result is rounded up to a micro-dollar.
 */
export function maximumInferenceCost(payload: unknown, routes: CostRoute[]): number {
  if (!routes.length) return 0;
  const inputTokens = enc.encode(JSON.stringify(payload)).byteLength;
  return maximumTokenBoundCost(inputTokens, routes);
}

/**
 * Conservative reservation for a route whose provider meters non-text input
 * (for example image tokens) that cannot be derived from the JSON byte size.
 */
export function maximumTokenBoundCost(inputTokenCap: number, routes: CostRoute[]): number {
  if (!Number.isSafeInteger(inputTokenCap) || inputTokenCap < 0 || inputTokenCap > 1_000_000_000) {
    throw new Error('invalid_input_token_cap');
  }
  if (!routes.length) return 0;
  let total = 0;
  for (const route of routes) {
    if (!finiteRate(route.priceIn) || !finiteRate(route.priceOut)
      || !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < 1 || route.maxOutputTokens > 100_000) {
      throw new Error('invalid_cost_rate');
    }
    total += (inputTokenCap * route.priceIn + route.maxOutputTokens * route.priceOut) / 1_000_000;
  }
  const rounded = Math.ceil(total * 1_000_000) / 1_000_000;
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > MAX_COST_USD) throw new Error('invalid_cost_reservation');
  return rounded;
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export async function reserveInference(db: any, args: {
  organizationId: string;
  userId: string;
  agentId: string;
  requestKey: string;
  source?: 'agent-chat' | 'mission-runner';
  reservedUsd: number;
  hourlyLimit: number;
  dailyLimit: number;
}): Promise<Reservation> {
  if (!UUID.test(args.requestKey)) throw new Error('invalid_request_id');
  const { data, error } = await db.rpc('firbo_reserve_inference', {
    p_org: args.organizationId,
    p_user: args.userId,
    p_agent: args.agentId,
    p_source: args.source ?? 'agent-chat',
    p_request_key: args.requestKey,
    p_reserved_usd: args.reservedUsd,
    p_hourly_limit: args.hourlyLimit,
    p_daily_limit: args.dailyLimit,
  });
  if (error || !object(data)) throw new Error('budget_unavailable');
  if (data.ok !== true) {
    const reason = typeof data.reason === 'string' && ['budget_exceeded','rate_limited','plan_limit','request_already_resolved'].includes(data.reason)
      ? data.reason : 'budget_unavailable';
    throw new Error(reason);
  }
  if (typeof data.request_id !== 'string' || !UUID.test(data.request_id)) throw new Error('budget_unavailable');
  // The first caller owns the provider call.  A concurrent delivery with the
  // same client key must not spend the same reservation twice.
  if (data.duplicate === true) throw new Error('request_in_progress');
  return { requestId: data.request_id, duplicate: data.duplicate === true };
}

export async function settleInference(db: any, reservationId: string, usage: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  ownKey: boolean;
}): Promise<'settled' | 'settled_overrun'> {
  const { data, error } = await db.rpc('firbo_settle_inference', {
    p_request: reservationId,
    p_model: usage.model,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cost_usd: usage.costUsd,
    p_latency_ms: usage.latencyMs,
    p_own_key: usage.ownKey,
  });
  if (error || !object(data) || data.ok !== true || !['settled','settled_overrun'].includes(String(data.status))) {
    throw new Error('usage_save_failed');
  }
  return data.status as 'settled' | 'settled_overrun';
}

export async function markInferenceAmbiguous(db: any, reservationId: string, reason: string): Promise<void> {
  const safe = /^[a-z0-9_]{1,80}$/.test(reason) ? reason : 'provider_result_unknown';
  const { data, error } = await db.rpc('firbo_mark_inference_ambiguous', { p_request: reservationId, p_reason: safe });
  if (error || !object(data) || data.ok !== true || data.status !== 'reconcile_required') {
    console.error(JSON.stringify({ event: 'firbo_inference_reservation_reconcile_failed', request_id: reservationId }));
  }
}

/** Release only while no provider request has started. */
export async function releaseInference(db: any, reservationId: string, reason: string): Promise<void> {
  const safe = /^[a-z0-9_]{1,80}$/.test(reason) ? reason : 'released_before_provider';
  const { data, error } = await db.rpc('firbo_release_inference', { p_request: reservationId, p_reason: safe });
  if (error || !object(data) || data.ok !== true || data.status !== 'released') {
    console.error(JSON.stringify({ event: 'firbo_inference_reservation_release_failed', request_id: reservationId }));
  }
}
