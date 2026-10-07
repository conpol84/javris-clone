/** Arbitrary page reads must use the separately configured pinned transport.
 * There is deliberately no direct-target fallback: lexical URL checks inside an
 * Edge Function cannot bind the subsequent fetch to the DNS answer they checked.
 */

type Fetcher = typeof fetch;

const MAX_TARGET_BYTES = 2_000;
const MAX_RESPONSE_BYTES = 1_000_000;

function serviceConfiguration(): { endpoint: string; token: string } {
  const deno = (globalThis as any).Deno;
  // A complete runner bundle can recover ordinary tasks before the separately
  // deployed transport is accepted. Merely having URL/token values is not a release.
  if (deno?.env?.get?.('FIRBO_PAGE_EGRESS_ENABLED') !== 'on') throw new Error('page_egress_unavailable');
  const endpoint = deno?.env?.get?.('FIRBO_PAGE_EGRESS_URL') ?? '';
  const token = deno?.env?.get?.('FIRBO_PAGE_EGRESS_TOKEN') ?? '';
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('page_egress_unavailable'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/v1/page' || token.length < 32 || !/^[\x21-\x7e]+$/.test(token)) {
    throw new Error('page_egress_unavailable');
  }
  return { endpoint: url.href, token };
}

function targetAllowed(rawUrl: string): boolean {
  if (new TextEncoder().encode(rawUrl).length > MAX_TARGET_BYTES
    || /[\x00-\x20\x7f\\]/.test(rawUrl)) return false;
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      && url.port === '' && host.includes('.') && !host.includes(':')
      && !/^\d+(?:\.\d+){3}$/.test(host)
      && !/(^|\.)(?:local|internal|localhost|lan|home|corp|test|invalid)$/.test(host);
  } catch {
    return false;
  }
}

/** Fetches one public HTTPS page through the operator-controlled pinned service. */
export async function pageEgressFetch(rawUrl: string, fetcher: Fetcher = fetch,
  signal?: AbortSignal): Promise<Response> {
  if (!targetAllowed(rawUrl)) throw new Error('page_not_allowed');
  const { endpoint, token } = serviceConfiguration();
  const deadline = AbortSignal.timeout(20_000);
  const response = await fetcher(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ url: rawUrl }),
    redirect: 'error',
    signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
  });
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d{1,7}$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
    throw new Error('page_too_large');
  }
  return response;
}

/** Reads a bounded service response without trusting Content-Length alone. */
export async function boundedPageText(response: Response): Promise<string> {
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.length > MAX_RESPONSE_BYTES) throw new Error('page_too_large');
  return new TextDecoder('utf-8', { fatal: false }).decode(body);
}
