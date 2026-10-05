// Firbo AI integrations: connect messaging, email and work apps to a company and send through them.
//
// Guarantees (enforced here, not in the browser):
//  - only owners, admins and managers of the company may connect, test, send or disconnect
//  - webhook URLs and bot tokens are stored in a table no client can read; they never come back in a response
//  - a connection is verified with a real test message BEFORE it is saved, so wrong URLs fail immediately
//  - user-supplied hosts must be public https hosts (no localhost, no IP addresses, no internal names)
//  - a connection is verified before it is saved: messaging apps get a test message, work tools a read-only credential check
import { createClient } from 'npm:@supabase/supabase-js@2';
import {isConnectionAction,isConnectionCallback,forwardConnectionCallback,connectionAction} from '../_shared/connected-service.ts';
import {ConnectionFailure,isConnectedKind} from '../_shared/connected-providers.ts';
import {isBridgeKind} from '../_shared/device-bridges.ts';

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
  /** Data apps (shops, payments, bookings): never write, only summarise what the agents may look at. */
  readOnly?: boolean;
  read?(s: Record<string, string>, c: Record<string, unknown>): Promise<string>;
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


const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const utf8b64 = (s: string) => btoa(String.fromCharCode(...enc.encode(s)));
const firstLine = (t: string, n = 120) => t.split('\n')[0].trim().slice(0, n);
const bearer = (tok: string) => ({ authorization: `Bearer ${tok}` });
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** RFC 3986 percent-encoding, as OAuth 1.0a requires. */
const pct = (v: string) => encodeURIComponent(v).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a (HMAC-SHA1) Authorization header, used by X (Twitter) user-context calls. */
async function oauth1Header(method: string, rawUrl: string, c: Record<string, string>): Promise<string> {
  const u = new URL(rawUrl);
  const params: Record<string, string> = {
    oauth_consumer_key: c.consumer_key,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ''),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: c.access_token,
    oauth_version: '1.0',
  };
  const all: [string, string][] = [...Object.entries(params), ...[...u.searchParams.entries()]];
  const norm = all.map(([k, v]) => [pct(k), pct(v)] as [string, string]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&');
  const base = `${method.toUpperCase()}&${pct(`${u.origin}${u.pathname}`)}&${pct(norm)}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(`${pct(c.consumer_secret)}&${pct(c.access_token_secret)}`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sigBytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(base)));
  const signed = { ...params, oauth_signature: btoa(String.fromCharCode(...sigBytes)) };
  return `OAuth ${Object.entries(signed).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(', ')}`;
}

async function blueskySession(handle: string, pass: string): Promise<{ did: string; jwt: string }> {
  const r = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', { method: 'POST', headers: J, body: JSON.stringify({ identifier: handle, password: pass }), signal: sig(), redirect: 'error' });
  await ok(r);
  const j = await r.json();
  return { did: String(j.did), jwt: String(j.accessJwt) };
}

async function zoomToken(s: Record<string, string>): Promise<string> {
  const r = await fetch(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(s.account_id)}`, { method: 'POST', headers: { authorization: `Basic ${b64(`${s.client_id}:${s.client_secret}`)}` }, signal: sig() });
  await ok(r);
  return String((await r.json()).access_token);
}

const adf = (t: string) => ({ type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: t.slice(0, 30000) || ' ' }] }] });

