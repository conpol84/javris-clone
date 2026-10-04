// Keyless web search and page reading for agents, used when the gateway has no search provider configured
// (or returns nothing). DuckDuckGo's HTML page for web results, Google News RSS for recent news.
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

/** Items of an RSS feed (Google News). */
export function parseRss(xml: string, max = 5): SearchHit[] {
  const out: SearchHit[] = [];
  for (const item of xml.split('<item>').slice(1)) {
    const pick = (tag: string) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(item)?.[1] ?? '';
    const title = text(pick('title'));
    const url = text(pick('link'));
    if (!title || !/^https?:\/\//.test(url)) continue;
    const date = text(pick('pubDate'));
    out.push({ title: title.slice(0, 160), url: url.slice(0, 600), snippet: text(pick('description')).slice(0, 200), ...(date ? { date } : {}) });
    if (out.length >= max) break;
  }
  return out;
}

const NEWS_REGION: Record<string, string> = {
  el: 'hl=el&gl=GR&ceid=GR:el', es: 'hl=es&gl=ES&ceid=ES:es', 'pt-BR': 'hl=pt-BR&gl=BR&ceid=BR:pt-419', de: 'hl=de&gl=DE&ceid=DE:de',
  fr: 'hl=fr&gl=FR&ceid=FR:fr', 'zh-CN': 'hl=zh-CN&gl=CN&ceid=CN:zh-Hans', ar: 'hl=ar&gl=EG&ceid=EG:ar', en: 'hl=en-US&gl=US&ceid=US:en',
};

/** Web results plus recent news for a query, formatted for the model. Empty string when nothing was found. */
export async function freeWebSearch(query: string, lang: string, fetcher: Fetcher = fetch, signal?: AbortSignal): Promise<string> {
  const q = encodeURIComponent(query.slice(0, 200));
  const get = async (url: string) => {
    const res = await fetcher(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xml' }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`search_http_${res.status}`);
    return (await res.text()).slice(0, 600_000);
  };
  const [web, news] = await Promise.all([
    get(`https://html.duckduckgo.com/html/?q=${q}`).then(h => parseDuckDuckGo(h)).catch(() => [] as SearchHit[]),
    get(`https://news.google.com/rss/search?q=${q}&${NEWS_REGION[lang] ?? NEWS_REGION.en}`).then(x => parseRss(x)).catch(() => [] as SearchHit[]),
  ]);
  const lines: string[] = [];
  web.forEach((h, i) => lines.push(`${i + 1}. ${h.title} - ${h.url}${h.snippet ? `\n   ${h.snippet}` : ''}`));
  if (news.length) lines.push('Recent news:', ...news.map((h, i) => `N${i + 1}. ${h.title}${h.date ? ` (${h.date})` : ''} - ${h.url}`));
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
