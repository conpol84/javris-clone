// Firbo AI MCP client: connect any remote MCP server (streamable HTTP) to a company, list its tools and call them.
//
// Guarantees (enforced here, not in the browser):
//  - only owners, admins and managers of the company may connect, list or call
//  - the server address must be a public https host (no localhost, no IP addresses, no internal names)
//  - the access token is stored in a table no client can read and never comes back in a response
//  - calls are time-limited and response streams are size-limited before decoding
//  - only a tool advertised in the same authenticated session may run
//  - every tool call needs explicit confirmation and a durable pre-execution audit receipt
import { createClient } from 'npm:@supabase/supabase-js@2';
import { mcpEgressFetch } from '../_shared/mcp-egress.ts';
import { discoverMcpTools } from '../_shared/mcp-tool-discovery.ts';
import {
  filterOmniReadOnlyTools,
  isOmniReadOnlyMcpTool,
  omniMcpEndpoint,
  omniMcpPilotEnabled,
} from '../_shared/omni-mcp-policy.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const MANAGERS = ['owner', 'admin', 'manager'];
const MAX_RESPONSE = 400_000;
const MAX_REQUEST = 30_000;

function publicHttps(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw.trim());
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (!h.includes('.') || h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || /^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return null;
    return u;
  } catch {
    return null;
  }
}

interface Session {
  url: string;
  headers: Record<string, string>;
  sid?: string;
}

async function boundedText(stream: ReadableStream<Uint8Array> | null, announced: string | null, max: number): Promise<string> {
  const length = announced === null ? 0 : Number(announced);
  if (!Number.isFinite(length) || length < 0 || length > max) throw new Error('response_too_large');
  if (!stream) return '';
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > max) { await reader.cancel().catch(() => {}); throw new Error('response_too_large'); }
      parts.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error('bad_response'); }
}

async function requestBody(req: Request): Promise<Record<string, any>> {
  const raw = await boundedText(req.body, req.headers.get('content-length'), MAX_REQUEST);
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('bad_request'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('bad_request');
  return value as Record<string, any>;
}

/** One JSON-RPC call over streamable HTTP. The answer is plain JSON or a server-sent event stream. */
async function rpc(s: Session, method: string, params: unknown, id?: number): Promise<any> {
  const res = await mcpEgressFetch(s.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...s.headers, ...(s.sid ? { 'mcp-session-id': s.sid } : {}) },
    body: JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(25_000),
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const sid = res.headers.get('mcp-session-id');
  if (sid) {
    if (!/^[\x21-\x7e]{1,200}$/.test(sid)) throw new Error('bad_session');
    s.sid = sid;
  }
  if (id === undefined) return null;
  const type = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!type.includes('application/json') && !type.includes('text/event-stream')) throw new Error('bad_response');
  const raw = await boundedText(res.body, res.headers.get('content-length'), MAX_RESPONSE);
  let msg: any = null;
  if (type.includes('text/event-stream')) {
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      try {
        const m = JSON.parse(data);
        if (m?.jsonrpc === '2.0' && m.id === id) msg = m;
      } catch {
        /* skip non-JSON events */
      }
    }
  } else {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.jsonrpc === '2.0' && parsed.id === id) msg = parsed;
    } catch {
      /* handled below */
    }
  }
  if (!msg) throw new Error('bad_response');
  if (msg.error) throw new Error('mcp_error');
  return msg.result;
}

async function open(url: string, token: string): Promise<Session> {
  const s: Session = { url, headers: token ? { authorization: `Bearer ${token}` } : {} };
  await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'firbo-ai', version: '1.0' } }, 1);
  await rpc(s, 'notifications/initialized', {});
  return s;
}

