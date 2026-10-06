import assert from 'node:assert/strict';
import test from 'node:test';

import {
  beginRunnerDispatch,
  fingerprintRunnerPayload,
  markRunnerInferenceAmbiguous,
  releaseRunnerInference,
  reserveRunnerInference,
  settleRunnerInference,
} from '../../supabase/functions/_shared/runner-inference-accounting.ts';

const ids = {
  organizationId: '11111111-1111-4111-8111-111111111111',
  userId: '22222222-2222-4222-8222-222222222222',
  agentId: '33333333-3333-4333-8333-333333333333',
  taskId: '44444444-4444-4444-8444-444444444444',
  runClaim: '55555555-5555-4555-8555-555555555555',
  requestKey: '66666666-6666-4666-8666-666666666666',
};
const payloadSha256 = 'a'.repeat(64);
const args = {
  ...ids,
  attemptOrdinal: 1,
  payloadSha256,
  route: 'omniroute:firbo-quality',
  outputTokenCap: 4000,
  reservedUsd: 0.25,
  hourlyAttemptLimit: 20,
  dailyRunLimit: 500,
};

function fakeDb(replies) {
  const calls = [];
  return {
    calls,
    async rpc(name, params) {
      calls.push({ name, params });
      return replies.shift() ?? { data: null, error: new Error('unexpected_rpc') };
    },
  };
}

test('runner payload fingerprints are canonical and sensitive to content', async () => {
  const first = await fingerprintRunnerPayload({ z: 1, nested: { b: true, a: ['x', 2] } });
  const reordered = await fingerprintRunnerPayload({ nested: { a: ['x', 2], b: true }, z: 1 });
  const changed = await fingerprintRunnerPayload({ nested: { a: ['x', 3], b: true }, z: 1 });
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, reordered);
  assert.notEqual(first, changed);
});

test('runner reservation forwards every claim binding and accepts stable duplicate receipts', async () => {
  const requestId = '77777777-7777-4777-8777-777777777777';
  const db = fakeDb([
    { data: { ok: true, duplicate: false, request_id: requestId, attempt_ordinal: 1, dispatch_state: 'admitted' }, error: null },
    { data: { ok: true, duplicate: true, request_id: requestId, attempt_ordinal: 1, dispatch_state: 'admitted' }, error: null },
  ]);
  const first = await reserveRunnerInference(db, args);
  const duplicate = await reserveRunnerInference(db, args);
  assert.deepEqual(first, { requestId, duplicate: false, attemptOrdinal: 1, dispatchState: 'admitted' });
  assert.deepEqual(duplicate, { requestId, duplicate: true, attemptOrdinal: 1, dispatchState: 'admitted' });
  assert.equal(db.calls.length, 2);
  assert.deepEqual(db.calls[0], {
    name: 'firbo_reserve_runner_inference',
    params: {
      p_org: ids.organizationId,
      p_user: ids.userId,
      p_agent: ids.agentId,
      p_task: ids.taskId,
      p_claim: ids.runClaim,
      p_attempt_ordinal: 1,
      p_request_key: ids.requestKey,
      p_payload_sha256: payloadSha256,
      p_route: 'omniroute:firbo-quality',
      p_output_token_cap: 4000,
      p_reserved_usd: 0.25,
      p_hourly_attempt_limit: 20,
      p_daily_run_limit: 500,
    },
  });
});

test('runner reservation fails closed before any dispatch opportunity', async () => {
  const db = fakeDb([
    { data: { ok: false, reason: 'budget_exceeded' }, error: null },
    { data: { ok: true, request_id: 'malformed' }, error: null },
  ]);
  await assert.rejects(reserveRunnerInference(db, args), /budget_exceeded/);
  await assert.rejects(reserveRunnerInference(db, args), /budget_unavailable/);
  const invalid = fakeDb([]);
  await assert.rejects(
    reserveRunnerInference(invalid, { ...args, payloadSha256: 'not-a-hash' }),
    /invalid_runner_reservation/,
  );
  assert.equal(invalid.calls.length, 0);
});

test('durable dispatch transition gives exactly one caller permission to invoke transport', async () => {
  const requestId = '77777777-7777-4777-8777-777777777777';
  const db = fakeDb([
    { data: { ok: true, duplicate: false, request_id: requestId, dispatch_allowed: true, dispatch_state: 'dispatching' }, error: null },
    { data: { ok: true, duplicate: true, request_id: requestId, dispatch_allowed: false, dispatch_state: 'dispatching' }, error: null },
  ]);
  const dispatchArgs = { requestId, taskId: ids.taskId, runClaim: ids.runClaim, payloadSha256 };
  assert.equal(await beginRunnerDispatch(db, dispatchArgs), true);
  assert.equal(await beginRunnerDispatch(db, dispatchArgs), false);
  assert.equal(db.calls[0].name, 'firbo_begin_runner_dispatch');
});

test('settlement, ambiguity and proven pre-dispatch release keep the shared RPC contract', async () => {
  const requestId = '77777777-7777-4777-8777-777777777777';
  const db = fakeDb([
    { data: { ok: true, status: 'settled', request_id: requestId }, error: null },
    { data: { ok: true, status: 'reconcile_required', request_id: requestId }, error: null },
    { data: { ok: true, status: 'released', request_id: requestId }, error: null },
  ]);
  assert.equal(await settleRunnerInference(db, requestId, {
    model: 'omniroute:quality', inputTokens: 10, outputTokens: 5,
    costUsd: 0.01, latencyMs: 100, ownKey: false,
  }), 'settled');
  await markRunnerInferenceAmbiguous(db, requestId, 'provider_result_unknown');
  await releaseRunnerInference(db, requestId, 'released_before_provider');
  assert.deepEqual(db.calls.map(call => call.name), [
    'firbo_settle_inference',
    'firbo_mark_inference_ambiguous',
    'firbo_release_inference',
  ]);
});
