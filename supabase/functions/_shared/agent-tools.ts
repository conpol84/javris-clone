// Native tools for AI employees: OpenJarvis's calculator, weather, currency, knowledge search and image tools, Firbo style.
// They run inside Firbo (no server needed), use keyless public services where possible and never touch another company's data.

type Fetcher = typeof fetch;
const sig = (signal?: AbortSignal, ms = 10_000) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms));

// ------------------------------------------------------------------------------------------------ calculator
const FUNCS: Record<string, (...a: number[]) => number> = {
  sqrt: Math.sqrt, abs: Math.abs, round: (x, d = 0) => Math.round(x * 10 ** d) / 10 ** d, floor: Math.floor, ceil: Math.ceil,
  ln: Math.log, log: Math.log10, log10: Math.log10, log2: Math.log2, exp: Math.exp, sin: Math.sin, cos: Math.cos, tan: Math.tan,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

/**
 * Evaluates an arithmetic expression without eval: numbers, + - * / ^ %, parentheses, functions (sqrt, round, min, ...).
 * "15% of 200" and "x" for multiplication are understood. Throws on anything else.
 */
export function calculate(input: string): number {
  const src = input.toLowerCase()
    .replace(/(\d)\s*%\s*(of|από|του)\s*/g, '$1/100*')
    .replace(/×/g, '*').replace(/(?<=[\d)]\s*)x(?=\s*[\d(])/g, '*').replace(/÷/g, '/').replace(/\*\*/g, '^')
    .replace(/(\d),(\d{3})(?!\d)/g, '$1$2');
  let i = 0;
  const peek = () => { while (src[i] === ' ') i++; return src[i]; };
  const eat = (c: string) => { if (peek() === c) { i++; return true; } return false; };
  const expr = (): number => {
    let v = term();
    for (;;) { if (eat('+')) v += term(); else if (eat('-')) v -= term(); else return v; }
  };
  const term = (): number => {
    let v = power();
    for (;;) {
      if (eat('*')) v *= power();
      else if (eat('/')) v /= power();
      else if (peek() === '%' ) { i++; v /= 100; }
      else return v;
    }
  };
  const power = (): number => { const b = unary(); return eat('^') ? b ** power() : b; };
  const unary = (): number => (eat('-') ? -unary() : eat('+') ? unary() : atom());
  const atom = (): number => {
    if (eat('(')) { const v = expr(); if (!eat(')')) throw new Error('missing )'); return v; }
    const c = peek();
    const num = /^(\d+(?:[.,]\d+)?(?:e[+-]?\d+)?|[.,]\d+)/.exec(src.slice(i));
    if (num) { i += num[0].length; return Number(num[0].replace(',', '.')); }
    const word = /^[a-z_][a-z0-9_]*/.exec(src.slice(i));
    if (word) {
      i += word[0].length;
      if (word[0] in CONSTS) return CONSTS[word[0]];
      const fn = FUNCS[word[0]];
      if (!fn || !eat('(')) throw new Error(`unknown ${word[0]}`);
      const args: number[] = [];
      if (!eat(')')) { do args.push(expr()); while (eat(',') || eat(';')); if (!eat(')')) throw new Error('missing )'); }
      return fn(...args);
    }
    throw new Error(`unexpected ${c ?? 'end'}`);
  };
  const v = expr();
  if (peek() !== undefined) throw new Error(`unexpected ${peek()}`);
  if (!Number.isFinite(v)) throw new Error('not a finite number');
  return v;
}

export function calculatorTool(input: string): string {
  try {
    const v = calculate(input);
    return `${input.trim()} = ${Number.isInteger(v) ? v : Number(v.toPrecision(12))}`;
  } catch (error) {
    return `Could not calculate "${input.slice(0, 80)}": ${error instanceof Error ? error.message : 'invalid expression'}. Use numbers, + - * / ^ ( ) and functions such as sqrt, round, min, max.`;
  }
}

// ------------------------------------------------------------------------------------------------ weather
const WMO: Record<number, string> = {
  0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'fog', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers', 82: 'violent rain showers',
  95: 'thunderstorm', 96: 'thunderstorm with hail', 99: 'thunderstorm with hail',
};

/** Current weather and a 3-day forecast for a place (Open-Meteo, keyless). */
export async function weatherTool(place: string, lang = 'en', fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<string> {
  // Word filter instead of \b, which does not see Greek letters as word characters.
  const STOP = new Set(['weather', 'forecast', 'in', 'for', 'today', 'καιρός', 'καιρο', 'καιρό', 'καιρός;', 'σε', 'στην', 'στη', 'στο', 'για', 'σήμερα', 'πρόγνωση']);
  const name = place.split(/[\s,;?!]+/).filter(w => w && !STOP.has(w.toLowerCase())).join(' ').slice(0, 80);
  if (!name) return 'Give a city or place name.';
  const geo = await fetcher(`https://geocoding-api.open-meteo.com/v1/search?count=1&format=json&language=${encodeURIComponent(lang.split('-')[0])}&name=${encodeURIComponent(name)}`, { signal: sig(signal) });
  if (!geo.ok) throw new Error(`weather_geo_http_${geo.status}`);
  const g = (await geo.json())?.results?.[0];
  if (!g) return `No place called "${name}" was found.`;
  const f = await fetcher(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3`, { signal: sig(signal) });
  if (!f.ok) throw new Error(`weather_http_${f.status}`);
  const w = await f.json();
  const c = w?.current ?? {};
  const d = w?.daily ?? {};
  const days = (d.time ?? []).map((day: string, n: number) => `- ${day}: ${WMO[d.weather_code?.[n]] ?? 'weather'}, ${d.temperature_2m_min?.[n]}–${d.temperature_2m_max?.[n]} °C, rain chance ${d.precipitation_probability_max?.[n] ?? '?'}%`);
  return [`Weather for ${g.name}${g.country ? `, ${g.country}` : ''} (source: Open-Meteo, https://open-meteo.com):`,
    `Now: ${WMO[c.weather_code] ?? 'weather'}, ${c.temperature_2m} °C, humidity ${c.relative_humidity_2m}%, wind ${c.wind_speed_10m} km/h.`, ...days].join('\n');
}

// ------------------------------------------------------------------------------------------------ currency
/** "100 EUR to USD", "USD EUR", "1500 USD in GBP" → today's rate and the converted amount (open.er-api.com, keyless). */
export async function exchangeRateTool(input: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<string> {
  const codes = (input.toUpperCase().match(/\b[A-Z]{3}\b/g) ?? []).filter(c => !['AND', 'THE', 'FOR'].includes(c));
  const amount = Number((/(\d+(?:[.,]\d+)?)/.exec(input)?.[1] ?? '1').replace(',', '.'));
  if (codes.length < 2) return 'Write two currency codes, e.g. "100 EUR to USD".';
  const [from, to] = codes;
  const r = await fetcher(`https://open.er-api.com/v6/latest/${from}`, { signal: sig(signal) });
  if (!r.ok) throw new Error(`fx_http_${r.status}`);
  const j = await r.json();
  const rate = Number(j?.rates?.[to]);
  if (j?.result !== 'success' || !Number.isFinite(rate)) return `No rate found for ${from} → ${to}.`;
  return `${amount} ${from} = ${(amount * rate).toFixed(2)} ${to} (rate ${rate}, updated ${String(j.time_last_update_utc ?? '').slice(0, 16)}; source: https://www.exchangerate-api.com).`;
}

// ------------------------------------------------------------------------------------------------ knowledge
/** Splits text into overlapping chunks on paragraph/sentence boundaries (about `size` characters each). */
export function chunkText(text: string, size = 900, overlap = 150): string[] {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + size);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('. '), window.lastIndexOf('\n'));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

/** 384-number embedding from the edge runtime's built-in gte-small model; null where the runtime has no model (tests, Node). */
let session: { run: (t: string, o: Record<string, unknown>) => Promise<unknown> } | null | undefined;
export async function embed(text: string): Promise<number[] | null> {
  try {
    if (session === undefined) {
      const ai = (globalThis as any).Supabase?.ai;
      session = ai ? new ai.Session('gte-small') : null;
    }
    if (!session) return null;
    const v = await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true });
    return Array.isArray(v) && v.length === 384 ? (v as number[]) : null;
  } catch {
    return null;
  }
}

export interface KnowledgeHit { title: string; url: string | null; content: string; score: number }
type Rpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

/** Hybrid search (meaning + keywords) over one company's knowledge, formatted for the model. */
export async function knowledgeSearch(db: Rpc, organizationId: string, query: string, limit = 5): Promise<string> {
  const vector = await embed(query);
  const { data, error } = await db.rpc('match_knowledge', { p_org: organizationId, p_query: query.slice(0, 300), p_embedding: vector ? JSON.stringify(vector) : null, p_limit: limit });
  if (error) throw new Error('knowledge_search_failed');
  const hits = (Array.isArray(data) ? data : []) as KnowledgeHit[];
  if (!hits.length) return 'Nothing in the company knowledge matches that. Try other words.';
  return hits.map((h, n) => `${n + 1}. ${h.title || 'Document'}${h.url ? ` - ${h.url}` : ''}\n   ${String(h.content).replace(/\s+/g, ' ').slice(0, 700)}`).join('\n');
}

// ------------------------------------------------------------------------------------------------ images
export interface ImageStore { upload(path: string, bytes: Uint8Array, contentType: string): Promise<string> }

/**
 * Creates an image from a description and stores it, returning its public link.
 * Uses the gateway's image model when one is configured (FIRBO_IMAGE_MODEL), else the free Pollinations service.
 */
export async function generateImage(prompt: string, o: { organizationId: string; store: ImageStore; gateway?: { base: string; key: string; model?: string }; fetcher?: Fetcher; signal?: AbortSignal }): Promise<string> {
  const fetcher = o.fetcher ?? fetch;
  const text = prompt.replace(/\s+/g, ' ').trim().slice(0, 800);
  if (text.length < 3) return 'Describe the image to create.';
  let bytes: Uint8Array | null = null;
  let type = 'image/png';
  if (o.gateway?.model) {
    try {
      const r = await fetcher(`${o.gateway.base}/images/generations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${o.gateway.key}` },
        body: JSON.stringify({ model: o.gateway.model, prompt: text, n: 1, size: '1024x1024', response_format: 'b64_json' }), signal: sig(o.signal, 60_000) });
      if (r.ok) {
        const item = (await r.json())?.data?.[0];
        if (item?.b64_json) bytes = Uint8Array.from(atob(String(item.b64_json)), c => c.charCodeAt(0));
        else if (typeof item?.url === 'string' && /^https:\/\//.test(item.url)) {
          const img = await fetcher(item.url, { signal: sig(o.signal, 30_000) });
          if (img.ok) { type = img.headers.get('content-type') ?? type; bytes = new Uint8Array(await img.arrayBuffer()); }
        }
      }
    } catch { /* fall back to the free service */ }
  }
  if (!bytes) {
    const seed = Math.floor(Math.random() * 1e9);
    const r = await fetcher(`https://image.pollinations.ai/prompt/${encodeURIComponent(text)}?width=1024&height=1024&nologo=true&seed=${seed}`, { signal: sig(o.signal, 60_000) });
    if (!r.ok) throw new Error(`image_http_${r.status}`);
    type = r.headers.get('content-type') ?? 'image/jpeg';
    if (!type.startsWith('image/')) throw new Error('image_not_returned');
    bytes = new Uint8Array(await r.arrayBuffer());
  }
  if (bytes.length < 1000 || bytes.length > 8_000_000) throw new Error('image_size');
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  const link = await o.store.upload(`${o.organizationId}/${crypto.randomUUID()}.${ext}`, bytes, type);
  return `Image created: ${link}\nShow it in the report as ![${text.slice(0, 60).replace(/[[\]]/g, '')}](${link}).`;
}

