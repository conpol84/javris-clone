// Firbo AI integrations: connect messaging, email and work apps to a company and send through them.
//
// Guarantees (enforced here, not in the browser):
//  - only owners, admins and managers of the company may connect, test, send or disconnect
//  - webhook URLs and bot tokens are stored in a table no client can read; they never come back in a response
//  - a connection is verified with a real test message BEFORE it is saved, so wrong URLs fail immediately
//  - user-supplied hosts must be public https hosts (no localhost, no IP addresses, no internal names)
//  - a connection is verified before it is saved: messaging apps get a test message, work tools a read-only credential check
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const MANAGERS = ['owner', 'admin', 'manager'];
const TIMEOUT = 12_000;

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

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const hostIs = (u: URL, ...hosts: string[]) => hosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
const J = { 'content-type': 'application/json' };
const sig = () => AbortSignal.timeout(TIMEOUT);
const ok = async (res: Response) => {
  if (!res.ok) throw new Error(`http_${res.status}`);
};
const b64 = (s: string) => btoa(s);

type Parsed = { secret: Record<string, string>; config: Record<string, unknown> };
interface Provider {
  /** true: connecting sends a visible test message. false: a read-only check is used and nothing is posted. */
  messaging: boolean;
  parse(f: Record<string, unknown>): Parsed | null;
  /** Read-only credential check (work tools). */
  verify?(s: Record<string, string>, c: Record<string, unknown>): Promise<void>;
  send(s: Record<string, string>, c: Record<string, unknown>, text: string): Promise<void>;
}

const webhookProvider = (check: (u: URL) => boolean, payload: (t: string) => unknown): Provider => ({
  messaging: true,
  parse: (f) => {
    const u = publicHttps(f.webhook_url);
    if (!u || !check(u)) return null;
    return { secret: { url: u.toString() }, config: { host: u.hostname } };
  },
  send: async (s, _c, t) => ok(await fetch(s.url, { method: 'POST', headers: J, body: JSON.stringify(payload(t)), signal: sig(), redirect: 'error' })),
});

