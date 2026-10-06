import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculate,
  calculatorTool,
  chunkText,
  weatherTool,
  exchangeRateTool,
  generateImage,
  analyzeImage,
  knowledgeSearch,
  gatewayImageRequestPayload,
  pollinationsImageRequestPayload,
  requestGatewayImage,
  requestPollinationsImage,
  storeGeneratedImage,
} from '../../supabase/functions/_shared/agent-tools.ts';

test('calculator: arithmetic, precedence, powers, functions and percentages without eval', () => {
  assert.equal(calculate('2 + 3 * 4'), 14);
  assert.equal(calculate('(2 + 3) * 4'), 20);
  assert.equal(calculate('2 ^ 3 ^ 2'), 512);
  assert.equal(calculate('-3 + 5'), 2);
  assert.equal(calculate('sqrt(16) + max(1, 7, 3)'), 11);
  assert.equal(calculate('15% of 200'), 30);
  assert.equal(calculate('1,200 * 2'), 2400);
  assert.equal(calculate('3 x 4'), 12);
  assert.equal(calculate('round(2.345, 2)'), 2.35);
  assert.equal(calculate('max(2, 9)'), 9);
  assert.throws(() => calculate('process.exit()'));
  assert.throws(() => calculate('1 / 0'));
  assert.match(calculatorTool('constructor'), /Could not calculate/);
  assert.equal(calculatorTool('1200 * 0.24'), '1200 * 0.24 = 288');
});

test('chunkText: overlapping chunks that cover the whole text', () => {
  const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} talks about the shop.`).join(' ');
  const chunks = chunkText(text, 300, 50);
  assert.ok(chunks.length > 3);
  assert.ok(chunks.every(c => c.length <= 300));
  assert.match(chunks.at(-1), /Sentence number 39/);
  assert.deepEqual(chunkText('   '), []);
});

const reply = (body, init = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

test('weather: geocodes the place and formats the forecast with its source', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(String(url));
    if (String(url).includes('geocoding')) return reply({ results: [{ name: 'Athens', country: 'Greece', latitude: 37.98, longitude: 23.72 }] });
    return reply({ current: { temperature_2m: 24, relative_humidity_2m: 40, wind_speed_10m: 12, weather_code: 1 },
      daily: { time: ['2026-10-05'], temperature_2m_min: [18], temperature_2m_max: [27], precipitation_probability_max: [10], weather_code: [0] } });
  };
  const out = await weatherTool('καιρός Athens', 'el', fetcher);
  assert.match(out, /Athens, Greece/);
  assert.match(out, /24 °C/);
  assert.match(out, /open-meteo\.com/);
  assert.match(calls[0], /name=Athens/);
  assert.match(calls[0], /language=el/);
});

test('exchange rate: converts with the live rate', async () => {
  const out = await exchangeRateTool('250 eur to usd', async () => reply({ result: 'success', rates: { USD: 1.1 }, time_last_update_utc: 'Mon, 05 Oct 2026 00:00:01 +0000' }));
  assert.match(out, /250 EUR = 275\.00 USD/);
  assert.match(await exchangeRateTool('euros please', async () => reply({})), /two currency codes/);
});

test('generate image: free service fallback, stored under the company folder', async () => {
  const png = new Uint8Array(5000).fill(7);
  const stored = [];
  const out = await generateImage('a red bicycle on a beach', {
    organizationId: 'org-1',
    fetcher: async (url) => { assert.match(String(url), /pollinations/); return new Response(png, { status: 200, headers: { 'content-type': 'image/jpeg' } }); },
    store: { upload: async (path, bytes, type) => { stored.push({ path, size: bytes.length, type }); return `https://cdn.example/${path}`; } },
  });
  assert.equal(stored.length, 1);
  assert.match(stored[0].path, /^org-1\/[0-9a-f-]+\.jpg$/);
  assert.match(out, /!\[a red bicycle on a beach\]\(https:\/\/cdn\.example\/org-1\//);
  await assert.rejects(generateImage('a cat', { organizationId: 'o', store: { upload: async () => 'x' }, fetcher: async () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) }));
});

