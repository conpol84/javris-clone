/** Actual legacy Edge routes with synthetic auth, SDK and HTTP only.
 * The RPC double checks route behavior; PostgreSQL rollback is checked separately.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const reserved = ['youtube', 'tiktok', 'salesforce', 'quickbooks'];
const source = await readFile(new URL('../../supabase/functions/integrations/index.ts', import.meta.url), 'utf8');
const imports = [
  "import { createClient } from 'npm:@supabase/supabase-js@2';",
  "import {isConnectionAction,isConnectionCallback,forwardConnectionCallback,connectionAction} from '../_shared/connected-service.ts';",
  "import {ConnectionFailure,isConnectedKind} from '../_shared/connected-providers.ts';",
  "import {isBridgeKind} from '../_shared/device-bridges.ts';",
];
let code = source;
for (const line of imports) {
  assert.ok(code.includes(line), 'Review legacy test adapter after dependency changes');
  code = code.replace(line, '');
}
code = stripTypeScriptTypes(code);

function fixture(options = {}) {
  const state = { http: [], rpcs: [], deletes: [], integrations: [] };
  const env = {
    SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_ANON_KEY: 'synthetic-public',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', OAUTH_STATE_SECRET: 'synthetic-state-secret',
    APP_URL: 'https://firbo.example.test', GOOGLE_CLIENT_ID: 'synthetic-client', GOOGLE_CLIENT_SECRET: 'synthetic-secret',
    ...options.env,
  };
  const existing = { id: ID, organization_id: ORG, kind: 'github', name: 'Synthetic GitHub', config: {} };
  const sdk = {
    auth: { getUser: async () => ({ data: { user: options.unsigned ? null : { id: USER } }, error: null }) },
    rpc: async (name, args) => {
      state.rpcs.push({ name, args });
      if (name === 'plan_limit') return { data: 5, error: null };
      assert.equal(name, 'firbo_save_legacy_integration');
      assert.equal(args.p_org, ORG);
      assert.equal(args.p_user, USER);
      if (options.rpcThrows) throw new Error('synthetic transport failure');
      if (options.rpcError) return { data: null, error: { message: options.rpcError } };
      if (options.rpcEmpty) return { data: null, error: null };
      const row = { ...existing, kind: args.p_kind, name: args.p_name, config: args.p_config,
        status: 'active', last_error: null, last_used_at: '2026-10-05T00:00:00Z', created_at: '2026-10-05T00:00:00Z' };
      state.integrations.push(row);
      // Also verify the response whitelist if a future RPC accidentally includes a private field.
      return { data: { ...row, secret: args.p_secret }, error: null };
    },
    from(table) {
      let operation = 'read'; const filters = []; let head = false;
      const query = {
        select(_fields, settings) { head = settings?.head ?? false; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        delete() { operation = 'delete'; return query; },
        insert() { assert.fail('Legacy connection must use atomic persistence, never a public-row-only insert'); },
        maybeSingle() { return Promise.resolve(execute()); },
        single() { return query.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      function execute() {
        if (table === 'organization_members') {
          assert.ok(filters.some(([key, value]) => key === 'organization_id' && value === ORG));
          assert.ok(filters.some(([key, value]) => key === 'user_id' && value === USER));
          return { data: options.denied ? null : { role: options.role ?? 'manager' }, error: null };
        }
        assert.equal(table, 'integrations');
        if (operation === 'delete') {
          state.deletes.push(filters);
          assert.deepEqual(filters, [['id', ID], ['organization_id', ORG]]);
          if (options.deleteThrows) throw new Error('synthetic deletion transport failure');
          if (options.deleteError) return { data: null, error: { message: 'synthetic private delete failure' } };
          return { data: options.deleteEmpty ? null : { id: ID }, error: null };
        }
        return { data: head ? [] : options.missing ? null : existing, count: 0, error: null };
      }
      return query;
    },
  };
  const http = async (url, init = {}) => {
    const target = String(url); state.http.push({ url: target, method: init.method ?? 'GET' });
    if (options.providerFails) return Response.json({ error: 'synthetic private provider failure' }, { status: options.providerStatus ?? 401 });
    if (target === 'https://api.github.com/repos/synthetic-org/synthetic-repo') return Response.json({ id: 1 });
    if (target === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-access-token', refresh_token: 'synthetic-refresh-token', expires_in: 3600 });
    if (target === 'https://openidconnect.googleapis.com/v1/userinfo') return Response.json({ email: 'synthetic@example.test' });
    assert.fail(`Unexpected HTTP path in isolated fixture: ${target}`);
  };
  let handler;
  const deno = { env: { get: key => env[key] }, serve: fn => { handler = fn; } };
  class ConnectionFailure extends Error {}
  const unsupported = () => { throw new Error('New connection route is outside this legacy fixture'); };
  new Function('Deno', 'createClient', 'crypto', 'fetch', 'isConnectionAction', 'isConnectionCallback',
    'forwardConnectionCallback', 'connectionAction', 'ConnectionFailure', 'isConnectedKind', 'isBridgeKind', code)(
    deno, () => sdk, webcrypto, http, () => false, () => false, unsupported, unsupported,
    ConnectionFailure, kind => reserved.includes(kind), kind => ['homeassistant_devices', 'traccar'].includes(kind));
  const post = body => handler(new Request('https://synthetic.invalid/integrations', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  async function callback() {
    const encode = bytes => Buffer.from(bytes).toString('base64url');
    const payload = encode(new TextEncoder().encode(JSON.stringify({ o: ORG, u: USER, k: 'gmail', n: 'Synthetic Gmail', c: {}, exp: Date.now() + 60000 })));
    const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(env.OAUTH_STATE_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = encode(await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload)));
    return handler(new Request(`https://synthetic.invalid/integrations?code=synthetic-code&state=${payload}.${mac}`));
  }
  return { state, post, callback };
}

const connect = { action: 'connect', organization_id: ORG, kind: 'github', name: 'Synthetic GitHub',
  fields: { repo: 'synthetic-org/synthetic-repo', token: 'ghp_' + 'synthetic'.repeat(5) } };

test('legacy readiness reports each OAuth adapter without secrets, provider traffic or persistence', async () => {
  const f = fixture(); const response = await f.post({ action: 'integration_manifest', organization_id: ORG });
  const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.contract, 'firbo-integrations/v1');
  assert.equal(body.redirect_uri, 'https://synthetic.invalid/functions/v1/integrations');
  assert.equal(body.oauth.length, 11);
  assert.equal(new Set(body.oauth.map(p => p.kind)).size, 11);
  assert.ok(body.oauth.every(p => p.configured === (p.provider === 'GOOGLE')));
  assert.ok(!JSON.stringify(body).includes('synthetic-client'));
  assert.ok(!JSON.stringify(body).includes('synthetic-secret'));
  assert.equal(f.state.http.length, 0); assert.equal(f.state.rpcs.length, 0); assert.equal(f.state.integrations.length, 0);
});

for (const env of [{ GOOGLE_CLIENT_ID: '' }, { GOOGLE_CLIENT_SECRET: '' }, { GOOGLE_CLIENT_SECRET: '   ' }]) test('legacy readiness requires both nonempty provider credentials', async () => {
  const f = fixture({ env }); const body = await (await f.post({ action: 'integration_manifest', organization_id: ORG })).json();
  assert.ok(body.oauth.filter(p => p.provider === 'GOOGLE').every(p => p.configured === false));
  assert.equal(f.state.http.length, 0);
});

for (const options of [{ role: 'viewer' }, { denied: true }, { unsigned: true }]) test('readiness rejects unauthorized actors before exposing configuration', async () => {
  const f = fixture(options); const response = await f.post({ action: 'integration_manifest', organization_id: ORG });
  assert.equal(response.status, options.unsigned ? 401 : 403);
  assert.ok(!('oauth' in await response.json()));
  assert.equal(f.state.http.length, 0); assert.equal(f.state.rpcs.length, 0);
});

for (const [providerStatus, error] of [[401, 'credentials_rejected'], [403, 'credentials_rejected'], [429, 'rate_limited'], [503, 'provider_failed']]) test(`connection failure explains upstream ${providerStatus} without echoing provider data`, async () => {
  const f = fixture({ providerFails: true, providerStatus }); const response = await f.post(connect);
  assert.equal(response.status, 502); assert.deepEqual(await response.json(), { error });
  assert.equal(f.state.integrations.length, 0);
  assert.ok(!f.state.rpcs.some(p => p.name === 'firbo_save_legacy_integration'));
});

for (const [name, options, status, error] of [
  ['secret write failure', { rpcError: 'synthetic secret insertion rejected' }, 503, 'save_failed'],
  ['transport failure', { rpcThrows: true }, 503, 'save_failed'],
  ['missing result', { rpcEmpty: true }, 503, 'save_failed'],
  ['quota race', { rpcError: 'plan_limit' }, 429, 'plan_limit'],
  ['membership revoked during verification', { rpcError: 'forbidden' }, 403, 'forbidden'],
]) test(`legacy token connect fails closed: ${name}`, async () => {
  const f = fixture(options); const response = await f.post(connect);
  assert.equal(response.status, status); assert.deepEqual(await response.json(), { error });
  assert.equal(f.state.integrations.length, 0);
  assert.equal(f.state.http.length, 1);
});

test('legacy token connect exposes an active row only after atomic persistence and never echoes secrets', async () => {
  const f = fixture(); const response = await f.post(connect); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.integration.status, 'active');
  assert.equal(f.state.integrations.length, 1);
  assert.equal(f.state.rpcs.at(-1).name, 'firbo_save_legacy_integration');
  assert.equal(JSON.parse(f.state.rpcs.at(-1).args.p_secret).token, connect.fields.token);
  assert.ok(!JSON.stringify(body).includes(connect.fields.token)); assert.ok(!('secret' in body.integration));
});

for (const options of [{ role: 'member' }, { denied: true }, { unsigned: true }]) test('legacy token connect denies an unauthorized actor before provider or persistence', async () => {
  const f = fixture(options); const response = await f.post(connect);
  assert.equal(response.status, options.unsigned ? 401 : 403);
  assert.equal(f.state.http.length, 0); assert.equal(f.state.rpcs.length, 0);
});

test('legacy OAuth secret persistence failure redirects to save_failed, never connected', async () => {
  const f = fixture({ rpcError: 'synthetic secret insertion rejected' }); const response = await f.callback();
  assert.equal(response.status, 302);
  assert.equal(new URL(response.headers.get('location')).searchParams.get('oauth_error'), 'save_failed');
  assert.equal(new URL(response.headers.get('location')).searchParams.has('connected'), false);
  assert.equal(f.state.integrations.length, 0);
});

test('legacy OAuth redirects to connected only after atomic credentials persistence', async () => {
  const f = fixture(); const response = await f.callback();
  assert.equal(new URL(response.headers.get('location')).searchParams.get('connected'), 'gmail');
  assert.equal(f.state.integrations.length, 1);
  assert.equal(JSON.parse(f.state.rpcs.at(-1).args.p_secret).access_token, 'synthetic-access-token');
});

test('legacy OAuth checks the signed actor membership before exchanging tokens', async () => {
  const f = fixture({ role: 'viewer' }); const response = await f.callback();
  assert.equal(new URL(response.headers.get('location')).searchParams.get('oauth_error'), 'forbidden');
  assert.equal(f.state.http.length, 0); assert.equal(f.state.rpcs.length, 0);
});

for (const [options, status, expected] of [
  [{ deleteError: true }, 503, { error: 'save_failed' }],
  [{ deleteThrows: true }, 503, { error: 'save_failed' }],
  [{ deleteEmpty: true }, 404, { error: 'not_found' }],
  [{}, 200, { ok: true }],
]) test(`legacy disconnect verifies the scoped deletion (${status})`, async () => {
  const f = fixture(options); const response = await f.post({ action: 'disconnect', id: ID });
  assert.equal(response.status, status); assert.deepEqual(await response.json(), expected);
  assert.equal(f.state.deletes.length, 1); assert.equal(f.state.http.length, 0);
});