const PROVIDERS: Record<string, Provider> = {
  slack: webhookProvider((u) => u.hostname === 'hooks.slack.com' && u.pathname.startsWith('/services/'), (t) => ({ text: t.slice(0, 3500) })),
  discord: webhookProvider((u) => ['discord.com', 'discordapp.com'].includes(u.hostname) && u.pathname.startsWith('/api/webhooks/'), (t) => ({ content: t.slice(0, 1900) })),
  teams: webhookProvider((u) => hostIs(u, 'webhook.office.com', 'logic.azure.com', 'api.powerplatform.com'), (t) => ({ text: t.slice(0, 3500) })),
  googlechat: webhookProvider((u) => u.hostname === 'chat.googleapis.com' && u.pathname.startsWith('/v1/spaces/'), (t) => ({ text: t.slice(0, 3500) })),
  mattermost: webhookProvider((u) => u.pathname.includes('/hooks/'), (t) => ({ text: t.slice(0, 3500) })),
  webhook: {
    messaging: true,
    parse: (f) => {
      const u = publicHttps(f.url);
      return u ? { secret: { url: u.toString() }, config: { host: u.hostname } } : null;
    },
    send: async (s, _c, t) => ok(await fetch(s.url, { method: 'POST', headers: J, body: JSON.stringify({ source: 'firbo-ai', text: t.slice(0, 3500) }), signal: sig(), redirect: 'error' })),
  },
  telegram: {
    messaging: true,
    parse: (f) => {
      const token = str(f.bot_token);
      const chat = str(f.chat_id, 64);
      if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token) || !/^(-?\d{3,20}|@[A-Za-z0-9_]{4,64})$/.test(chat)) return null;
      return { secret: { token }, config: { chat_id: chat } };
    },
    send: async (s, c, t) => ok(await fetch(`https://api.telegram.org/bot${s.token}/sendMessage`, { method: 'POST', headers: J, body: JSON.stringify({ chat_id: c.chat_id, text: t.slice(0, 3500) }), signal: sig() })),
  },
  ntfy: {
    messaging: true,
    parse: (f) => {
      const u = publicHttps(f.topic_url);
      return u && u.pathname.length > 1 ? { secret: { url: u.toString() }, config: { host: u.hostname } } : null;
    },
    send: async (s, _c, t) => ok(await fetch(s.url, { method: 'POST', body: t.slice(0, 3500), headers: { Title: 'Firbo AI' }, signal: sig(), redirect: 'error' })),
  },
  pushover: {
    messaging: true,
    parse: (f) => {
      const token = str(f.api_token, 60);
      const user = str(f.user_key, 60);
      return /^[A-Za-z0-9]{20,40}$/.test(token) && /^[A-Za-z0-9]{20,40}$/.test(user) ? { secret: { token, user }, config: {} } : null;
    },
    send: async (s, _c, t) => ok(await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: s.token, user: s.user, title: 'Firbo AI', message: t.slice(0, 1000) }), signal: sig() })),
  },
  whatsapp: {
    messaging: true,
    parse: (f) => {
      const token = str(f.access_token, 600);
      const phone = str(f.phone_number_id, 30);
      const to = str(f.to, 20).replace(/[^\d]/g, '');
      return token.length > 20 && /^\d{5,25}$/.test(phone) && /^\d{7,15}$/.test(to) ? { secret: { token }, config: { phone_number_id: phone, to } } : null;
    },
    send: async (s, c, t) =>
      ok(await fetch(`https://graph.facebook.com/v20.0/${c.phone_number_id}/messages`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}` }, body: JSON.stringify({ messaging_product: 'whatsapp', to: c.to, type: 'text', text: { body: t.slice(0, 3500) } }), signal: sig() })),
  },
  twilio: {
    messaging: true,
    parse: (f) => {
      const sid = str(f.account_sid, 40);
      const token = str(f.auth_token, 64);
      const from = str(f.from, 20);
      const to = str(f.to, 20);
      const phone = /^\+\d{7,15}$/;
      return /^AC[a-f0-9]{32}$/i.test(sid) && /^[a-f0-9]{32}$/i.test(token) && phone.test(from) && phone.test(to) ? { secret: { sid, token }, config: { from, to } } : null;
    },
    send: async (s, c, t) =>
      ok(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.sid}/Messages.json`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${b64(`${s.sid}:${s.token}`)}` }, body: new URLSearchParams({ To: String(c.to), From: String(c.from), Body: t.slice(0, 1500) }), signal: sig() })),
  },
  resend: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 100);
      const from = str(f.from, 200);
      const to = str(f.to, 200);
      const mail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$|^[^<>]{1,80}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>$/;
      return /^re_[A-Za-z0-9_]{10,}$/.test(key) && mail.test(from) && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to) ? { secret: { key }, config: { from, to } } : null;
    },
    verify: async (s) => ok(await fetch('https://api.resend.com/domains', { headers: { authorization: `Bearer ${s.key}` }, signal: sig() })),
    send: async (s, c, t) =>
      ok(await fetch('https://api.resend.com/emails', { method: 'POST', headers: { ...J, authorization: `Bearer ${s.key}` }, body: JSON.stringify({ from: c.from, to: [c.to], subject: t.split('\n')[0].slice(0, 120) || 'Message from Firbo AI', text: t.slice(0, 10000) }), signal: sig() })),
  },
  sendgrid: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 120);
      const from = str(f.from, 200);
      const to = str(f.to, 200);
      const mail = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
      return /^SG\.[A-Za-z0-9_.-]{20,}$/.test(key) && mail.test(from) && mail.test(to) ? { secret: { key }, config: { from, to } } : null;
    },
    verify: async (s) => ok(await fetch('https://api.sendgrid.com/v3/scopes', { headers: { authorization: `Bearer ${s.key}` }, signal: sig() })),
    send: async (s, c, t) =>
      ok(await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { ...J, authorization: `Bearer ${s.key}` }, body: JSON.stringify({ personalizations: [{ to: [{ email: c.to }] }], from: { email: c.from }, subject: t.split('\n')[0].slice(0, 120) || 'Message from Firbo AI', content: [{ type: 'text/plain', value: t.slice(0, 10000) }] }), signal: sig() })),
  },
  notion: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 200);
      const page = str(f.parent_id, 60).replace(/-/g, '');
      return /^(secret_|ntn_)[A-Za-z0-9]{20,}$/.test(token) && /^[a-f0-9]{32}$/i.test(page) ? { secret: { token }, config: { parent_id: page } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://api.notion.com/v1/pages/${c.parent_id}`, { headers: { authorization: `Bearer ${s.token}`, 'Notion-Version': '2022-06-28' }, signal: sig() })),
    send: async (s, c, t) =>
      ok(await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}`, 'Notion-Version': '2022-06-28' }, body: JSON.stringify({ parent: { page_id: c.parent_id }, properties: { title: { title: [{ text: { content: t.split('\n')[0].slice(0, 200) || 'Firbo AI' } }] } }, children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 1900) } }] } }] }), signal: sig() })),
  },
  airtable: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 200);
      const base = str(f.base_id, 30);
      const table = str(f.table, 100);
      return /^pat[A-Za-z0-9._]{20,}$/.test(token) && /^app[A-Za-z0-9]{10,}$/.test(base) && table.length > 0 ? { secret: { token }, config: { base_id: base, table } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(String(c.table))}?maxRecords=1`, { headers: { authorization: `Bearer ${s.token}` }, signal: sig() })),
    send: async (s, c, t) =>
      ok(await fetch(`https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(String(c.table))}`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}` }, body: JSON.stringify({ fields: { Name: t.slice(0, 1000) } }), signal: sig() })),
  },
  linear: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 100);
      const team = str(f.team_id, 60);
      return /^lin_api_[A-Za-z0-9]{20,}$/.test(key) && /^[0-9a-f-]{36}$/i.test(team) ? { secret: { key }, config: { team_id: team } } : null;
    },
    verify: async (s) => {
      const r = await fetch('https://api.linear.app/graphql', { method: 'POST', headers: { ...J, authorization: s.key }, body: JSON.stringify({ query: '{ viewer { id } }' }), signal: sig() });
      await ok(r);
      if ((await r.json())?.errors) throw new Error('graphql');
    },
    send: async (s, c, t) => {
      const r = await fetch('https://api.linear.app/graphql', { method: 'POST', headers: { ...J, authorization: s.key }, body: JSON.stringify({ query: 'mutation($i: IssueCreateInput!){ issueCreate(input:$i){ success } }', variables: { i: { teamId: c.team_id, title: t.split('\n')[0].slice(0, 200) || 'Firbo AI', description: t.slice(0, 5000) } } }), signal: sig() });
      await ok(r);
      if ((await r.json())?.errors) throw new Error('graphql');
    },
  },
  github: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 200);
      const repo = str(f.repo, 140);
      return /^(ghp_|github_pat_)[A-Za-z0-9_]{20,}$/.test(token) && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? { secret: { token }, config: { repo } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://api.github.com/repos/${c.repo}`, { headers: { authorization: `Bearer ${s.token}`, 'user-agent': 'firbo-ai', accept: 'application/vnd.github+json' }, signal: sig() })),
    send: async (s, c, t) =>
      ok(await fetch(`https://api.github.com/repos/${c.repo}/issues`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}`, 'user-agent': 'firbo-ai', accept: 'application/vnd.github+json' }, body: JSON.stringify({ title: t.split('\n')[0].slice(0, 200) || 'Firbo AI', body: t.slice(0, 6000) }), signal: sig() })),
  },
  mastodon: {
    messaging: false,
    parse: (f) => {
      const u = publicHttps(f.instance_url);
      const token = str(f.access_token, 200);
      return u && token.length >= 20 ? { secret: { token }, config: { instance: u.origin } } : null;
    },
    verify: async (s, c) => ok(await fetch(`${c.instance}/api/v1/accounts/verify_credentials`, { headers: { authorization: `Bearer ${s.token}` }, signal: sig(), redirect: 'error' })),
    send: async (s, c, t) => ok(await fetch(`${c.instance}/api/v1/statuses`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}` }, body: JSON.stringify({ status: t.slice(0, 480), visibility: 'public' }), signal: sig(), redirect: 'error' })),
  },
};