test('image transports use exact payloads and gateway dispatch identity', async () => {
  const gatewayPayload = gatewayImageRequestPayload('  a   blue poster  ', 'image/model');
  assert.deepEqual(gatewayPayload, {
    model: 'image/model', prompt: 'a blue poster', n: 1, size: '1024x1024', response_format: 'b64_json',
  });
  const freePayload = pollinationsImageRequestPayload(' a blue poster ', 42);
  assert.deepEqual(freePayload, { prompt: 'a blue poster', width: 1024, height: 1024, nologo: true, seed: 42 });
  assert.equal(pollinationsImageRequestPayload('x', 42), null);

  const png = new Uint8Array(5000).fill(9);
  let gatewayCall;
  const gateway = await requestGatewayImage(gatewayPayload, {
    base: 'https://gateway.example/v1', key: 'secret', requestId: '77777777-7777-4777-8777-777777777777',
    fetcher: async (url, init) => {
      gatewayCall = { url: String(url), headers: init.headers, body: JSON.parse(init.body) };
      return reply({ data: [{ b64_json: Buffer.from(png).toString('base64') }] });
    },
  });
  assert.equal(gatewayCall.url, 'https://gateway.example/v1/images/generations');
  assert.equal(gatewayCall.headers['x-request-id'], '77777777-7777-4777-8777-777777777777');
  assert.deepEqual(gatewayCall.body, gatewayPayload);
  assert.equal(gateway.bytes.length, 5000);

  let freeUrl = '';
  const free = await requestPollinationsImage(freePayload, { fetcher: async (url) => {
    freeUrl = String(url);
    return new Response(png, { headers: { 'content-type': 'image/jpeg' } });
  } });
  assert.match(freeUrl, /seed=42$/);
  assert.equal(free.model, 'pollinations/free');
  const stored = await storeGeneratedImage('a blue poster', free, {
    organizationId: 'org-2', store: { upload: async path => `https://cdn.example/${path}` },
  });
  assert.match(stored, /https:\/\/cdn\.example\/org-2\/[0-9a-f-]+\.jpg/);
});

test('analyze image: needs a https link and reports token usage', async () => {
  assert.match((await analyzeImage('what is this', { gateway: { base: 'https://g/v1', key: 'k', model: 'm' } })).text, /https link/);
  let sent;
  const out = await analyzeImage('https://x.example/a.png what color?', { gateway: { base: 'https://g/v1', key: 'k', model: 'firbo-quality' },
    requestId: '77777777-7777-4777-8777-777777777777',
    fetcher: async (_url, init) => { sent = { body: JSON.parse(init.body), headers: init.headers }; return reply({ choices: [{ message: { content: 'Blue.' } }], usage: { prompt_tokens: 100, completion_tokens: 5 } }); } });
  assert.equal(out.text, 'Blue.');
  assert.equal(out.inTok, 100);
  assert.equal(sent.body.messages[0].content[1].image_url.url, 'https://x.example/a.png');
  assert.equal(sent.headers['x-request-id'], '77777777-7777-4777-8777-777777777777');
  await assert.rejects(analyzeImage('https://x.example/a.png', { gateway: { base: 'https://g/v1', key: 'k', model: 'm' },
    fetcher: async () => reply({ choices: [{ message: { content: 'Blue.' } }] }) }), /vision_usage_missing/);
});

test('knowledge search: company-scoped hybrid search call and readable hits', async () => {
  let args;
  const db = { rpc: async (fn, a) => { args = { fn, ...a }; return { data: [{ title: 'Price list', url: null, content: 'Bike service costs 40 euro.', score: 0.03 }], error: null }; } };
  const out = await knowledgeSearch(db, 'org-9', 'service price');
  assert.equal(args.fn, 'match_knowledge');
  assert.equal(args.p_org, 'org-9');
  assert.equal(args.p_embedding, null); // no embedding model outside the edge runtime: keyword search still works
  assert.match(out, /Price list/);
  assert.match(out, /40 euro/);
  const empty = { rpc: async () => ({ data: [], error: null }) };
  assert.match(await knowledgeSearch(empty, 'o', 'x'), /Nothing in the company knowledge/);
});
