// Firbo AI integrations: connect Slack / Discord / Telegram / a generic webhook to a company and send messages through them.
//
// Guarantees (enforced here, not in the browser):
//  - only owners, admins and managers of the company may connect, test, send or disconnect
//  - webhook URLs and bot tokens are stored in a table no client can read; they never come back in a response
//  - a connection is verified with a real test message BEFORE it is saved, so wrong URLs fail immediately
//  - generic webhooks must be public https hosts (no localhost, no IP addresses, no internal names)
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const MANAGERS = ['owner', 'admin', 'manager'];
const KINDS = ['slack', 'discord', 'telegram', 'webhook'] as const;
type Kind = (typeof KINDS)[number];

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

/** Validate the user's input for one kind and return what to store (secret) and show (config). */
function parseFields(kind: Kind, f: Record<string, unknown>): { secret: string; config: Record<string, unknown> } | null {
  if (kind === 'slack') {
    const u = publicHttps(f.webhook_url);
    if (!u || u.hostname !== 'hooks.slack.com' || !u.pathname.startsWith('/services/')) return null;
    return { secret: u.toString(), config: { host: u.hostname } };
  }
  if (kind === 'discord') {
    const u = publicHttps(f.webhook_url);
    if (!u || !['discord.com', 'discordapp.com'].includes(u.hostname) || !u.pathname.startsWith('/api/webhooks/')) return null;
    return { secret: u.toString(), config: { host: u.hostname } };
  }
  if (kind === 'telegram') {
    const token = typeof f.bot_token === 'string' ? f.bot_token.trim() : '';
    const chat = String(f.chat_id ?? '').trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token) || !/^(-?\d{3,20}|@[A-Za-z0-9_]{4,64})$/.test(chat)) return null;
    return { secret: token, config: { chat_id: chat } };
  }
  const u = publicHttps(f.url);
  if (!u) return null;
  return { secret: u.toString(), config: { host: u.hostname } };
}

async function post(kind: Kind, secret: string, config: Record<string, unknown>, text: string): Promise<void> {
  const t = text.slice(0, kind === 'discord' ? 1900 : 3500);
  const jsonHeaders = { 'content-type': 'application/json' };
  let res: Response;
  if (kind === 'slack') res = await fetch(secret, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ text: t }), signal: AbortSignal.timeout(10_000) });
  else if (kind === 'discord') res = await fetch(secret, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ content: t }), signal: AbortSignal.timeout(10_000) });
  else if (kind === 'telegram') {
    res = await fetch(`https://api.telegram.org/bot${secret}/sendMessage`, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ chat_id: config.chat_id, text: t }), signal: AbortSignal.timeout(10_000) });
  } else {
    res = await fetch(secret, { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ source: 'firbo-ai', text: t }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
  }
  if (!res.ok) throw new Error(`http_${res.status}`);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });

  let body: Record<string, any> = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const admin = createClient(url, service);
  const isManager = async (orgId: string) => {
    const { data } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
    return !!data && MANAGERS.includes(data.role);
  };

  if (body.action === 'connect') {
    const orgId = String(body.organization_id ?? '');
    const kind = body.kind as Kind;
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    if (!orgId || !KINDS.includes(kind) || !name) return json(400, { error: 'bad_request' });
    if (!(await isManager(orgId))) return json(403, { error: 'forbidden' });
    const parsed = parseFields(kind, (body.fields ?? {}) as Record<string, unknown>);
    if (!parsed) return json(422, { error: 'invalid_fields' });
    const { count } = await admin.from('integrations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    if ((count ?? 0) >= 20) return json(429, { error: 'too_many' });
    try {
      await post(kind, parsed.secret, parsed.config, `✅ ${name}: Firbo AI is connected.`);
    } catch {
      return json(502, { error: 'test_failed' });
    }
    const { data: row, error } = await admin
      .from('integrations')
      .insert({ organization_id: orgId, kind, name, config: parsed.config, created_by: user.id, last_used_at: new Date().toISOString() })
      .select('id, kind, name, config, status, last_error, last_used_at, created_at')
      .single();
    if (error || !row) return json(500, { error: 'save_failed' });
    await admin.from('integration_secrets').insert({ integration_id: row.id, secret: parsed.secret });
    return json(200, { integration: row });
  }

  const id = String(body.id ?? '');
  if (!id) return json(400, { error: 'bad_request' });
  const { data: integ } = await admin.from('integrations').select('id, organization_id, kind, name, config').eq('id', id).maybeSingle();
  if (!integ) return json(404, { error: 'not_found' });
  if (!(await isManager(integ.organization_id))) return json(403, { error: 'forbidden' });

  if (body.action === 'disconnect') {
    await admin.from('integrations').delete().eq('id', id);
    return json(200, { ok: true });
  }

  if (body.action === 'test' || body.action === 'send') {
    const text = body.action === 'test' ? `✅ ${integ.name}: test message from Firbo AI.` : typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(400, { error: 'bad_request' });
    const { data: sec } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
    if (!sec) return json(404, { error: 'not_found' });
    try {
      await post(integ.kind as Kind, sec.secret, (integ.config ?? {}) as Record<string, unknown>, text);
      await admin.from('integrations').update({ status: 'active', last_error: null, last_used_at: new Date().toISOString() }).eq('id', id);
      return json(200, { ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      await admin.from('integrations').update({ status: 'error', last_error: msg.slice(0, 120) }).eq('id', id);
      return json(502, { error: 'send_failed' });
    }
  }
  return json(400, { error: 'bad_request' });
});