// ---------------------------------------------------------------- OAuth (one-click sign-in apps)
// Each provider needs ONE OAuth app registered by the platform owner; its client id/secret live in Edge Function secrets:
//   GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET, MICROSOFT_..., LINKEDIN_..., DROPBOX_...   Redirect URI: <SUPABASE_URL>/functions/v1/integrations
interface OAuthCfg {
  group: 'GOOGLE' | 'MICROSOFT' | 'LINKEDIN' | 'DROPBOX';
  auth: string;
  token: string;
  scopes: string;
  extraAuth?: Record<string, string>;
  /** Who is signed in (shown in the app) and any provider ids needed later. */
  who(access: string): Promise<{ account: string; extra?: Record<string, unknown> }>;
}
const googleWho = async (a: string) => {
  const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: bearer(a), signal: sig() });
  await ok(r);
  return { account: String((await r.json()).email ?? '') };
};
const GOOGLE = { group: 'GOOGLE' as const, auth: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', extraAuth: { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true' }, who: googleWho };
const OAUTH: Record<string, OAuthCfg> = {
  gmail: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/gmail.send' },
  gcal: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/calendar.events' },
  gdrive: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/drive.file' },
  sheets: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/spreadsheets' },
  // Read-only sign-ins that feed the company knowledge base (nothing is ever sent or changed through them).
  gdrive_read: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/drive.readonly' },
  gmail_read: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/gmail.readonly' },
  gcal_read: { ...GOOGLE, scopes: 'openid email https://www.googleapis.com/auth/calendar.readonly' },
  outlook: {
    group: 'MICROSOFT',
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'offline_access openid email User.Read Mail.Send',
    who: async (a) => {
      const r = await fetch('https://graph.microsoft.com/v1.0/me', { headers: bearer(a), signal: sig() });
      await ok(r);
      const j = await r.json();
      return { account: String(j.mail ?? j.userPrincipalName ?? '') };
    },
  },
  outlook_read: {
    group: 'MICROSOFT',
    auth: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    token: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    scopes: 'offline_access openid email User.Read Mail.Read Files.Read',
    who: async (a) => {
      const r = await fetch('https://graph.microsoft.com/v1.0/me', { headers: bearer(a), signal: sig() });
      await ok(r);
      const j = await r.json();
      return { account: String(j.mail ?? j.userPrincipalName ?? '') };
    },
  },
  linkedin: {
    group: 'LINKEDIN',
    auth: 'https://www.linkedin.com/oauth/v2/authorization',
    token: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: 'openid profile w_member_social',
    who: async (a) => {
      const r = await fetch('https://api.linkedin.com/v2/userinfo', { headers: bearer(a), signal: sig() });
      await ok(r);
      const j = await r.json();
      return { account: String(j.name ?? ''), extra: { sub: String(j.sub ?? '') } };
    },
  },
  dropbox: {
    group: 'DROPBOX',
    auth: 'https://www.dropbox.com/oauth2/authorize',
    token: 'https://api.dropboxapi.com/oauth2/token',
    scopes: 'files.content.write account_info.read',
    extraAuth: { token_access_type: 'offline' },
    who: async (a) => {
      const r = await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: bearer(a), signal: sig() });
      await ok(r);
      return { account: String((await r.json()).email ?? '') };
    },
  },
};
const clientOf = (g: OAuthCfg['group']) => ({ id: Deno.env.get(`${g}_CLIENT_ID`) ?? '', secret: Deno.env.get(`${g}_CLIENT_SECRET`) ?? '' });
const APP_URL = () => (Deno.env.get('APP_URL') ?? 'https://firboai.app').replace(/\/+$/, '');
const REDIRECT = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/integrations`;

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(Deno.env.get('OAUTH_STATE_SECRET') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function signState(payload: Record<string, unknown>): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), enc.encode(body)));
  return `${body}.${b64url(mac)}`;
}
async function readState(state: string): Promise<Record<string, any> | null> {
  const [body, mac] = state.split('.');
  if (!body || !mac) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(), fromB64url(mac), enc.encode(body)))) return null;
    const p = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    return typeof p?.exp === 'number' && p.exp > Date.now() ? p : null;
  } catch {
    return null;
  }
}

async function tokenRequest(cfg: OAuthCfg, params: Record<string, string>): Promise<Record<string, any>> {
  const c = clientOf(cfg.group);
  const r = await fetch(cfg.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams({ ...params, client_id: c.id, client_secret: c.secret }), signal: sig() });
  await ok(r);
  return await r.json();
}

/** Returns a secret whose access token is valid, refreshing (and saving) it when it is about to expire. */
async function freshSecret(admin: ReturnType<typeof createClient>, integrationId: string, kind: string, secret: Record<string, string>): Promise<Record<string, string>> {
  const cfg = OAUTH[kind];
  if (!cfg) return secret;
  const exp = Number(secret.expires_at ?? 0);
  if (secret.access_token && (!exp || exp - Date.now() > 60_000)) return secret;
  if (!secret.refresh_token) throw new Error('reauth');
  const j = await tokenRequest(cfg, { grant_type: 'refresh_token', refresh_token: secret.refresh_token });
  const next = { ...secret, access_token: String(j.access_token), expires_at: String(Date.now() + Number(j.expires_in ?? 3600) * 1000), ...(j.refresh_token ? { refresh_token: String(j.refresh_token) } : {}) };
  await admin.from('integration_secrets').update({ secret: JSON.stringify(next) }).eq('integration_id', integrationId);
  return next;
}

const oauthProvider = (verify: Provider['verify'], send: Provider['send']): Provider => ({
  messaging: false,
  parse: () => null, // connected by signing in, never by pasting fields
  verify,
  send,
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
      await ok(await fetch(`https://graph.facebook.com/v20.0/${c.phone_number_id}/messages`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}` }, body: JSON.stringify({ messaging_product: 'whatsapp', to: c.to, type: 'text', text: { body: t.slice(0, 3500) } }), signal: sig() })),
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
      await ok(await fetch(`https://api.twilio.com/2010-04-01/Accounts/${s.sid}/Messages.json`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${b64(`${s.sid}:${s.token}`)}` }, body: new URLSearchParams({ To: String(c.to), From: String(c.from), Body: t.slice(0, 1500) }), signal: sig() })),
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
      await ok(await fetch('https://api.resend.com/emails', { method: 'POST', headers: { ...J, authorization: `Bearer ${s.key}` }, body: JSON.stringify({ from: c.from, to: [c.to], subject: t.split('\n')[0].slice(0, 120) || 'Message from Firbo AI', text: t.slice(0, 10000) }), signal: sig() })),
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
      await ok(await fetch('https://api.sendgrid.com/v3/mail/send', { method: 'POST', headers: { ...J, authorization: `Bearer ${s.key}` }, body: JSON.stringify({ personalizations: [{ to: [{ email: c.to }] }], from: { email: c.from }, subject: t.split('\n')[0].slice(0, 120) || 'Message from Firbo AI', content: [{ type: 'text/plain', value: t.slice(0, 10000) }] }), signal: sig() })),
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
      await ok(await fetch('https://api.notion.com/v1/pages', { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}`, 'Notion-Version': '2022-06-28' }, body: JSON.stringify({ parent: { page_id: c.parent_id }, properties: { title: { title: [{ text: { content: t.split('\n')[0].slice(0, 200) || 'Firbo AI' } }] } }, children: [{ object: 'block', type: 'paragraph', paragraph: { rich_text: [{ type: 'text', text: { content: t.slice(0, 1900) } }] } }] }), signal: sig() })),
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
      await ok(await fetch(`https://api.airtable.com/v0/${c.base_id}/${encodeURIComponent(String(c.table))}`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}` }, body: JSON.stringify({ fields: { Name: t.slice(0, 1000) } }), signal: sig() })),
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
      await ok(await fetch(`https://api.github.com/repos/${c.repo}/issues`, { method: 'POST', headers: { ...J, authorization: `Bearer ${s.token}`, 'user-agent': 'firbo-ai', accept: 'application/vnd.github+json' }, body: JSON.stringify({ title: t.split('\n')[0].slice(0, 200) || 'Firbo AI', body: t.slice(0, 6000) }), signal: sig() })),
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
  // ---- automation hooks
  zapier: webhookProvider((u) => hostIs(u, 'hooks.zapier.com'), (t) => ({ source: 'firbo-ai', text: t.slice(0, 3500) })),
  make: webhookProvider((u) => hostIs(u, 'make.com', 'integromat.com'), (t) => ({ source: 'firbo-ai', text: t.slice(0, 3500) })),
  n8n: webhookProvider((u) => u.pathname.includes('/webhook'), (t) => ({ source: 'firbo-ai', text: t.slice(0, 3500) })),

  // ---- CRM and work tools: paste a token, Firbo creates the record when you approve an action
  // ---- new and trending apps
  threads: {
    messaging: false,
    parse: (f) => {
      const id = str(f.user_id, 30);
      const token = str(f.access_token, 400);
      return /^\d{5,25}$/.test(id) && token.length >= 20 ? { secret: { token }, config: { user_id: id } } : null;
    },
    verify: async (s) => ok(await fetch('https://graph.threads.net/v1.0/me?fields=id', { headers: bearer(s.token), signal: sig() })),
    send: async (s, c, t) => {
      const make = await fetch(`https://graph.threads.net/v1.0/${c.user_id}/threads`, { method: 'POST', headers: { ...bearer(s.token), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ media_type: 'TEXT', text: t.slice(0, 480) }), signal: sig() });
      await ok(make);
      const { id } = await make.json();
      await ok(await fetch(`https://graph.threads.net/v1.0/${c.user_id}/threads_publish`, { method: 'POST', headers: { ...bearer(s.token), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: String(id) }), signal: sig() }));
    },
  },
  instagram: {
    messaging: false,
    parse: (f) => {
      const id = str(f.ig_user_id, 30);
      const token = str(f.access_token, 500);
      return /^\d{5,25}$/.test(id) && token.length >= 20 ? { secret: { token }, config: { ig_user_id: id } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://graph.facebook.com/v21.0/${c.ig_user_id}?fields=username`, { headers: bearer(s.token), signal: sig() })),
    send: async (s, c, t) => {
      const img = t.match(/https:\/\/[^\s]+\.(?:jpe?g|png)(?:\?[^\s]*)?/i)?.[0];
      if (!img) throw new Error('image_required');
      const caption = t.replace(img, '').trim().slice(0, 2000);
      const make = await fetch(`https://graph.facebook.com/v21.0/${c.ig_user_id}/media`, { method: 'POST', headers: { ...bearer(s.token), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ image_url: img, caption }), signal: sig() });
      await ok(make);
      const { id } = await make.json();
      await ok(await fetch(`https://graph.facebook.com/v21.0/${c.ig_user_id}/media_publish`, { method: 'POST', headers: { ...bearer(s.token), 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ creation_id: String(id) }), signal: sig() }));
    },
  },
  devto: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 80);
      return /^[A-Za-z0-9]{20,60}$/.test(key) ? { secret: { key }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://dev.to/api/users/me', { headers: { 'api-key': s.key, accept: 'application/vnd.forem.api-v1+json' }, signal: sig() })),
    send: async (s, _c, t) =>
      await ok(await fetch('https://dev.to/api/articles', { method: 'POST', headers: { ...J, 'api-key': s.key, accept: 'application/vnd.forem.api-v1+json' }, body: JSON.stringify({ article: { title: firstLine(t, 120) || 'Firbo AI', body_markdown: t.slice(0, 50000), published: false } }), signal: sig() })),
  },
  matrix: {
    messaging: true,
    parse: (f) => {
      const u = publicHttps(f.homeserver);
      const token = str(f.access_token, 300);
      const room = str(f.room_id, 120);
      if (!u || token.length < 10 || !/^![^\s:]+:[A-Za-z0-9.-]+$/.test(room)) return null;
      return { secret: { token }, config: { host: u.origin, room_id: room } };
    },
    send: async (s, c, t) =>
      await ok(await fetch(`${c.host}/_matrix/client/v3/rooms/${encodeURIComponent(String(c.room_id))}/send/m.room.message/${crypto.randomUUID()}`, { method: 'PUT', headers: { ...J, ...bearer(s.token) }, body: JSON.stringify({ msgtype: 'm.text', body: t.slice(0, 3500) }), signal: sig(), redirect: 'error' })),
  },
  zulip: {
    messaging: true,
    parse: (f) => {
      const u = publicHttps(f.site);
      const email = str(f.email, 120);
      const key = str(f.api_key, 80);
      const stream = str(f.stream, 60);
      const topic = str(f.topic, 60) || 'Firbo AI';
      if (!u || !/^[^\s@]+@[^\s@]+$/.test(email) || key.length < 20 || !stream) return null;
      return { secret: { key }, config: { host: u.origin, email, stream, topic } };
    },
    send: async (s, c, t) =>
      await ok(await fetch(`${c.host}/api/v1/messages`, { method: 'POST', headers: { authorization: `Basic ${b64(`${c.email}:${s.key}`)}`, 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ type: 'stream', to: String(c.stream), topic: String(c.topic), content: t.slice(0, 9000) }), signal: sig(), redirect: 'error' })),
  },
  rocketchat: webhookProvider((u) => u.pathname.includes('/hooks/'), (t) => ({ text: t.slice(0, 3500) })),
  todoist: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 80);
      return /^[a-f0-9]{40}$/i.test(token) ? { secret: { token }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://api.todoist.com/rest/v2/projects', { headers: bearer(s.token), signal: sig() })),
    send: async (s, _c, t) =>
      await ok(await fetch('https://api.todoist.com/rest/v2/tasks', { method: 'POST', headers: { ...J, ...bearer(s.token) }, body: JSON.stringify({ content: firstLine(t, 200) || 'Firbo AI', description: t.slice(0, 16000) }), signal: sig() })),
  },
  monday: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 600);
      const board = str(f.board_id, 20);
      return token.length >= 30 && /^\d{5,18}$/.test(board) ? { secret: { token }, config: { board_id: board } } : null;
    },
    verify: async (s) => {
      const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { ...J, authorization: s.token }, body: JSON.stringify({ query: '{ me { id } }' }), signal: sig() });
      await ok(r);
      if ((await r.json()).errors) throw new Error('auth');
    },
    send: async (s, c, t) => {
      const r = await fetch('https://api.monday.com/v2', { method: 'POST', headers: { ...J, authorization: s.token }, body: JSON.stringify({ query: 'mutation($b: ID!, $n: String!) { create_item(board_id: $b, item_name: $n) { id } }', variables: { b: c.board_id, n: firstLine(t, 200) || 'Firbo AI' } }), signal: sig() });
      await ok(r);
      if ((await r.json()).errors) throw new Error('monday');
    },
  },
  homeassistant: {
    messaging: true,
    parse: (f) => {
      const u = publicHttps(f.base_url);
      const token = str(f.token, 400);
      const svc = str(f.notify_service, 80).replace(/^notify\./, '');
      if (!u || token.length < 30 || !/^[a-z0-9_]{2,80}$/.test(svc)) return null;
      return { secret: { token }, config: { host: u.origin, service: svc } };
    },
    send: async (s, c, t) =>
      await ok(await fetch(`${c.host}/api/services/notify/${c.service}`, { method: 'POST', headers: { ...J, ...bearer(s.token) }, body: JSON.stringify({ title: 'Firbo AI', message: t.slice(0, 1000) }), signal: sig(), redirect: 'error' })),
  },
  ifttt: {
    messaging: true,
    parse: (f) => {
      const key = str(f.key, 60);
      const event = str(f.event, 60);
      return /^[A-Za-z0-9_-]{15,60}$/.test(key) && /^[A-Za-z0-9_-]{1,60}$/.test(event) ? { secret: { key }, config: { event } } : null;
    },
    send: async (s, c, t) => ok(await fetch(`https://maker.ifttt.com/trigger/${c.event}/with/key/${s.key}`, { method: 'POST', headers: J, body: JSON.stringify({ value1: t.slice(0, 1500) }), signal: sig() })),
  },
  brevo: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 120);
      const from = str(f.from, 120);
      const to = str(f.to, 120);
      return key.length >= 30 && /^[^\s@]+@[^\s@]+$/.test(from) && /^[^\s@]+@[^\s@]+$/.test(to) ? { secret: { key }, config: { from, to } } : null;
    },
    verify: async (s) => ok(await fetch('https://api.brevo.com/v3/account', { headers: { 'api-key': s.key }, signal: sig() })),
    send: async (s, c, t) =>
      await ok(await fetch('https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { ...J, 'api-key': s.key }, body: JSON.stringify({ sender: { email: c.from }, to: [{ email: c.to }], subject: firstLine(t, 150) || 'Firbo AI', textContent: t.slice(0, 20000) }), signal: sig() })),
  },
  mailchimp: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 80);
      const list = str(f.list_id, 20);
      const dc = key.split('-')[1] ?? '';
      return /^[a-f0-9]{32}-[a-z]{2}\d{1,2}$/.test(key) && /^[a-f0-9]{8,12}$/i.test(list) ? { secret: { key }, config: { dc, list_id: list } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://${c.dc}.api.mailchimp.com/3.0/lists/${c.list_id}`, { headers: { authorization: `Basic ${b64(`firbo:${s.key}`)}` }, signal: sig() })),
    // Adds the first email address found in the text as a pending contact: the person confirms by email (double opt-in).
    send: async (s, c, t) => {
      const email = t.match(/[^\s@<>(),;]+@[^\s@<>(),;]+\.[^\s@<>(),;]+/)?.[0];
      if (!email) throw new Error('email_required');
      const r = await fetch(`https://${c.dc}.api.mailchimp.com/3.0/lists/${c.list_id}/members`, { method: 'POST', headers: { ...J, authorization: `Basic ${b64(`firbo:${s.key}`)}` }, body: JSON.stringify({ email_address: email, status: 'pending' }), signal: sig() });
      if (r.status === 400 && (await r.text()).includes('Member Exists')) return;
      await ok(r);
    },
  },
  stripe: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const key = str(f.key, 200);
      return /^(rk|sk)_(live|test)_[A-Za-z0-9]{20,}$/.test(key) ? { secret: { key }, config: { mode: key.includes('_test_') ? 'test' : 'live' } } : null;
    },
    verify: async (s) => ok(await fetch('https://api.stripe.com/v1/balance', { headers: bearer(s.key), signal: sig() })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s) => {
      const bal = await (await fetch('https://api.stripe.com/v1/balance', { headers: bearer(s.key), signal: sig() })).json();
      const since = Math.floor(Date.now() / 1000) - 7 * 86400;
      const ch = await (await fetch(`https://api.stripe.com/v1/charges?limit=100&created[gte]=${since}`, { headers: bearer(s.key), signal: sig() })).json();
      const paid = (ch.data ?? []).filter((x: { paid: boolean; refunded: boolean }) => x.paid && !x.refunded);
      const cur = String(paid[0]?.currency ?? bal.available?.[0]?.currency ?? 'usd').toUpperCase();
      const sum = paid.reduce((a: number, x: { amount: number }) => a + x.amount, 0) / 100;
      const avail = (bal.available ?? []).reduce((a: number, x: { amount: number }) => a + x.amount, 0) / 100;
      return `Stripe, last 7 days: ${paid.length} paid charges, ${sum.toFixed(2)} ${cur}. Available balance: ${avail.toFixed(2)} ${cur}.`;
    },
  },
  shopify: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const shop = str(f.shop, 80).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const token = str(f.token, 120);
      return /^[a-z0-9][a-z0-9-]{1,60}\.myshopify\.com$/.test(shop) && /^shp[a-z]{2}_[A-Za-z0-9]{20,}$/.test(token) ? { secret: { token }, config: { shop } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://${c.shop}/admin/api/2024-10/shop.json`, { headers: { 'x-shopify-access-token': s.token }, signal: sig(), redirect: 'error' })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s, c) => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const r = await (await fetch(`https://${c.shop}/admin/api/2024-10/orders.json?status=any&limit=250&created_at_min=${since}&fields=total_price,currency`, { headers: { 'x-shopify-access-token': s.token }, signal: sig(), redirect: 'error' })).json();
      const orders = r.orders ?? [];
      const sum = orders.reduce((a: number, o: { total_price: string }) => a + Number(o.total_price), 0);
      return `Shopify ${c.shop}, last 7 days: ${orders.length} orders, ${sum.toFixed(2)} ${orders[0]?.currency ?? ''}.`;
    },
  },
  woocommerce: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const u = publicHttps(f.site_url);
      const ck = str(f.consumer_key, 80);
      const cs = str(f.consumer_secret, 80);
      return u && /^ck_[a-f0-9]{20,}$/i.test(ck) && /^cs_[a-f0-9]{20,}$/i.test(cs) ? { secret: { ck, cs }, config: { host: u.origin } } : null;
    },
    verify: async (s, c) => ok(await fetch(`${c.host}/wp-json/wc/v3/orders?per_page=1`, { headers: { authorization: `Basic ${b64(`${s.ck}:${s.cs}`)}` }, signal: sig(), redirect: 'error' })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s, c) => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString();
      const r = await (await fetch(`${c.host}/wp-json/wc/v3/orders?per_page=100&after=${since}`, { headers: { authorization: `Basic ${b64(`${s.ck}:${s.cs}`)}` }, signal: sig(), redirect: 'error' })).json();
      const list = Array.isArray(r) ? r : [];
      const sum = list.reduce((a: number, o: { total: string }) => a + Number(o.total), 0);
      return `WooCommerce, last 7 days: ${list.length} orders, ${sum.toFixed(2)} ${list[0]?.currency ?? ''}.`;
    },
  },
  lemonsqueezy: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const key = str(f.api_key, 2000);
      return key.length >= 40 && /^[A-Za-z0-9._-]+$/.test(key) ? { secret: { key }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://api.lemonsqueezy.com/v1/users/me', { headers: { ...bearer(s.key), accept: 'application/vnd.api+json' }, signal: sig() })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s) => {
      const r = await (await fetch('https://api.lemonsqueezy.com/v1/orders?page[size]=50', { headers: { ...bearer(s.key), accept: 'application/vnd.api+json' }, signal: sig() })).json();
      const list = r.data ?? [];
      const sum = list.reduce((a: number, o: { attributes: { total: number } }) => a + o.attributes.total, 0) / 100;
      return `Lemon Squeezy, latest ${list.length} orders: ${sum.toFixed(2)} ${list[0]?.attributes?.currency ?? ''}.`;
    },
  },
  gumroad: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const token = str(f.access_token, 200);
      return token.length >= 20 && /^[A-Za-z0-9_-]+$/.test(token) ? { secret: { token }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch(`https://api.gumroad.com/v2/user?access_token=${encodeURIComponent(s.token)}`, { signal: sig() })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s) => {
      const r = await (await fetch(`https://api.gumroad.com/v2/sales?access_token=${encodeURIComponent(s.token)}`, { signal: sig() })).json();
      const list = r.sales ?? [];
      return `Gumroad, latest ${list.length} sales (page 1).`;
    },
  },
  calendly: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const token = str(f.token, 1500);
      return token.length >= 30 && /^[A-Za-z0-9._-]+$/.test(token) ? { secret: { token }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://api.calendly.com/users/me', { headers: bearer(s.token), signal: sig() })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s) => {
      const me = await (await fetch('https://api.calendly.com/users/me', { headers: bearer(s.token), signal: sig() })).json();
      const uri = me.resource?.uri;
      const r = await (await fetch(`https://api.calendly.com/scheduled_events?user=${encodeURIComponent(uri)}&status=active&count=10&sort=start_time:asc&min_start_time=${new Date().toISOString()}`, { headers: bearer(s.token), signal: sig() })).json();
      const list = r.collection ?? [];
      return `Calendly, next ${list.length} meetings: ` + (list.map((e: { name: string; start_time: string }) => `${e.name} (${e.start_time.slice(0, 16).replace('T', ' ')})`).join('; ') || 'none');
    },
  },
  calcom: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const key = str(f.api_key, 100);
      return /^cal_(live_)?[A-Za-z0-9]{16,}$/.test(key) ? { secret: { key }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch(`https://api.cal.com/v1/me?apiKey=${encodeURIComponent(s.key)}`, { signal: sig() })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s) => {
      const r = await (await fetch(`https://api.cal.com/v1/bookings?apiKey=${encodeURIComponent(s.key)}`, { signal: sig() })).json();
      const list = r.bookings ?? [];
      return `Cal.com: ${list.length} bookings found.`;
    },
  },
  intercom: {
    messaging: false,
    readOnly: true,
    parse: (f) => {
      const token = str(f.token, 300);
      return token.length >= 20 && /^[A-Za-z0-9=_-]+$/.test(token) ? { secret: { token }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://api.intercom.io/me', { headers: { ...bearer(s.token), accept: 'application/json' }, signal: sig() })),
    send: async () => {
      throw new Error('read_only');
    },
    read: async (s) => {
      const r = await (await fetch('https://api.intercom.io/conversations?per_page=20', { headers: { ...bearer(s.token), accept: 'application/json' }, signal: sig() })).json();
      const list = r.conversations ?? [];
      const open = list.filter((c: { state: string }) => c.state === 'open').length;
      return `Intercom: ${list.length} recent conversations, ${open} open.`;
    },
  },
  hubspot: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 200);
      return /^pat-[a-z0-9]+-[A-Za-z0-9-]{20,}$/.test(token) ? { secret: { token }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://api.hubapi.com/crm/v3/objects/contacts?limit=1', { headers: bearer(s.token), signal: sig() })),
    send: async (s, _c, t) =>
      await ok(await fetch('https://api.hubapi.com/crm/v3/objects/notes', { method: 'POST', headers: { ...J, ...bearer(s.token) }, body: JSON.stringify({ properties: { hs_timestamp: new Date().toISOString(), hs_note_body: t.slice(0, 60000) } }), signal: sig() })),
  },
  pipedrive: {
    messaging: false,
    parse: (f) => {
      const domain = str(f.domain, 60).toLowerCase().replace(/\.pipedrive\.com.*$/, '');
      const token = str(f.api_token, 80);
      return /^[a-z0-9-]{2,60}$/.test(domain) && /^[A-Za-z0-9]{30,64}$/.test(token) ? { secret: { token }, config: { domain } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://${c.domain}.pipedrive.com/api/v1/users/me`, { headers: { 'x-api-token': s.token }, signal: sig(), redirect: 'error' })),
    send: async (s, c, t) =>
      await ok(await fetch(`https://${c.domain}.pipedrive.com/api/v1/activities`, { method: 'POST', headers: { ...J, 'x-api-token': s.token }, body: JSON.stringify({ subject: firstLine(t, 200) || 'Firbo AI', note: t.slice(0, 20000) }), signal: sig(), redirect: 'error' })),
  },
  asana: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 200);
      const project = str(f.project_gid, 30);
      return token.length >= 20 && /^\d{6,25}$/.test(project) ? { secret: { token }, config: { project_gid: project } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://app.asana.com/api/1.0/projects/${c.project_gid}`, { headers: bearer(s.token), signal: sig() })),
    send: async (s, c, t) =>
      await ok(await fetch('https://app.asana.com/api/1.0/tasks', { method: 'POST', headers: { ...J, ...bearer(s.token) }, body: JSON.stringify({ data: { name: firstLine(t, 200) || 'Firbo AI', notes: t.slice(0, 20000), projects: [c.project_gid] } }), signal: sig() })),
  },
  trello: {
    messaging: false,
    parse: (f) => {
      const key = str(f.api_key, 40);
      const token = str(f.token, 120);
      const list = str(f.list_id, 30);
      return /^[a-f0-9]{32}$/i.test(key) && token.length >= 32 && /^[a-f0-9]{24}$/i.test(list) ? { secret: { key, token }, config: { list_id: list } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://api.trello.com/1/lists/${c.list_id}`, { headers: { authorization: `OAuth oauth_consumer_key="${s.key}", oauth_token="${s.token}"` }, signal: sig() })),
    send: async (s, c, t) =>
      await ok(await fetch('https://api.trello.com/1/cards', { method: 'POST', headers: { ...J, authorization: `OAuth oauth_consumer_key="${s.key}", oauth_token="${s.token}"` }, body: JSON.stringify({ idList: c.list_id, name: firstLine(t, 200) || 'Firbo AI', desc: t.slice(0, 16000) }), signal: sig() })),
  },
  clickup: {
    messaging: false,
    parse: (f) => {
      const token = str(f.token, 120);
      const list = str(f.list_id, 30);
      return /^pk_[A-Za-z0-9_]{20,}$/.test(token) && /^\d{5,20}$/.test(list) ? { secret: { token }, config: { list_id: list } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://api.clickup.com/api/v2/list/${c.list_id}`, { headers: { authorization: s.token }, signal: sig() })),
    send: async (s, c, t) =>
      await ok(await fetch(`https://api.clickup.com/api/v2/list/${c.list_id}/task`, { method: 'POST', headers: { ...J, authorization: s.token }, body: JSON.stringify({ name: firstLine(t, 200) || 'Firbo AI', description: t.slice(0, 20000) }), signal: sig() })),
  },
  jira: {
    messaging: false,
    parse: (f) => {
      const domain = str(f.domain, 80).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const email = str(f.email, 200);
      const token = str(f.api_token, 300);
      const project = str(f.project_key, 12).toUpperCase();
      return /^[a-z0-9-]{2,60}\.atlassian\.net$/.test(domain) && EMAIL.test(email) && token.length >= 20 && /^[A-Z][A-Z0-9]{1,9}$/.test(project) ? { secret: { email, token }, config: { domain, project_key: project } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://${c.domain}/rest/api/3/project/${c.project_key}`, { headers: { authorization: `Basic ${b64(`${s.email}:${s.token}`)}` }, signal: sig(), redirect: 'error' })),
    send: async (s, c, t) =>
      await ok(await fetch(`https://${c.domain}/rest/api/3/issue`, { method: 'POST', headers: { ...J, authorization: `Basic ${b64(`${s.email}:${s.token}`)}` }, body: JSON.stringify({ fields: { project: { key: c.project_key }, summary: firstLine(t, 200) || 'Firbo AI', issuetype: { name: 'Task' }, description: adf(t) } }), signal: sig(), redirect: 'error' })),
  },
  zendesk: {
    messaging: false,
    parse: (f) => {
      const sub = str(f.subdomain, 60).toLowerCase().replace(/\.zendesk\.com.*$/, '');
      const email = str(f.email, 200);
      const token = str(f.api_token, 200);
      return /^[a-z0-9-]{2,60}$/.test(sub) && EMAIL.test(email) && token.length >= 20 ? { secret: { email, token }, config: { subdomain: sub } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://${c.subdomain}.zendesk.com/api/v2/users/me.json`, { headers: { authorization: `Basic ${b64(`${s.email}/token:${s.token}`)}` }, signal: sig(), redirect: 'error' })),
    send: async (s, c, t) =>
      await ok(await fetch(`https://${c.subdomain}.zendesk.com/api/v2/tickets.json`, { method: 'POST', headers: { ...J, authorization: `Basic ${b64(`${s.email}/token:${s.token}`)}` }, body: JSON.stringify({ ticket: { subject: firstLine(t, 200) || 'Firbo AI', comment: { body: t.slice(0, 20000) } } }), signal: sig(), redirect: 'error' })),
  },
  zoom: {
    messaging: false,
    parse: (f) => {
      const account = str(f.account_id, 60);
      const id = str(f.client_id, 80);
      const secret = str(f.client_secret, 120);
      const user = str(f.user_email, 200);
      return account.length >= 10 && id.length >= 10 && secret.length >= 10 && EMAIL.test(user) ? { secret: { account_id: account, client_id: id, client_secret: secret }, config: { user } } : null;
    },
    verify: async (s) => void (await zoomToken(s)),
    send: async (s, c, t) => {
      const token = await zoomToken(s);
      await ok(await fetch(`https://api.zoom.us/v2/users/${encodeURIComponent(String(c.user))}/meetings`, { method: 'POST', headers: { ...J, ...bearer(token) }, body: JSON.stringify({ topic: firstLine(t, 200) || 'Firbo AI meeting', agenda: t.slice(0, 1900), type: 2, start_time: new Date(Date.now() + 3_600_000).toISOString(), duration: 30 }), signal: sig() }));
    },
  },
  wordpress: {
    messaging: false,
    parse: (f) => {
      const u = publicHttps(f.site_url);
      const user = str(f.username, 100);
      const pass = str(f.app_password, 100);
      return u && user && pass.replace(/\s/g, '').length >= 16 ? { secret: { user, pass }, config: { site: u.origin } } : null;
    },
    verify: async (s, c) => ok(await fetch(`${c.site}/wp-json/wp/v2/users/me`, { headers: { authorization: `Basic ${b64(`${s.user}:${s.pass}`)}` }, signal: sig(), redirect: 'error' })),
    // always a DRAFT: a person publishes it
    send: async (s, c, t) =>
      await ok(await fetch(`${c.site}/wp-json/wp/v2/posts`, { method: 'POST', headers: { ...J, authorization: `Basic ${b64(`${s.user}:${s.pass}`)}` }, body: JSON.stringify({ title: firstLine(t, 200) || 'Firbo AI', content: t.slice(0, 60000).replace(/\n/g, '<br>'), status: 'draft' }), signal: sig(), redirect: 'error' })),
  },

  // ---- social networks
  bluesky: {
    messaging: false,
    parse: (f) => {
      const handle = str(f.handle, 100).replace(/^@/, '');
      const pass = str(f.app_password, 40);
      return /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(handle) && /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/.test(pass) ? { secret: { handle, pass }, config: { handle } } : null;
    },
    verify: async (s) => void (await blueskySession(s.handle, s.pass)),
    send: async (s, _c, t) => {
      const sess = await blueskySession(s.handle, s.pass);
      await ok(await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', { method: 'POST', headers: { ...J, ...bearer(sess.jwt) }, body: JSON.stringify({ repo: sess.did, collection: 'app.bsky.feed.post', record: { $type: 'app.bsky.feed.post', text: t.slice(0, 300), createdAt: new Date().toISOString() } }), signal: sig(), redirect: 'error' }));
    },
  },
  facebook: {
    messaging: false,
    parse: (f) => {
      const page = str(f.page_id, 30);
      const token = str(f.page_token, 600);
      return /^\d{5,25}$/.test(page) && token.length >= 30 ? { secret: { token }, config: { page_id: page } } : null;
    },
    verify: async (s, c) => ok(await fetch(`https://graph.facebook.com/v20.0/${c.page_id}?fields=name`, { headers: bearer(s.token), signal: sig() })),
    send: async (s, c, t) =>
      await ok(await fetch(`https://graph.facebook.com/v20.0/${c.page_id}/feed`, { method: 'POST', headers: { ...J, ...bearer(s.token) }, body: JSON.stringify({ message: t.slice(0, 60000) }), signal: sig() })),
  },
  x: {
    messaging: false,
    parse: (f) => {
      const consumer_key = str(f.api_key, 100);
      const consumer_secret = str(f.api_secret, 150);
      const access_token = str(f.access_token, 150);
      const access_token_secret = str(f.access_token_secret, 150);
      return consumer_key.length >= 10 && consumer_secret.length >= 20 && /^\d+-/.test(access_token) && access_token_secret.length >= 20 ? { secret: { consumer_key, consumer_secret, access_token, access_token_secret }, config: {} } : null;
    },
    verify: async (s) => ok(await fetch('https://api.twitter.com/2/users/me', { headers: { authorization: await oauth1Header('GET', 'https://api.twitter.com/2/users/me', s) }, signal: sig(), redirect: 'error' })),
    send: async (s, _c, t) =>
      await ok(await fetch('https://api.twitter.com/2/tweets', { method: 'POST', headers: { ...J, authorization: await oauth1Header('POST', 'https://api.twitter.com/2/tweets', s) }, body: JSON.stringify({ text: t.slice(0, 280) }), signal: sig(), redirect: 'error' })),
  },

  // ---- one-click sign-in apps (connected through the OAuth flow, see oauth_start)
  gmail: oauthProvider(
    async (s) => void (await googleWho(s.access_token)),
    async (s, c, t) => {
      const mime = `To: ${c.to}\r\nSubject: =?UTF-8?B?${utf8b64(firstLine(t, 150) || 'Message from Firbo AI')}?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${utf8b64(t.slice(0, 20000))}`;
      await ok(await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { ...J, ...bearer(s.access_token) }, body: JSON.stringify({ raw: b64url(enc.encode(mime)) }), signal: sig() }));
    },
  ),
  gcal: oauthProvider(
    async (s) => void (await googleWho(s.access_token)),
    async (s, _c, t) => {
      const start = new Date(Date.now() + 3_600_000);
      await ok(await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { ...J, ...bearer(s.access_token) }, body: JSON.stringify({ summary: firstLine(t, 200) || 'Firbo AI', description: t.slice(0, 8000), start: { dateTime: start.toISOString() }, end: { dateTime: new Date(start.getTime() + 1_800_000).toISOString() } }), signal: sig() }));
    },
  ),
  gdrive: oauthProvider(
    async (s) => void (await googleWho(s.access_token)),
    async (s, _c, t) => {
      const boundary = `firbo${crypto.randomUUID().replace(/-/g, '')}`;
      const meta = JSON.stringify({ name: `Firbo ${new Date().toISOString().slice(0, 16).replace('T', ' ')}.txt`, mimeType: 'text/plain' });
      const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${t.slice(0, 200000)}\r\n--${boundary}--`;
      await ok(await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', { method: 'POST', headers: { ...bearer(s.access_token), 'content-type': `multipart/related; boundary=${boundary}` }, body, signal: sig() }));
    },
  ),
  sheets: oauthProvider(
    async (s) => void (await googleWho(s.access_token)),
    async (s, c, t) =>
      await ok(await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(String(c.spreadsheet_id))}/values/${encodeURIComponent(String(c.range || 'Sheet1!A:B'))}:append?valueInputOption=USER_ENTERED`, { method: 'POST', headers: { ...J, ...bearer(s.access_token) }, body: JSON.stringify({ values: [[new Date().toISOString(), t.slice(0, 40000)]] }), signal: sig() })),
  ),
  outlook: oauthProvider(
    async (s) => ok(await fetch('https://graph.microsoft.com/v1.0/me', { headers: bearer(s.access_token), signal: sig() })),
    async (s, c, t) =>
      await ok(await fetch('https://graph.microsoft.com/v1.0/me/sendMail', { method: 'POST', headers: { ...J, ...bearer(s.access_token) }, body: JSON.stringify({ message: { subject: firstLine(t, 150) || 'Message from Firbo AI', body: { contentType: 'Text', content: t.slice(0, 30000) }, toRecipients: [{ emailAddress: { address: c.to } }] }, saveToSentItems: true }), signal: sig() })),
  ),
  gdrive_read: { ...oauthProvider(async (s) => void (await googleWho(s.access_token)), async () => { throw new Error('read_only'); }), readOnly: true },
  gmail_read: { ...oauthProvider(async (s) => void (await googleWho(s.access_token)), async () => { throw new Error('read_only'); }), readOnly: true },
  gcal_read: { ...oauthProvider(async (s) => void (await googleWho(s.access_token)), async () => { throw new Error('read_only'); }), readOnly: true },
  outlook_read: { ...oauthProvider(async (s) => ok(await fetch('https://graph.microsoft.com/v1.0/me', { headers: bearer(s.access_token), signal: sig() })), async () => { throw new Error('read_only'); }), readOnly: true },
  linkedin: oauthProvider(
    async (s) => ok(await fetch('https://api.linkedin.com/v2/userinfo', { headers: bearer(s.access_token), signal: sig() })),
    async (s, c, t) =>
      await ok(await fetch('https://api.linkedin.com/v2/ugcPosts', { method: 'POST', headers: { ...J, ...bearer(s.access_token), 'X-Restli-Protocol-Version': '2.0.0' }, body: JSON.stringify({ author: `urn:li:person:${c.sub}`, lifecycleState: 'PUBLISHED', specificContent: { 'com.linkedin.ugc.ShareContent': { shareCommentary: { text: t.slice(0, 3000) }, shareMediaCategory: 'NONE' } }, visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' } }), signal: sig() })),
  ),
  dropbox: oauthProvider(
    async (s) => ok(await fetch('https://api.dropboxapi.com/2/users/get_current_account', { method: 'POST', headers: bearer(s.access_token), signal: sig() })),
    async (s, _c, t) =>
      await ok(await fetch('https://content.dropboxapi.com/2/files/upload', { method: 'POST', headers: { ...bearer(s.access_token), 'content-type': 'application/octet-stream', 'Dropbox-API-Arg': JSON.stringify({ path: `/Firbo/${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.txt`, mode: 'add', autorename: true }) }, body: enc.encode(t.slice(0, 200000)), signal: sig() })),
  ),

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

/** Browser comes back here from the provider with ?code&state. Only a state we signed (company, person, app, 10 minutes) is accepted. */
async function oauthCallback(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams;
  const back = (p: string) => new Response(null, { status: 302, headers: { location: `${APP_URL()}/integrations?${p}` } });
  if (q.get('error')) return back(`oauth_error=${encodeURIComponent((q.get('error') ?? '').slice(0, 40))}`);
  const st = await readState(q.get('state') ?? '');
  const code = q.get('code');
  if (!st || !code || typeof st.k !== 'string') return back('oauth_error=bad_state');
  const cfg = OAUTH[st.k];
  if (!cfg) return back('oauth_error=bad_state');
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: m } = await admin.from('organization_members').select('role').eq('organization_id', st.o).eq('user_id', st.u).maybeSingle();
  if (!m || !MANAGERS.includes(m.role)) return back('oauth_error=forbidden');
  const { count } = await admin.from('integrations').select('id', { count: 'exact', head: true }).eq('organization_id', st.o);
  const { data: cap } = await admin.rpc('plan_limit', { p_org: st.o, p_key: 'integrations' });
  if ((count ?? 0) >= Number(cap ?? 2)) return back('oauth_error=plan_limit');
  try {
    const tok = await tokenRequest(cfg, { grant_type: 'authorization_code', code, redirect_uri: REDIRECT() });
    const access = String(tok.access_token ?? '');
    if (!access) throw new Error('no_token');
    const who = await cfg.who(access);
    const config: Record<string, unknown> = { account: who.account, ...(st.c ?? {}), ...(who.extra ?? {}) };
    if ((st.k === 'gmail' || st.k === 'outlook') && !config.to) config.to = who.account;
    const { data: row, error } = await admin.from('integrations').insert({ organization_id: st.o, kind: st.k, name: String(st.n ?? st.k).slice(0, 80), config, created_by: st.u, last_used_at: new Date().toISOString() }).select('id').single();
    if (error || !row) return back(error?.message?.includes('plan_limit') ? 'oauth_error=plan_limit' : 'oauth_error=save_failed');
    const secret = { access_token: access, ...(tok.refresh_token ? { refresh_token: String(tok.refresh_token) } : {}), expires_at: String(Date.now() + Number(tok.expires_in ?? 3600) * 1000) };
    await admin.from('integration_secrets').insert({ integration_id: row.id, secret: JSON.stringify(secret) });
    return back(`connected=${encodeURIComponent(st.k)}`);
  } catch {
    return back('oauth_error=exchange_failed');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (isConnectionCallback(req)) {
    try {return await forwardConnectionCallback(req,createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),key=>Deno.env.get(key));}
    catch {return json(400,{error:'bad_state'});}
  }
  if (req.method === 'GET') return await oauthCallback(req);
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  // Server-to-server only (the company knowledge sync): a valid access token for one connected app, refreshed when needed.
  // Never reachable from a browser: it needs the scheduler secret, which no client can read.
  const cronHeader = req.headers.get('x-cron-secret');
  if (cronHeader) {
    const sys = createClient(url, service);
    const { data: sec } = await sys.from('cron_secrets').select('value').eq('name', 'shifts').maybeSingle();
    if (!sec || sec.value !== cronHeader) return json(401, { error: 'unauthorized' });
    let b: Record<string, unknown> = {};
    try { b = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
    if (b.action !== 'access_token' || typeof b.id !== 'string') return json(400, { error: 'bad_request' });
    const { data: integ } = await sys.from('integrations').select('id, kind').eq('id', b.id).maybeSingle();
    const { data: row } = await sys.from('integration_secrets').select('secret').eq('integration_id', b.id).maybeSingle();
    if (!integ || !row) return json(404, { error: 'not_found' });
    try {
      const secret = await freshSecret(sys, integ.id, integ.kind, readSecret(integ.kind, row.secret));
      return json(200, { token: secret.access_token ?? secret.token ?? '' });
    } catch {
      await sys.from('integrations').update({ status: 'error', last_error: 'reauth' }).eq('id', integ.id);
      return json(409, { error: 'reauth' });
    }
  }
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

  if (isConnectionAction(body.action)) {
    try {return json(200,await connectionAction(body,req,user,admin,key=>Deno.env.get(key)));}
    catch(e){const code=e instanceof ConnectionFailure?e.code:'connection_failed';
      return json(code==='forbidden'?403:code==='not_found'?404:code==='state_conflict'||code==='refresh_busy'?409:code==='backend_setup_required'||code==='not_configured'?503:422,{error:code});}
  }
  // New adapters may never be invoked through the less restrictive legacy path.
  if (isConnectedKind(body.kind)||isBridgeKind(body.kind)) return json(400,{error:'bad_request'});

  if (body.action === 'oauth_start') {
    const orgId = String(body.organization_id ?? '');
    const kind = String(body.kind ?? '');
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : '';
    const cfg = OAUTH[kind];
    if (!orgId || !cfg || !name) return json(400, { error: 'bad_request' });
    if (!(await isManager(orgId))) return json(403, { error: 'forbidden' });
    const extra: Record<string, string> = {};
    const f = (body.fields ?? {}) as Record<string, unknown>;
    if (kind === 'gmail' || kind === 'outlook') {
      const to = str(f.to, 200);
      if (to) {
        if (!EMAIL.test(to)) return json(422, { error: 'invalid_fields' });
        extra.to = to;
      }
    }
    if (kind === 'sheets') {
      const sid = str(f.spreadsheet_id, 100);
      const range = str(f.range, 60) || 'Sheet1!A:B';
      if (!/^[A-Za-z0-9_-]{20,100}$/.test(sid) || !/^[A-Za-z0-9 _!:$'-]{1,60}$/.test(range)) return json(422, { error: 'invalid_fields' });
      extra.spreadsheet_id = sid;
      extra.range = range;
    }
    const client = clientOf(cfg.group);
    if (!client.id || !client.secret) return json(503, { error: 'not_configured', provider: cfg.group, redirect_uri: REDIRECT() });
    const { count } = await admin.from('integrations').select('id', { count: 'exact', head: true }).eq('organization_id', orgId);
    const { data: cap } = await admin.rpc('plan_limit', { p_org: orgId, p_key: 'integrations' });
    if ((count ?? 0) >= Number(cap ?? 2)) return json(429, { error: 'plan_limit' });
    const state = await signState({ o: orgId, u: user.id, k: kind, n: name, c: extra, exp: Date.now() + 10 * 60_000 });
    const params = new URLSearchParams({ client_id: client.id, redirect_uri: REDIRECT(), response_type: 'code', scope: cfg.scopes, state, ...(cfg.extraAuth ?? {}) });
    return json(200, { url: `${cfg.auth}?${params}` });
  }

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
  if(isConnectedKind(integ.kind)||isBridgeKind(integ.kind)) return json(400,{error:'bad_request'});
  if (!(await isManager(integ.organization_id))) return json(403, { error: 'forbidden' });

  if (body.action === 'disconnect') {
    await admin.from('integrations').delete().eq('id', id);
    return json(200, { ok: true });
  }

  if (body.action === 'snapshot') {
    const provider = PROVIDERS[integ.kind];
    if (!provider?.read) return json(400, { error: 'bad_request' });
    const { data: sec } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
    if (!sec) return json(404, { error: 'not_found' });
    try {
      const secret = await freshSecret(admin, id, integ.kind, readSecret(integ.kind, sec.secret));
      const text = await provider.read(secret, (integ.config ?? {}) as Record<string, unknown>);
      await admin.from('integrations').update({ status: 'active', last_error: null, last_used_at: new Date().toISOString() }).eq('id', id);
      return json(200, { text: text.slice(0, 1500) });
    } catch (err) {
      await admin.from('integrations').update({ status: 'error', last_error: (err instanceof Error ? err.message : 'error').slice(0, 120) }).eq('id', id);
      return json(502, { error: 'send_failed' });
    }
  }

  if (body.action === 'test' || body.action === 'send') {
    const provider = PROVIDERS[integ.kind];
    if (!provider) return json(400, { error: 'bad_request' });
    if (provider.readOnly && body.action === 'send') return json(422, { error: 'read_only' });
    const text = body.action === 'test' ? `✅ ${integ.name}: test message from Firbo AI.` : typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) return json(400, { error: 'bad_request' });
    const { data: sec } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
    if (!sec) return json(404, { error: 'not_found' });
    let secret = readSecret(integ.kind, sec.secret);
    const config = (integ.config ?? {}) as Record<string, unknown>;
    try {
      secret = await freshSecret(admin, id, integ.kind, secret);
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
