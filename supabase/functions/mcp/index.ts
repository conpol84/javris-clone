// Firbo AI MCP client: connect any remote MCP server (streamable HTTP) to a company, list its tools and call them.
//
// Guarantees (enforced here, not in the browser):
//  - only owners, admins and managers of the company may connect, list or call
//  - the server address must be a public https host (no localhost, no IP addresses, no internal names)
//  - the access token is stored in a table no client can read and never comes back in a response
//  - calls are time-limited and responses are size-limited
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const MANAGERS = ['owner', 'admin', 'manager'];
const MAX_RESPONSE = 400_000;

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

/** One JSON-RPC call over streamable HTTP. The answer is plain JSON or a server-sent event stream. */
async function rpc(s: Session, method: string, params: unknown, id?: number): Promise<any> {
  const res = await fetch(s.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...s.headers, ...(s.sid ? { 'mcp-session-id': s.sid } : {}) },
    body: JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(25_000),
    redirect: 'error',
  });
  if (!res.ok) throw new Error(`http_${res.status}`);
  const sid = res.headers.get('mcp-session-id');
  if (sid) s.sid = sid;
  if (id === undefined) return null;
  const raw = (await res.text()).slice(0, MAX_RESPONSE);
  let msg: any = null;
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    for (const block of raw.split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
      if (!data) continue;
      try {
        const m = JSON.parse(data);
        if (m.id === id) msg = m;
      } catch {
        /* skip non-JSON events */
      }
    }
  } else {
    try {
      msg = JSON.parse(raw);
    } catch {
      /* handled below */
    }
  }
  if (!msg) throw new Error('bad_response');
  if (msg.error) throw new Error(String(msg.error.message ?? 'mcp_error').slice(0, 160));
  return msg.result;
}

async function open(url: string, token: string): Promise<Session> {
  const s: Session = { url, headers: token ? { authorization: `Bearer ${token}` } : {} };
  await rpc(s, 'initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'firbo-ai', version: '1.0' } }, 1);
  await rpc(s, 'notifications/initialized', {});
  return s;
}

async function listTools(s: Session): Promise<{ name: string; description: string; inputSchema: unknown }[]> {
  const out: { name: string; description: string; inputSchema: unknown }[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 5; i++) {
    const r = await rpc(s, 'tools/list', cursor ? { cursor } : {}, 10 + i);
    for (const t of r?.tools ?? []) out.push({ name: String(t.name).slice(0, 100), description: String(t.description ?? '').slice(0, 300), inputSchema: t.inputSchema ?? {} });
    cursor = r?.nextCursor;
    if (!cursor) break;
  }
  return out.slice(0, 100);
}

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const isManager = async (orgId: string) => {
    const { data } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
    return !!data && MANAGERS.includes(data.role);
  };

  if (body.action === 'connect') {
    const orgId = String(body.organization_id ?? '');
    const name = str(body.name, 80);
    const u = publicHttps(body.server_url);
    const token = str(body.token, 600);
    if (!orgId || !name || !u) return json(422, { error: 'invalid_fields' });
    if (!(await isManager(orgId))) return json(403, { error: 'forbidden' });
    const { count } = await admin.from('integrations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    const { data: cap } = await admin.rpc('plan_limit', { p_org: orgId, p_key: 'integrations' });
    if ((count ?? 0) >= Number(cap ?? 2)) return json(429, { error: 'plan_limit' });
    let tools: Awaited<ReturnType<typeof listTools>>;
    try {
      tools = await listTools(await open(u.toString(), token));
    } catch {
      return json(502, { error: 'test_failed' });
    }
    const { data: row, error } = await admin
      .from('integrations')
      .insert({ organization_id: orgId, kind: 'mcp', name, config: { host: u.hostname, server_url: u.toString(), tools: tools.length }, created_by: user.id, last_used_at: new Date().toISOString() })
      .select('id, kind, name, config, status, last_error, last_used_at, created_at')
      .single();
    if (error || !row) return json(error?.message?.includes('plan_limit') ? 429 : 500, { error: error?.message?.includes('plan_limit') ? 'plan_limit' : 'save_failed' });
    await admin.from('integration_secrets').insert({ integration_id: row.id, secret: JSON.stringify({ token }) });
    return json(200, { integration: row, tools });
  }

  const id = String(body.id ?? '');
  if (!id) return json(400, { error: 'bad_request' });
  const { data: integ } = await admin.from('integrations').select('id, organization_id, kind, config').eq('id', id).maybeSingle();
  if (!integ || integ.kind !== 'mcp') return json(404, { error: 'not_found' });
  if (!(await isManager(integ.organization_id))) return json(403, { error: 'forbidden' });
  const { data: sec } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
  let token = '';
  try {
    token = String(JSON.parse(sec?.secret ?? '{}').token ?? '');
  } catch {
    /* no token */
  }
  const serverUrl = String((integ.config as Record<string, unknown>)?.server_url ?? '');
  if (!publicHttps(serverUrl)) return json(400, { error: 'bad_request' });

  try {
    const s = await open(serverUrl, token);
    if (body.action === 'tools') {
      const tools = await listTools(s);
      await admin.from('integrations').update({ status: 'active', last_error: null, last_used_at: new Date().toISOString(), config: { ...(integ.config as object), tools: tools.length } }).eq('id', id);
      return json(200, { tools });
    }
    if (body.action === 'call') {
      const tool = str(body.tool, 100);
      const args = body.arguments && typeof body.arguments === 'object' && !Array.isArray(body.arguments) ? body.arguments : {};
      if (!tool || JSON.stringify(args).length > 20_000) return json(400, { error: 'bad_request' });
      const r = await rpc(s, 'tools/call', { name: tool, arguments: args }, 20);
      const text = (r?.content ?? []).map((c: { type: string; text?: string }) => (c.type === 'text' ? c.text : `[${c.type}]`)).join('\n').slice(0, 8000);
      await admin.from('integrations').update({ status: 'active', last_error: null, last_used_at: new Date().toISOString() }).eq('id', id);
      return json(200, { text, is_error: !!r?.isError });
    }
    return json(400, { error: 'bad_request' });
  } catch (err) {
    await admin.from('integrations').update({ status: 'error', last_error: (err instanceof Error ? err.message : 'error').slice(0, 120) }).eq('id', id);
    return json(502, { error: 'send_failed' });
  }
});
