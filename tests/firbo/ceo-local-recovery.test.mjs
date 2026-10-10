import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedFreeCeoFallback, legacyProviderFailureCode } from '../../supabase/functions/_shared/free-routing.ts';

const org = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const config = { FIRBO_ALLOW_LOCAL_FALLBACK: 'on', FIRBO_FREE_ORGANIZATIONS: org };
const env = (settings = config) => (name) => settings[name];
const eligible = (changes = {}) => approvedFreeCeoFallback({
  organizationId: org, isCeo: true, hasOwnKey: false, alreadyFree: false,
  directTargetCount: 1, errorCode: 'model_provider_rate_limited',
  env: env(), ...changes,
});

test('legacy provider diagnostic rejects raw upstream secrets', () => {
  const samples = [
    ['omniroute_http_429', 'model_provider_rate_limited'],
    ['openai_http_401', 'model_provider_auth_error'],
    ['openai_http_403', 'model_provider_auth_error'],
    ['openai_http_402', 'model_provider_payment_required'],
    ['omniroute_http_400', 'model_request_rejected'],
    ['omniroute_http_404', 'model_request_rejected'],
    ['omniroute_http_502', 'model_provider_unavailable'],
    ['omniroute_http_503', 'model_provider_unavailable'],
    ['omniroute_http_520', 'model_provider_unavailable'],
    ['openai_http_409', 'model_provider_http_error'],
    ['openai_empty', 'model_empty_response'],
    ['Authorization Bearer supersecret', 'model_error'],
    ['omniroute_http_429 secret=private', 'model_error'],
  ];
  for (const [message, expected] of samples) {
    const code = legacyProviderFailureCode(new Error(message));
    assert.equal(code, expected);
    assert.ok(!code.includes('secret'));
  }
  assert.equal(legacyProviderFailureCode(new Error('request gone', { cause: 'Bearer supersecret' })), 'model_error');
  const timeout = new Error('private model prompt'); timeout.name = 'TimeoutError';
  assert.equal(legacyProviderFailureCode(timeout), 'model_timeout_or_cancelled');
  assert.equal(legacyProviderFailureCode({ message: 'omniroute_http_429' }), 'model_error');
});

test('local CEO fallback is off without explicit owner configuration', () => {
  assert.equal(eligible({ env: env({ FIRBO_FREE_ORGANIZATIONS: org }) }), false);
  assert.equal(eligible({ env: env({ ...config, FIRBO_ALLOW_LOCAL_FALLBACK: 'true' }) }), false);
  assert.equal(eligible({ env: env({ ...config, FIRBO_FREE_ORGANIZATIONS: other }) }), false);
  assert.equal(eligible({ env: env({ ...config, FIRBO_FREE_ORGANIZATIONS: '*' }) }), false);
});

test('local CEO fallback applies only to one definite rejected direct provider', () => {
  assert.equal(eligible(), true);
  assert.equal(eligible({ isCeo: false }), false);
  assert.equal(eligible({ hasOwnKey: true }), false);
  assert.equal(eligible({ alreadyFree: true }), false);
  assert.equal(eligible({ directTargetCount: 0 }), false);
  assert.equal(eligible({ directTargetCount: 2 }), false);
  assert.equal(eligible({ organizationId: other }), false);
  for (const errorCode of [
    'gateway_http_429', 'model_error', 'model_provider_unavailable',
    'model_timeout_or_cancelled', 'model_provider_auth_error',
    'model_request_rejected', 'free_http_503', 'model_empty_response',
  ]) assert.equal(eligible({ errorCode }), false, errorCode);
});

test('provider 5xx, unknown network and timeout never authorize a second inference', () => {
  for (const error of [new Error('omniroute_http_503'), new Error('omniroute_http_502'), new Error('network unreachable')])
    assert.equal(eligible({ errorCode: legacyProviderFailureCode(error) }), false);
  const timedOut = new Error('request did not finish'); timedOut.name = 'AbortError';
  assert.equal(eligible({ errorCode: legacyProviderFailureCode(timedOut) }), false);
});
