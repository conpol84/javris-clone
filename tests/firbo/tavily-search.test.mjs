import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeWebSearch, tavilySearch } from '../../supabase/functions/_shared/free-search.ts';

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
