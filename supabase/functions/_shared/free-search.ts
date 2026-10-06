// Keyless web search and page reading for agents, used when the gateway has no search provider configured
// (or returns nothing). DuckDuckGo's HTML page for web results, Google News / Bing News RSS for recent news, Wikipedia for background.
// Page reading fetches public http(s) pages only: private, local and metadata addresses are refused at every redirect.

export interface SearchHit { title: string; url: string; snippet: string; date?: string }
type Fetcher = typeof fetch;

const UA = 'Mozilla/5.0 (compatible; FirboAgent/1.0; +https://firboai.app)';
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#x27': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (m, e: string) => {
    const k = e.toLowerCase();
    if (k in ENTITIES) return ENTITIES[k];
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16) || 32);
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10) || 32);
    return m;
  });
}
const text = (html: string) => decodeEntities(html.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** Shows percent-encoded letters (Greek, Arabic, Chinese...) as letters: same link, far fewer tokens for the model to copy. */
export function readableUrl(url: string): string {
  return url.replace(/(?:%[89a-f][0-9a-f]|%[c-f][0-9a-f](?:%[89ab][0-9a-f])+)+/gi, run => {
    try { return decodeURIComponent(run); } catch { return run; }
  });
}

/** Results from https://html.duckduckgo.com/html/ (links come wrapped in a /l/?uddg= redirect). */
export function parseDuckDuckGo(html: string, max = 6): SearchHit[] {
  const out: SearchHit[] = [];
  for (const chunk of html.split('class="result__a"').slice(1)) {
    const href = /href="([^"]+)"/.exec(chunk)?.[1] ?? '';
    const title = text(/>([\s\S]*?)<\/a>/.exec(chunk)?.[1] ?? '');
    const snippet = text(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(chunk)?.[1] ?? '');
    let url = decodeEntities(href);
    const wrapped = /[?&]uddg=([^&]+)/.exec(url);
    if (wrapped) { try { url = decodeURIComponent(wrapped[1]); } catch { /* keep as is */ } }
    if (url.startsWith('//')) url = 'https:' + url;
    if (!/^https?:\/\//.test(url) || /duckduckgo\.com\/y\.js/.test(url) || !title) continue;
    out.push({ title: title.slice(0, 160), url: url.slice(0, 400), snippet: snippet.slice(0, 300) });
    if (out.length >= max) break;
  }
  return out;
}