export type VisionRequestPayload = {
  model: string;
  max_tokens: number;
  messages: [{ role: 'user'; content: [{ type: 'text'; text: string }, { type: 'image_url'; image_url: { url: string } }] }];
};

/** Exact bounded provider payload, shared by accounting fingerprinting and dispatch. */
export function visionRequestPayload(input: string, model: string): VisionRequestPayload | null {
  const url = /https:\/\/[^\s<>"')]+/.exec(input)?.[0];
  if (!url) return null;
  const question = input.replace(url, '').trim() || 'Describe this image in detail: what it shows, any text in it, and anything notable for a business.';
  return { model, max_tokens: 700, messages: [{ role: 'user', content: [
    { type: 'text', text: question.slice(0, 600) },
    { type: 'image_url', image_url: { url } },
  ] }] };
}

/** Describes or answers a question about an image at a public https link, with the gateway's vision-capable combo. */
export async function analyzeImage(input: string, o: { gateway: { base: string; key: string; model: string }; requestId?: string; fetcher?: Fetcher; signal?: AbortSignal }): Promise<{ text: string; inTok: number; outTok: number }> {
  const payload = visionRequestPayload(input, o.gateway.model);
  if (!payload) return { text: 'Give the image as a full https link, then the question.', inTok: 0, outTok: 0 };
  const headers: Record<string, string> = { 'content-type': 'application/json', authorization: `Bearer ${o.gateway.key}` };
  if (o.requestId) headers['x-request-id'] = o.requestId;
  const r = await (o.fetcher ?? fetch)(`${o.gateway.base}/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(payload), signal: sig(o.signal, 60_000),
  });
  if (!r.ok) throw new Error(`vision_http_${r.status}`);
  const j = await r.json();
  const inTok = j?.usage?.prompt_tokens;
  const outTok = j?.usage?.completion_tokens;
  if (![inTok, outTok].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000)) throw new Error('vision_usage_missing');
  return { text: String(j?.choices?.[0]?.message?.content ?? '').slice(0, 3000) || 'The model returned no description.', inTok, outTok };
}
