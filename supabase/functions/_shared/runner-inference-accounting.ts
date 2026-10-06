/**
 * Claim-bound inference admission for agent-runner.
 *
 * This module is intentionally separate from the live runner until the retry
 * graph is adapted end to end.  It owns stable payload fingerprints and the
 * durable pre-dispatch transition; settlement continues through the shared
 * accounting RPC, whose database trigger synchronizes the attempt state.
 */

import {
  markInferenceAmbiguous,
  releaseInference,
  settleInference,
} from './inference-accounting.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,119}$/;
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

export type RunnerReservation = {
  requestId: string;
  duplicate: boolean;
  attemptOrdinal: number;
  dispatchState: string;
};

export type RunnerDispatch = {
  allowed: boolean;
  dispatchState: string;
};

export type RunnerAttemptReceipt = {
  requestId: string;
  attemptOrdinal: number;
  route: string;
  status: 'settled' | 'settled_overrun';
};

export class RunnerAttemptError extends Error {
  readonly reconciliationRequired: boolean;
  readonly requestId?: string;

  constructor(code: string, reconciliationRequired = false, requestId?: string) {
    super(code);
    this.name = 'RunnerAttemptError';
    this.reconciliationRequired = reconciliationRequired;
    this.requestId = requestId;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('invalid_runner_payload');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error('invalid_runner_payload');
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

export async function fingerprintRunnerPayload(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(payload)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function reserveRunnerInference(db: any, args: {
  organizationId: string;
  userId: string;
  agentId: string;
  taskId: string;
  runClaim: string;
  attemptOrdinal: number;
  requestKey: string;
  payloadSha256: string;
  route: string;
  outputTokenCap: number;
  reservedUsd: number;
  hourlyAttemptLimit: number;
  dailyRunLimit: number;
}): Promise<RunnerReservation> {
  if (![args.organizationId, args.userId, args.agentId, args.taskId, args.runClaim, args.requestKey].every(id => UUID.test(id))
    || !Number.isSafeInteger(args.attemptOrdinal) || args.attemptOrdinal < 1 || args.attemptOrdinal > 16
    || !SHA256.test(args.payloadSha256) || !ROUTE.test(args.route)
    || !Number.isSafeInteger(args.outputTokenCap) || args.outputTokenCap < 1 || args.outputTokenCap > 100_000
    || !Number.isFinite(args.reservedUsd) || args.reservedUsd < 0 || args.reservedUsd > 1_000
    || !Number.isSafeInteger(args.hourlyAttemptLimit) || args.hourlyAttemptLimit < 0 || args.hourlyAttemptLimit > 100_000
    || !Number.isSafeInteger(args.dailyRunLimit) || args.dailyRunLimit < 0 || args.dailyRunLimit > 100_000) {
    throw new Error('invalid_runner_reservation');
  }

  const { data, error } = await db.rpc('firbo_reserve_runner_inference', {
    p_org: args.organizationId,
    p_user: args.userId,
    p_agent: args.agentId,
    p_task: args.taskId,
    p_claim: args.runClaim,
    p_attempt_ordinal: args.attemptOrdinal,
    p_request_key: args.requestKey,
    p_payload_sha256: args.payloadSha256,
    p_route: args.route,
    p_output_token_cap: args.outputTokenCap,
    p_reserved_usd: args.reservedUsd,
    p_hourly_attempt_limit: args.hourlyAttemptLimit,
    p_daily_run_limit: args.dailyRunLimit,
  });
  if (error || !object(data)) throw new Error('budget_unavailable');
  if (data.ok !== true) {
    const reason = typeof data.reason === 'string'
      && ['budget_exceeded', 'rate_limited', 'plan_limit'].includes(data.reason)
      ? data.reason
      : 'budget_unavailable';
    throw new Error(reason);
  }
  if (typeof data.request_id !== 'string' || !UUID.test(data.request_id)
    || !Number.isSafeInteger(data.attempt_ordinal) || data.attempt_ordinal !== args.attemptOrdinal
    || typeof data.dispatch_state !== 'string') {
    throw new Error('budget_unavailable');
  }
  return {
    requestId: data.request_id,
    duplicate: data.duplicate === true,
    attemptOrdinal: data.attempt_ordinal,
    dispatchState: data.dispatch_state,
  };
}

/**
 * The only successful return that permits a transport call is `true`.
 * Duplicate delivery after another worker crossed the transition returns false.
 */
export async function beginRunnerDispatch(db: any, args: {
  requestId: string;
  taskId: string;
  runClaim: string;
  payloadSha256: string;
}): Promise<RunnerDispatch> {
  if (![args.requestId, args.taskId, args.runClaim].every(id => UUID.test(id)) || !SHA256.test(args.payloadSha256)) {
    throw new Error('invalid_runner_dispatch');
  }
  const { data, error } = await db.rpc('firbo_begin_runner_dispatch', {
    p_request: args.requestId,
    p_task: args.taskId,
    p_claim: args.runClaim,
    p_payload_sha256: args.payloadSha256,
  });
  if (error || !object(data) || data.ok !== true || data.request_id !== args.requestId
    || typeof data.dispatch_allowed !== 'boolean' || typeof data.dispatch_state !== 'string') {
    throw new Error('dispatch_unavailable');
  }
  return { allowed: data.dispatch_allowed, dispatchState: data.dispatch_state };
}

/**
 * Reserve, durably authorize one dispatch and settle one transport attempt.
 *
 * The transport receives the ledger request id so a route that supports an
 * idempotency/correlation key can use the same server-owned identity. Once the
 * dispatch transition succeeds, every unknown transport or settlement outcome
 * is reconciliation-required; this helper never releases after dispatch.
 */
export async function executeRunnerInferenceAttempt<T>(db: any, args: {
  organizationId: string;
  userId: string;
  agentId: string;
  taskId: string;
  runClaim: string;
  attemptOrdinal: number;
  requestKey?: string;
  payload: unknown;
  route: string;
  outputTokenCap: number;
  reservedUsd: number;
  hourlyAttemptLimit: number;
  dailyRunLimit: number;
}, transport: (context: { requestId: string; payloadSha256: string }) => Promise<{
  value: T;
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
    ownKey: boolean;
  };
}>): Promise<{ value: T; receipt: RunnerAttemptReceipt }> {
  const requestKey = args.requestKey ?? crypto.randomUUID();
  const payloadSha256 = await fingerprintRunnerPayload(args.payload);
  let reservation: RunnerReservation;
  try {
    reservation = await reserveRunnerInference(db, { ...args, requestKey, payloadSha256 });
  } catch (error) {
    throw new RunnerAttemptError(error instanceof Error ? error.message : 'budget_unavailable');
  }

  let dispatch: RunnerDispatch;
  try {
    dispatch = await beginRunnerDispatch(db, {
      requestId: reservation.requestId,
      taskId: args.taskId,
      runClaim: args.runClaim,
      payloadSha256,
    });
  } catch {
    throw new RunnerAttemptError('dispatch_unavailable', true, reservation.requestId);
  }
  if (!dispatch.allowed) {
    throw new RunnerAttemptError('request_in_progress', true, reservation.requestId);
  }

  let completed: Awaited<ReturnType<typeof transport>>;
  try {
    completed = await transport({ requestId: reservation.requestId, payloadSha256 });
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message
      : 'provider_result_unknown';
    await markInferenceAmbiguous(db, reservation.requestId, reason);
    throw new RunnerAttemptError(reason, true, reservation.requestId);
  }

  let status: 'settled' | 'settled_overrun';
  try {
    status = await settleInference(db, reservation.requestId, completed.usage);
  } catch {
    await markInferenceAmbiguous(db, reservation.requestId, 'settlement_result_unknown');
    throw new RunnerAttemptError('usage_save_failed', true, reservation.requestId);
  }
  return {
    value: completed.value,
    receipt: {
      requestId: reservation.requestId,
      attemptOrdinal: args.attemptOrdinal,
      route: args.route,
      status,
    },
  };
}

export const settleRunnerInference = settleInference;
export const markRunnerInferenceAmbiguous = markInferenceAmbiguous;
export const releaseRunnerInference = releaseInference;