/** Secrets are stored as one JSON string per connection; old rows hold a bare URL/token. */
function readSecret(kind: string, raw: string): Record<string, string> {
  try {
    const o = JSON.parse(raw);
    if (o && typeof o === 'object') return o as Record<string, string>;
  } catch {
    /* legacy plain string */
  }
  return kind === 'telegram' ? { token: raw } : { url: raw };
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
    const kind = String(body.kind ?? '');
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const provider = PROVIDERS[kind];
    if (!orgId || !provider || !name) return json(400, { error: 'bad_request' });
    if (!(await isManager(orgId))) return json(403, { error: 'forbidden' });
    const parsed = provider.parse((body.fields ?? {}) as Record<string, unknown>);
    if (!parsed) return json(422, { error: 'invalid_fields' });
    const { count } = await admin.from('integrations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    const { data: cap } = await admin.rpc('plan_limit', { p_org: orgId, p_key: 'integrations' });
    if ((count ?? 0) >= Number(cap ?? 2)) return json(429, { error: 'plan_limit' });
    try {
      if (provider.messaging) await provider.send(parsed.secret, parsed.config, `✅ ${name}: Firbo AI is connected.`);
      else await provider.verify!(parsed.secret, parsed.config);
    } catch {
      return json(502, { error: 'test_failed' });
    }
    const { data: row, error } = await admin
      .from('integrations')
      .insert({ organization_id: orgId, kind, name, config: parsed.config, created_by: user.id, last_used_at: new Date().toISOString() })
      .select('id, kind, name, config, status, last_error, last_used_at, created_at')
      .single();
    if (error || !row) return json(error?.message?.includes('plan_limit') ? 429 : 500, { error: error?.message?.includes('plan_limit') ? 'plan_limit' : 'save_failed' });
    await admin.from('integration_secrets').insert({ integration_id: row.id, secret: JSON.stringify(parsed.secret) });
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
    const provider = PROVIDERS[integ.kind];
    if (!provider) return json(400, { error: 'bad_request' });
    const text = body.action === 'test' ? `✅ ${integ.name}: test message from Firbo AI.` : typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(400, { error: 'bad_request' });
    const { data: sec } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
    if (!sec) return json(404, { error: 'not_found' });
    const secret = readSecret(integ.kind, sec.secret);
    const config = (integ.config ?? {}) as Record<string, unknown>;
    try {
      // A test of a work tool is read-only: it must never create issues, pages or posts by itself.
      if (body.action === 'test' && !provider.messaging) await provider.verify!(secret, config);
      else await provider.send(secret, config, text);
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