async function listTools(
  s: Session,
  sharedOmni = false,
): Promise<{ name: string; description: string; inputSchema: unknown }[]> {
  return discoverMcpTools(
    (params, requestId) => rpc(s, 'tools/list', params, requestId),
    sharedOmni,
  );
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const sha256 = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });

  let body: Record<string, any> = {};
  try { body = await requestBody(req); }
  catch (error) { return json(error instanceof Error && error.message === 'response_too_large' ? 413 : 400, { error: 'bad_request' }); }
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const isManager = async (orgId: string) => {
    const { data } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
    return !!data && MANAGERS.includes(data.role);
  };
  // The shared FIRBO gateway exposes global provider/usage state. A tenant's
  // company-manager role is not permission to access platform-wide OmniRoute.
  const isPlatformAdmin = async () => {
    const { data, error } = await userClient.rpc('is_platform_admin');
    return !error && data === true;
  };

  if (body.action === 'connect') {
    const orgId = String(body.organization_id ?? '');
    const name = str(body.name, 80);
    const u = publicHttps(body.server_url);
    const token = str(body.token, 600);
    const omni = omniMcpEndpoint(body.server_url);
    if (!orgId || !name || !u || omni === 'wrong_path') return json(422, { error: 'invalid_fields' });
    if (!(await isManager(orgId))) return json(403, { error: 'forbidden' });
    if (omni === 'shared' && !(await isPlatformAdmin())) return json(403, { error: 'forbidden' });
    if (omni === 'shared' && !omniMcpPilotEnabled(name => Deno.env.get(name))) return json(503, { error: 'omni_pilot_disabled' });
    const counted = await admin.from('integrations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    const limited = await admin.rpc('plan_limit', { p_org: orgId, p_key: 'integrations' });
    const cap = Number(limited.data);
    if (counted.error || limited.error || counted.count == null || !Number.isFinite(cap) || cap < 0) {
      return json(503, { error: 'plan_unavailable' });
    }
    if (counted.count >= cap) return json(429, { error: 'plan_limit' });
    let tools: Awaited<ReturnType<typeof listTools>>;
    try {
      const advertised = await listTools(await open(u.toString(), token), omni === 'shared');
      tools = omni === 'shared' ? filterOmniReadOnlyTools(advertised) : advertised;
    } catch {
      return json(502, { error: 'test_failed' });
    }
    if (omni === 'shared' && tools.length === 0) return json(403, { error: 'forbidden' });
    const saved = await admin.rpc('firbo_save_legacy_integration', { p_org: orgId, p_user: user.id, p_kind: 'mcp', p_name: name,
      p_config: { host: u.hostname, server_url: u.toString(), tools: tools.length }, p_secret: JSON.stringify({ token }) });
    const code = String(saved.error?.message ?? '');
    if (saved.error || !saved.data?.id) return json(code.includes('plan_limit') ? 429 : code.includes('forbidden') ? 403 : 500,
      { error: code.includes('plan_limit') ? 'plan_limit' : code.includes('forbidden') ? 'forbidden' : 'save_failed' });
    const row = saved.data;
    return json(200, { integration: row, tools });
  }

  const id = String(body.id ?? '');
  if (!id) return json(400, { error: 'bad_request' });
  const { data: integ, error: integrationError } = await admin.from('integrations').select('id, organization_id, kind, config').eq('id', id).maybeSingle();
  if (integrationError) return json(503, { error: 'integration_unavailable' });
  if (!integ || integ.kind !== 'mcp') return json(404, { error: 'not_found' });
  if (!(await isManager(integ.organization_id))) return json(403, { error: 'forbidden' });
  const serverUrl = String((integ.config as Record<string, unknown>)?.server_url ?? '');
  const omni = omniMcpEndpoint(serverUrl);
  if (!publicHttps(serverUrl) || omni === 'wrong_path') return json(400, { error: 'bad_request' });
  // Reject global OmniRoute access before even reading its encrypted company
  // credential. The pilot is OFF unless explicitly enabled by the operator.
  if (omni === 'shared' && !(await isPlatformAdmin())) return json(403, { error: 'forbidden' });
  if (omni === 'shared' && !omniMcpPilotEnabled(name => Deno.env.get(name))) return json(503, { error: 'omni_pilot_disabled' });
  const { data: sec, error: secretError } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
  if (secretError || !sec) return json(503, { error: 'credentials_unavailable' });
  let token = '';
  try {
    token = String(JSON.parse(sec.secret ?? '{}').token ?? '');
  } catch {
    return json(503, { error: 'credentials_unavailable' });
  }

  if (body.action !== 'tools' && body.action !== 'call') return json(400, { error: 'bad_request' });
  let tool = '';
  let args: Record<string, unknown> = {};
  let argsJson = '';
  if (body.action === 'call') {
    tool = str(body.tool, 100);
    args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments) ? body.arguments : {};
    try { argsJson = JSON.stringify(args); } catch { return json(400, { error: 'bad_request' }); }
    if (!tool || argsJson.length > 20_000) return json(400, { error: 'bad_request' });
    // Enforce locally BEFORE remote discovery. Remote self-advertising, even
    // with an over-scoped key, cannot authorize a shared gateway mutation.
    if (omni === 'shared' && !isOmniReadOnlyMcpTool(tool)) return json(403, { error: 'forbidden' });
    // Do not even establish a remote MCP session until the human has confirmed this call.
    if (body.confirm !== true) return json(400, { error: 'confirm_required' });
  }

  try {
    const s = await open(serverUrl, token);
    if (body.action === 'tools') {
      const advertised = await listTools(s, omni === 'shared');
      const tools = omni === 'shared' ? filterOmniReadOnlyTools(advertised) : advertised;
      await admin.from('integrations').update({ status: 'active', last_error: null, last_used_at: new Date().toISOString(), config: { ...(integ.config as object), tools: tools.length } }).eq('id', id);
      return json(200, { tools });
    }
    if (body.action === 'call') {
      const advertised = await listTools(s, omni === 'shared');
      if (!advertised.some(t => t.name === tool)) return json(409, { error: 'tool_not_available' });
      // Re-check the role and platform boundary after remote I/O.
      if (!(await isManager(integ.organization_id))) return json(403, { error: 'forbidden' });
      if (omni === 'shared' && (!(await isPlatformAdmin()) || !isOmniReadOnlyMcpTool(tool))) return json(403, { error: 'forbidden' });
      const argsSha256 = await sha256(argsJson);
      const requested = await admin.from('audit_log').insert({ organization_id: integ.organization_id, actor_id: user.id,
        action: 'mcp.tool_requested', entity: 'integration', entity_id: integ.id,
        metadata: { tool, arguments_sha256: argsSha256, host: publicHttps(serverUrl)?.hostname ?? '' } }).select('id, created_at').single();
      if (requested.error || !requested.data?.id) return json(503, { error: 'audit_unavailable' });
      let r: any;
      try { r = await rpc(s, 'tools/call', { name: tool, arguments: args }, 20); }
      catch {
        await admin.from('audit_log').insert({ organization_id: integ.organization_id, actor_id: user.id,
          action: 'mcp.tool_result_unknown', entity: 'integration', entity_id: integ.id,
          metadata: { tool, request_receipt_id: requested.data.id, arguments_sha256: argsSha256 } });
        await admin.from('integrations').update({ status: 'error', last_error: 'mcp_result_unknown' }).eq('id', id);
        return json(502, { error: 'result_unknown', reconciliation_required: true, receipt: requested.data });
      }
      const text = (Array.isArray(r?.content) ? r.content : []).map((c: { type: string; text?: string }) =>
        c?.type === 'text' ? String(c.text ?? '') : `[${String(c?.type ?? 'unknown').slice(0, 40)}]`).join('\n').slice(0, 8000);
      const resultSha256 = await sha256(JSON.stringify({ text, is_error: !!r?.isError }));
      const completed = await admin.from('audit_log').insert({ organization_id: integ.organization_id, actor_id: user.id,
        action: 'mcp.tool_completed', entity: 'integration', entity_id: integ.id,
        metadata: { tool, request_receipt_id: requested.data.id, arguments_sha256: argsSha256, result_sha256: resultSha256,
          result_bytes: new TextEncoder().encode(text).byteLength, is_error: !!r?.isError } }).select('id, created_at').single();
      if (completed.error || !completed.data?.id) return json(503, { error: 'result_unrecorded', reconciliation_required: true, receipt: requested.data });
      await admin.from('integrations').update({ status: 'active', last_error: null, last_used_at: new Date().toISOString() }).eq('id', id);
      return json(200, { text, is_error: !!r?.isError, receipt: { request_id: requested.data.id, result_id: completed.data.id,
        arguments_sha256: argsSha256, result_sha256: resultSha256 } });
    }
    return json(400, { error: 'bad_request' });
  } catch (err) {
    await admin.from('integrations').update({ status: 'error', last_error: (err instanceof Error ? err.message : 'error').slice(0, 120) }).eq('id', id);
    return json(502, { error: 'send_failed' });
  }
});
