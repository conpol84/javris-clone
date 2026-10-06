/** Tenant MCP traffic must go through the separately configured pinned transport.
 * There is deliberately no direct-fetch fallback. The operator URL is trusted
 * bootstrap configuration, never a company-supplied target or credential.
 */
export async function mcpEgressFetch(target: string, init: RequestInit): Promise<Response> {
  const endpoint = Deno.env.get('FIRBO_MCP_EGRESS_URL') ?? '';
  const key = Deno.env.get('FIRBO_MCP_EGRESS_TOKEN') ?? '';
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error('egress_unavailable'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash
    || url.pathname !== '/v1/mcp' || key.length < 32 || !/^[\x21-\x7e]+$/.test(key)) {
    throw new Error('egress_unavailable');
  }
  if (init.method !== 'POST' || typeof init.body !== 'string' || new TextEncoder().encode(init.body).length > 30_000) {
    throw new Error('egress_request_denied');
  }
  const input = new Headers(init.headers);
  const headers: Record<string, string> = {};
  for (const name of ['authorization', 'mcp-session-id']) {
    const value = input.get(name);
    if (value) headers[name] = value;
  }
  const response = await fetch(url.href, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ url: target, body: init.body, headers }),
    signal: init.signal, redirect: 'error',
  });
  // Proxy errors are never treated as success and never trigger direct retry.
  return response;
}
