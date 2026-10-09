import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ownKeyModel, ownKeyTarget, verifyProviderKey } from '../../supabase/functions/_shared/own-keys.ts';

test('only supported providers with a model name use own keys', () => {
  assert.deepEqual(ownKeyModel('openai:gpt-5-mini'), { provider: 'openai', model: 'gpt-5-mini' });
  assert.deepEqual(ownKeyModel('Anthropic:claude-sonnet-5-5'), { provider: 'anthropic', model: 'claude-sonnet-5-5' });
  assert.deepEqual(ownKeyModel('openrouter:meta-llama/llama-4:free'), { provider: 'openrouter', model: 'meta-llama/llama-4:free' });
  for (const spec of ['auto', 'omniroute:firbo-economy', 'custom:x', 'openai:', ':gpt', null, 'openai:bad model']) assert.equal(ownKeyModel(spec), null, String(spec));
});
test('runtime key lookup is skipped for non-own models and tolerates errors', async () => {
  let calls = 0;
  const admin = { rpc: async () => { calls++; return { data: 'sk-company-key', error: null }; } };
  assert.equal(await ownKeyTarget(admin, 'org', 'omniroute:firbo-economy'), null);
  assert.equal(calls, 0);
  const t = await ownKeyTarget(admin, 'org', 'groq:llama-3.3-70b-versatile');
  assert.equal(t.base, 'https://api.groq.com/openai/v1');
  assert.equal(t.key, 'sk-company-key');
  assert.equal(await ownKeyTarget({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, 'org', 'openai:gpt-5-mini'), null);
  assert.equal(await ownKeyTarget({ rpc: async () => { throw new Error('down'); } }, 'org', 'openai:gpt-5-mini'), null);
});
test('a key is checked with the provider and returns chat models only', async () => {
  let seen;
  const fetcher = async (url, init) => { seen = { url, init }; return Response.json({ data: [{ id: 'gpt-5-mini' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4o-realtime-preview' }, { id: 'o4-mini' }] }); };
  const out = await verifyProviderKey('openai', 'sk-test', fetcher);
  assert.equal(seen.url, 'https://api.openai.com/v1/models');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-test');
  assert.deepEqual(out, { ok: true, models: ['o4-mini', 'gpt-5-mini'] });
});
test('Anthropic is checked with its own headers', async () => {
  let seen;
  const out = await verifyProviderKey('anthropic', 'sk-ant', async (url, init) => { seen = { url, init }; return Response.json({ data: [{ id: 'claude-sonnet-5-5' }] }); });
  assert.equal(seen.init.headers['x-api-key'], 'sk-ant');
  assert.ok(!('authorization' in seen.init.headers));
  assert.deepEqual(out.models, ['claude-sonnet-5-5']);
});
test('a wrong key and an unreachable provider are told apart', async () => {
  assert.deepEqual(await verifyProviderKey('openai', 'bad', async () => new Response('no', { status: 401 })), { ok: false, reason: 'invalid_key' });
  assert.deepEqual(await verifyProviderKey('openai', 'k', async () => new Response('down', { status: 500 })), { ok: false, reason: 'provider_unreachable' });
  assert.deepEqual(await verifyProviderKey('openai', 'k', async () => { throw new Error('dns'); }), { ok: false, reason: 'provider_unreachable' });
});