/** Bing News wraps article links in apiclick.aspx?...&url=<real link>; return the real link. */
function unwrapNewsLink(link: string): string {
  const wrapped = /^https?:\/\/www\.bing\.com\/news\/apiclick\.aspx\?[^#]*?[?&]url=([^&]+)/i.exec(link);
  if (!wrapped) return link;
  try { return decodeURIComponent(wrapped[1]); } catch { return link; }
}

/** Items of an RSS feed (Google News, Bing News). */
export function parseRss(xml: string, max = 5): SearchHit[] {
  const out: SearchHit[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    const pick = (tag: string) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(item)?.[1] ?? '';
    const title = text(pick('title'));
    const url = unwrapNewsLink(text(pick('link')));
    if (!title || !/^https?:\/\//.test(url)) continue;
    const date = text(pick('pubDate'));
    out.push({ title: title.slice(0, 160), url: url.slice(0, 600), snippet: text(pick('description')).slice(0, 200), ...(date ? { date } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

/** Results of the Wikipedia search API (JSON). */
export function parseWikipedia(json: string, wiki: string, max = 3): SearchHit[] {
  let rows: { title?: unknown; snippet?: unknown }[] = [];
  try { rows = JSON.parse(json)?.query?.search ?? []; } catch { return []; }
  return (Array.isArray(rows) ? rows : []).slice(0, max)
    .filter(r => typeof r?.title === 'string' && r.title)
    .map(r => ({ title: String(r.title).slice(0, 160), url: `https://${wiki}.wikipedia.org/wiki/${encodeURIComponent(String(r.title).replace(/ /g, '_'))}`, snippet: text(String(r.snippet ?? '')).slice(0, 300) }));
}

const NEWS_REGION: Record<string, string> = {
  el: 'hl=el&gl=GR&ceid=GR:el', es: 'hl=es&gl=ES&ceid=ES:es', 'pt-BR': 'hl=pt-BR&gl=BR&ceid=BR:pt-419', de: 'hl=de&gl=DE&ceid=DE:de',
  fr: 'hl=fr&gl=FR&ceid=FR:fr', 'zh-CN': 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans', ar: 'hl=ar&gl=EG&ceid=EG:ar', en: 'hl=en-US&gl=US&ceid=US:en',
};
const BING_MARKET: Record<string, string> = {
  el: 'setlang=el&cc=GR', es: 'setlang=es&cc=ES', 'pt-BR': 'setlang=pt-BR&cc=BR', de: 'setlang=de&cc=DE',
  fr: 'setlang=fr&cc=FR', 'zh-CN': 'setlang=zh-Hans&cc=CN', ar: 'setlang=ar&cc=EG', en: 'setlang=en-US&cc=US',
};

/**
 * Web results, recent news and encyclopedia entries for a query, formatted for the model.
 * Several keyless sources are asked at once because some refuse cloud servers (DuckDuckGo and Google News
 * do from Supabase's edge network); Bing News RSS and Wikipedia answer there.
 * Throws (with the reason per source) when nothing was found.
 */
export async function freeWebSearch(query: string, lang: string, fetcher: Fetcher = fetch, signal?: AbortSignal, o: { tavilyKey?: string } = {}): Promise<string> {
  // A search key set by the platform owner (Supabase secret TAVILY_API_KEY) gives real web results from the cloud,
  // where the keyless sources are often blocked; without it, or when it finds nothing, the keyless sources are used.
  if (o.tavilyKey) {
    const found = await tavilySearch(query, o.tavilyKey, fetcher, signal).catch(() => '');
    if (found) return found;
  }
  try {
    return await searchOnce(query, lang, fetcher, signal);
  } catch (error) {
    // Long, sentence-like queries (typical of models) often find nothing in news feeds: retry with the key words.
    const short = shortQuery(query);
    if (!short || short === query.trim()) throw error;
    return await searchOnce(short, lang, fetcher, signal);
  }
}

/** Web results from Tavily's search API, in the same "1. Title - link" shape as the other sources ('' when none). */
export async function tavilySearch(query: string, key: string, fetcher: Fetcher = fetch, signal?: AbortSignal, max = 6): Promise<string> {
  if (!/^[\w-]{10,200}$/.test(key)) return '';
  const res = await fetcher('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query: query.slice(0, 400), max_results: max, search_depth: 'basic', include_answer: false }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`tavily_http_${res.status}`);
  const rows = (await res.json())?.results;
  if (!Array.isArray(rows)) return '';
  return rows.filter((r: any) => typeof r?.url === 'string' && /^https?:\/\//.test(r.url) && typeof r?.title === 'string').slice(0, max)
    .map((r: any, i: number) => `${i + 1}. ${text(r.title).slice(0, 160)} - ${readableUrl(String(r.url).slice(0, 400))}${r.content ? `\n   ${text(String(r.content)).slice(0, 300)}` : ''}`)
    .join('\n');
}

/** The first few meaningful words of a query (no years or numbers), or '' when it is already short. */
export function shortQuery(query: string): string {
  const words = query.split(/\s+/).filter(w => w.length > 2 && !/^\d+$/.test(w));
  return words.length > 4 ? words.slice(0, 4).join(' ') : '';
}

async function searchOnce(query: string, lang: string, fetcher: Fetcher, signal?: AbortSignal): Promise<string> {
  const q = encodeURIComponent(query.slice(0, 200));
  const wiki = (lang.split('-')[0] || 'en').toLowerCase();
  const get = async (url: string) => {
    const res = await fetcher(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml,application/json' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`search_http_${res.status}`);
    return (await res.text()).slice(0, 600_000);
  };
  const problems: string[] = [];
  const ask = (source: string, url: string, parse: (body: string) => SearchHit[]) => get(url)
    .then(body => { const hits = parse(body); if (!hits.length) problems.push(`${source}:empty_${body.length}`); return hits; })
    .catch((error: unknown) => { problems.push(`${source}:${error instanceof Error ? error.message.slice(0, 30) : 'error'}`); return [] as SearchHit[]; });
  const [web, gnews, bnews, encyclopedia] = await Promise.all([
    ask('ddg', `https://html.duckduckgo.com/html/?q=${q}`, h => parseDuckDuckGo(h)),
    ask('gnews', `https://news.google.com/rss/search?q=${q}&${NEWS_REGION[lang] ?? NEWS_REGION.en}`, x => parseRss(x)),
    ask('bnews', `https://www.bing.com/news/search?q=${q}&format=rss&${BING_MARKET[lang] ?? BING_MARKET.en}`, x => parseRss(x, 6)),
    ask('wiki', `https://${wiki}.wikipedia.org/w/api.php?action=query&list=search&format=json&utf8=1&srlimit=3&srsearch=${q}`, j => parseWikipedia(j, wiki)),
  ]);
  const news = gnews.length ? gnews : bnews;
  if (!web.length && !news.length && !encyclopedia.length) throw new Error(`free_search_${problems.join('|')}`.slice(0, 160));
  const lines: string[] = [];
  web.forEach((h, i) => lines.push(`${i + 1}. ${h.title} - ${readableUrl(h.url)}${h.snippet ? `\n   ${h.snippet}` : ''}`));
  if (news.length) lines.push('Recent news:', ...news.map((h, i) => `N${i + 1}. ${h.title}${h.date ? ` (${h.date})` : ''} - ${readableUrl(h.url)}${h.snippet ? `\n   ${h.snippet}` : ''}`));
  if (encyclopedia.length) lines.push('Encyclopedia:', ...encyclopedia.map((h, i) => `W${i + 1}. ${h.title} - ${readableUrl(h.url)}${h.snippet ? `\n   ${h.snippet}` : ''}`));
  return lines.join('\n');
}

/** Refuses hosts that are not public internet sites (loopback, private ranges, link-local, metadata, single-label). */
export function isPublicHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (!h.includes('.') || h === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(h)) return false;
  if (h.includes(':')) return false; // IPv6 literals: refuse (no reason for an agent to read one)
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  return true;
}

/** Text of a public web page (max ~1 MB read, 3 redirects), or throws. */
export async function readPageDirect(rawUrl: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<string> {
  let url = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || !isPublicHost(u.hostname)) throw new Error('page_not_allowed');
    const res = await fetcher(u.toString(), { redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html,text/plain' },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) throw new Error('page_redirect_without_location');
      url = new URL(next, u).toString();
      continue;
    }
    if (!res.ok) throw new Error(`page_http_${res.status}`);
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type && !/text\/(html|plain)|application\/xhtml/.test(type)) throw new Error('page_not_text');
    const body = (await res.text()).slice(0, 1_000_000);
    const cleaned = body
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ');
    const title = text(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(cleaned)?.[1] ?? '');
    const main = /<(article|main)[\s\S]*?<\/\1>/i.exec(cleaned)?.[0] ?? cleaned;
    const content = text(main);
    return `${title ? `${title}\n` : ''}${content}`.slice(0, 6000);
  }
  throw new Error('page_too_many_redirects');
}

/** Links listed in search results ("1. Title - https://..."), first come first, without repeats. */
export function resultLinks(results: string, max = 2): string[] {
  const out: string[] = [];
  for (const m of results.matchAll(/^\s*(?:[NW]?\d+)\.\s+.+?\s+-\s+(https?:\/\/\S+)/gm)) {
    if (!out.includes(m[1])) out.push(m[1]);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Deep research: the text of the top result pages, read at the same time and only within `budgetMs`
 * (a page that is slow, private or not text is skipped). Small models rarely ask to read pages themselves,
 * so the agent gets the articles, not only their titles.
 */
export async function readTopPages(results: string, fetcher: Fetcher = fetch, signal?: AbortSignal, o: { max?: number; budgetMs?: number; chars?: number } = {}): Promise<{ url: string; text: string }[]> {
  const budget = o.budgetMs ?? 6_000;
  if (budget < 1_500) return [];
  const limit = AbortSignal.timeout(budget);
  const pages = await Promise.all(resultLinks(results, o.max ?? 2).map(url =>
    readPageDirect(url, fetcher, signal ? AbortSignal.any([signal, limit]) : limit)
      .then(text => ({ url, text: text.replace(/\s+/g, ' ').trim().slice(0, o.chars ?? 2500) }))
      .catch(() => null)));
  return pages.filter((p): p is { url: string; text: string } => !!p && p.text.length > 200);
}
