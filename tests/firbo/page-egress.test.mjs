import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { boundedPageText, pageEgressFetch } from '../../supabase/functions/_shared/page-egress.ts';

const originalDeno = globalThis.Deno;
after(() => { globalThis.Deno = originalDeno; });

const endpoint = 'https://egress.example.test/v1/page';
const token = 'synthetic-page-service-token-32-characters';
const env = { FIRBO_PAGE_EGRESS_URL: endpoint, FIRBO_PAGE_EGRESS_TOKEN: token, FIRBO_PAGE_EGRESS_ENABLED: 'on' };

test('configured page transport stays closed until its independent release is enabled', async () => {
  for (const enabled of [undefined, '', 'off', 'true', 'ON']) {
    globalThis.Deno = { env: { get: key => ({ ...env, FIRBO_PAGE_EGRESS_ENABLED: enabled })[key] } };
    let calls = 0;
    await assert.rejects(pageEgressFetch('https://news.example.com/a', async () => { calls++; }), /page_egress_unavailable/);
    assert.equal(calls, 0);
  }
});

test('missing or malformed configuration cannot dispatch the target directly', async () => {
  for (const changed of [
    { FIRBO_PAGE_EGRESS_URL: '' },
    { FIRBO_PAGE_EGRESS_TOKEN: '' },
    { FIRBO_PAGE_EGRESS_URL: 'http://egress.example.test/v1/page' },
    { FIRBO_PAGE_EGRESS_URL: 'https://user:password@egress.example.test/v1/page' },
    { FIRBO_PAGE_EGRESS_URL: 'https://egress.example.test/other' },
    { FIRBO_PAGE_EGRESS_URL: 'https://egress.example.test/v1/page?x=1' },
    { FIRBO_PAGE_EGRESS_TOKEN: 'x'.repeat(32) + '\n' },
  ]) {
    globalThis.Deno = { env: { get: key => ({ ...env, ...changed })[key] } };
    let calls = 0;
    await assert.rejects(pageEgressFetch('https://news.example.com/a', async () => { calls++; }), /page_egress_unavailable/);
    assert.equal(calls, 0);
  }
});

test('only the pinned service receives the exact target and service credential', async () => {
  globalThis.Deno = { env: { get: key => env[key] } };
  let calls = 0;
  const response = await pageEgressFetch('https://news.example.com/a?q=1', async (url, init) => {
    calls++;
    assert.equal(String(url), endpoint);
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers.authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(init.body), { url: 'https://news.example.com/a?q=1' });
    assert.ok(!init.body.includes(token));
    return new Response('page', { headers: { 'content-type': 'text/plain', 'content-length': '4' } });
  });
  assert.equal(await boundedPageText(response), 'page');
  assert.equal(calls, 1);
});

test('unsafe targets and oversized service responses fail without fallback', async () => {
  globalThis.Deno = { env: { get: key => env[key] } };
  let calls = 0;
  const fetcher = async () => { calls++; return new Response('x'); };
  for (const target of [
    'http://news.example.com/a', 'https://127.0.0.1/a', 'https://[::1]/a',
    'https://user:pass@news.example.com/a', 'https://a.internal/a', 'https://news.example.com:8443/a',
    'https://news.example.com/a#fragment', 'https://news.example.com\\@evil.example/a',
  ]) await assert.rejects(pageEgressFetch(target, fetcher), /page_not_allowed/);
  assert.equal(calls, 0);

  await assert.rejects(pageEgressFetch('https://news.example.com/a', async () => new Response('x', {
    headers: { 'content-length': '1000001' },
  })), /page_too_large/);
  await assert.rejects(boundedPageText(new Response(new Uint8Array(1_000_001))), /page_too_large/);
});

test('a service denial is returned once and never retried against the target', async () => {
  globalThis.Deno = { env: { get: key => env[key] } };
  let calls = 0;
  const response = await pageEgressFetch('https://news.example.com/a', async url => {
    calls++;
    assert.equal(String(url), endpoint);
    return new Response('{"error":"egress_denied"}', { status: 502, headers: { 'content-type': 'application/json' } });
  });
  assert.equal(response.status, 502);
  assert.equal(calls, 1);
});
