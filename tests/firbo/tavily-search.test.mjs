import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeWebSearch, tavilySearch, tavilySearchWithUsage } from '../../supabase/functions/_shared/free-search.ts';

const KEY = 'synthetic-test-key-not-a-credential';
const hit = { title: 'Research <b>result</b>', url: 'https://example.org/report', content: 'Public evidence.' };

test('configured search returns provider evidence with one bounded fake request', async () => {
  const requests = [];
  const output = await freeWebSearch('x'.repeat(500), 'el', async (url, options) => {
    requests.push({ url, options });
    return Response.json({ results: [hit] });
  }, undefined, { tavilyKey: KEY });
  assert.equal(requests.length, 1);
  const { url, options } = requests[0];
  assert.equal(url, 'https://api.tavily.com/search');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(JSON.parse(options.body), {
    query: 'x'.repeat(400), max_results: 6, search_depth: 'basic', include_answer: false,
  });
  assert.ok(options.signal instanceof AbortSignal);
  assert.equal(output, '1. Research result - https://example.org/report\n   Public evidence.');
  assert.ok(!output.includes(KEY));
});

test('invalid configured keys never reach the provider', async () => {
  let calls = 0;
  for (const key of ['short', 'bad\nheader-value', 'x'.repeat(201)]) {
    assert.equal(await tavilySearch('news', key, async () => { calls++; throw new Error('unexpected'); }), '');
  }
  assert.equal(calls, 0);
});

test('empty, malformed and failed provider responses retain keyless search', async () => {
  for (const response of [() => Response.json({ results: [] }), () => Response.json({ results: null }),
    () => new Response('private-provider-error', { status: 503 }), () => new Response('invalid-json')]) {
    const seen = [];
    const output = await freeWebSearch('news', 'en', async (url, options) => {
      seen.push(url);
      if (url === 'https://api.tavily.com/search') return response();
      assert.equal(options.headers.authorization, undefined);
      if (url.includes('duckduckgo')) return new Response('<a class="result__a" href="https://example.org/fallback">Fallback</a>');
      return new Response('', { status: 503 });
    }, undefined, { tavilyKey: KEY });
    assert.equal(seen.filter(url => url === 'https://api.tavily.com/search').length, 1);
    assert.match(output, /Fallback - https:\/\/example.org\/fallback/);
    assert.doesNotMatch(output, /private-provider-error/);
  }
});

test('provider results retain only usable links and respect the result limit', async () => {
  const output = await tavilySearch('news', KEY, async () => Response.json({ results: [
    { title: 'bad', url: 'javascript:alert(1)' }, { url: 'https://example.org/no-title' },
    hit, { ...hit, title: 'Second' }, { ...hit, title: 'Third' },
  ] }), undefined, 2);
  assert.match(output, /1\. Research result/);
  assert.match(output, /2\. Second/);
  assert.doesNotMatch(output, /Third|javascript|no-title/);
});

test('abort is propagated to the provider transport', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(tavilySearch('news', KEY, async (_url, options) => {
    options.signal.throwIfAborted();
    throw new Error('must not reach transport');
  }, controller.signal), { name: 'AbortError' });
});

test('claim-bound search requires usage and forwards the ledger request id', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const seen = [];
  const result = await tavilySearchWithUsage('market news', KEY, async (url, options) => {
    seen.push({ url, options });
    return Response.json({ results: [hit], usage: { credits: 1 } });
  }, undefined, 5, requestId);
  assert.deepEqual(result, {
    text: '1. Research result - https://example.org/report\n   Public evidence.', credits: 1,
  });
  assert.equal(seen[0].options.headers['x-request-id'], requestId);
  assert.deepEqual(JSON.parse(seen[0].options.body), {
    query: 'market news', max_results: 5, search_depth: 'basic', include_answer: false, include_usage: true,
  });
});

test('claim-bound search refuses missing or malformed usage after dispatch', async () => {
  for (const usage of [undefined, {}, { credits: -1 }, { credits: 1.5 }, { credits: '1' }]) {
    await assert.rejects(
      tavilySearchWithUsage('market news', KEY, async () => Response.json({ results: [hit], usage })),
      /tavily_usage_missing/,
    );
  }
});
