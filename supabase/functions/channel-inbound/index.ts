// Two-way messaging with the company (OpenJarvis's channels, Firbo style): the owner writes to the company's Telegram bot,
// WhatsApp number (Meta Cloud API) or SMS number (Twilio) and the AI CEO answers; pending approvals arrive with
// Approve / Reject buttons. Built on the apps the company already connected in Integrations.
//
// Safety:
//  - only the chat / phone number that was verified when the app was connected is listened to; everything else is ignored
//  - every request is authenticated: Telegram's secret header, Meta's X-Hub-Signature-256 (app secret), Twilio's signature
//  - messages act as the person who connected the app, with that person's role; nothing is sent or paid without approval
//
// Entry points:
//  POST {action:'enable'|'disable', integration_id, app_secret?} by a manager (browser)
//  POST {action:'notify_approval', approval_id} with x-cron-secret (database trigger on new approvals)
//  GET/POST ?i=<integration_id> from Telegram / Meta / Twilio
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const MANAGERS = ['owner', 'admin', 'manager'];
const WRITERS = ['owner', 'admin', 'manager', 'member'];
const CHANNELS = ['telegram', 'whatsapp', 'twilio'];
const LANGS = ['en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar'];
const sig = (ms = 15_000) => AbortSignal.timeout(ms);
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function hmac(alg: 'SHA-256' | 'SHA-1', key: string, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: alg }, false, ['sign']);
  return await crypto.subtle.sign('HMAC', k, enc.encode(data));
}
const same = (a: string, b: string) => a.length === b.length && a.split('').reduce((d, c, i) => d | (c.charCodeAt(0) ^ b.charCodeAt(i)), 0) === 0;
const digits = (v: unknown) => String(v ?? '').replace(/[^\d]/g, '');

const TEXT: Record<string, Record<string, string>> = {
  en: {
    hello: '👋 Your Firbo AI team is listening here. Write anything to your AI CEO.\n/approvals – actions waiting for you\n/tasks – latest work\n/help – this message',
    none: 'Nothing is waiting for your approval. ✅', approve: '✅ Approve', reject: '✖️ Reject', approved: '✅ Approved', rejected: '✖️ Rejected',
    gone: 'This was already decided.', error: 'Sorry, I could not answer right now. Please try again in a minute.', notasks: 'No tasks yet.',
    newApproval: '🔔 New action waiting for your approval', sendNote: 'Send it from the Inbox in Firbo when you are ready.',
  },
  el: {
    hello: '👋 Η ομάδα σου στο Firbo AI σε ακούει εδώ. Γράψε ό,τι θέλεις στον AI CEO σου.\n/approvals – ενέργειες που περιμένουν έγκριση\n/tasks – πρόσφατη δουλειά\n/help – αυτό το μήνυμα',
    none: 'Δεν περιμένει τίποτα την έγκρισή σου. ✅', approve: '✅ Έγκριση', reject: '✖️ Απόρριψη', approved: '✅ Εγκρίθηκε', rejected: '✖️ Απορρίφθηκε',
    gone: 'Αυτό έχει ήδη αποφασιστεί.', error: 'Συγγνώμη, δεν μπόρεσα να απαντήσω τώρα. Δοκίμασε ξανά σε λίγο.', notasks: 'Δεν υπάρχουν εργασίες ακόμα.',
    newApproval: '🔔 Νέα ενέργεια περιμένει την έγκρισή σου', sendNote: 'Στείλ’ την από το Inbox του Firbo όταν είσαι έτοιμος.',
  },
};
const t = (lang: string, key: string) => (TEXT[lang] ?? TEXT.en)[key] ?? TEXT.en[key];

type Button = { id: string; title: string };
interface Channel { send(text: string, buttons?: Button[]): Promise<void>; typing?(): Promise<void> }

function telegram(token: string, chatId: string): Channel {
  const call = (method: string, payload: unknown) => fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: sig() });
  return {
    send: async (text, buttons) => {
      for (let i = 0; i < text.length || i === 0; i += 3900) {
        const last = i + 3900 >= text.length;
        await call('sendMessage', { chat_id: chatId, text: text.slice(i, i + 3900) || '…', ...(last && buttons?.length ? { reply_markup: { inline_keyboard: [buttons.map(b => ({ text: b.title, callback_data: b.id }))] } } : {}) });
      }
    },
    typing: async () => { await call('sendChatAction', { chat_id: chatId, action: 'typing' }); },
  };
}
function whatsapp(token: string, phoneId: string, to: string): Channel {
  const post = (payload: unknown) => fetch(`https://graph.facebook.com/v20.0/${phoneId}/messages`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ messaging_product: 'whatsapp', to, ...payload as object }), signal: sig() });
  return {
    send: async (text, buttons) => {
      if (buttons?.length) {
        await post({ type: 'interactive', interactive: { type: 'button', body: { text: text.slice(0, 1000) }, action: { buttons: buttons.slice(0, 3).map(b => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })) } } });
        return;
      }
      for (let i = 0; i < text.length || i === 0; i += 3900) await post({ type: 'text', text: { body: text.slice(i, i + 3900) || '…' } });
    },
  };
}
function sms(sid: string, token: string, from: string, to: string): Channel {
  return {
    send: async (text) => {
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${sid}:${token}`)}` }, body: new URLSearchParams({ To: to, From: from, Body: text.slice(0, 1500) }), signal: sig() });
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);
  const { data: sec } = await admin.from('cron_secrets').select('value').eq('name', 'shifts').maybeSingle();
  const cronSecret = String(sec?.value ?? '');
  const params = new URL(req.url).searchParams;
  const hookUrl = (id: string) => `${url}/functions/v1/channel-inbound?i=${id}`;
  const telegramSecret = async (id: string) => (await sha256(`${cronSecret}:telegram:${id}`)).slice(0, 48);
  const verifyToken = async (id: string) => (await sha256(`${cronSecret}:verify:${id}`)).slice(0, 32);

  const loadSecret = async (id: string): Promise<Record<string, string>> => {
    const { data } = await admin.from('integration_secrets').select('secret').eq('integration_id', id).maybeSingle();
    try { const o = JSON.parse(String(data?.secret ?? '{}')); return o && typeof o === 'object' ? o : {}; } catch { return { token: String(data?.secret ?? '') }; }
  };
  const channelFor = (integ: any, secret: Record<string, string>): Channel | null => {
    const c = integ.config ?? {};
    if (integ.kind === 'telegram') return telegram(secret.token, String(c.chat_id));
    if (integ.kind === 'whatsapp') return whatsapp(secret.token, String(c.phone_number_id), String(c.to));
    if (integ.kind === 'twilio') return sms(secret.sid, secret.token, String(c.from), String(c.to));
    return null;
  };
  const langOf = async (userId: string) => {
    const { data } = await admin.from('profiles').select('locale').eq('id', userId).maybeSingle();
    return LANGS.includes(String(data?.locale)) ? String(data?.locale) : 'en';
  };
  const approvalText = (a: any, lang: string) => {
    const p = (a.payload ?? {}) as Record<string, unknown>;
    const main = ['text', 'message', 'body', 'content', 'post', 'subject'].map(k => p[k]).find(v => typeof v === 'string' && String(v).trim());
    return `${t(lang, 'newApproval')}: ${a.action}${a.risk ? ` (${a.risk})` : ''}\n\n${String(main ?? JSON.stringify(Object.fromEntries(Object.entries(p).filter(([k]) => !['ai_generated', 'disclosure'].includes(k))))).slice(0, 900)}`;
  };
  const approvalButtons = (a: any, lang: string): Button[] => [{ id: `ap:${a.id}:y`, title: t(lang, 'approve') }, { id: `ap:${a.id}:n`, title: t(lang, 'reject') }];

  // ------------------------------------------------------------ database trigger: a new approval reaches the owner's phone
  if (req.method === 'POST' && req.headers.get('x-cron-secret')) {
    if (!cronSecret || req.headers.get('x-cron-secret') !== cronSecret) return json(401, { error: 'unauthorized' });
    const b = await req.json().catch(() => ({}));
    if (b.action !== 'notify_approval') return json(400, { error: 'bad_request' });
    const { data: a } = await admin.from('approvals').select('id, organization_id, action, payload, risk, status').eq('id', String(b.approval_id ?? '')).maybeSingle();
    if (!a || a.status !== 'pending') return json(200, { sent: 0 });
    const { data: apps } = await admin.from('integrations').select('id, kind, config, created_by').eq('organization_id', a.organization_id).in('kind', CHANNELS).eq('status', 'active');
    let sent = 0;
    for (const integ of (apps ?? []).filter((x: any) => x.config?.inbound === true && x.created_by)) {
      const ch = channelFor(integ, await loadSecret(integ.id));
      if (!ch) continue;
      const lang = await langOf(integ.created_by);
      await ch.send(approvalText(a, lang), integ.kind === 'twilio' ? undefined : approvalButtons(a, lang)).then(() => sent++).catch(() => undefined);
    }
    return json(200, { sent });
  }

  // ------------------------------------------------------------ webhooks from Telegram / Meta / Twilio
  const id = params.get('i');
  if (id) {
    const { data: integ } = await admin.from('integrations').select('id, organization_id, kind, config, created_by, status').eq('id', id).maybeSingle();
    if (!integ || !CHANNELS.includes(integ.kind) || integ.config?.inbound !== true || !integ.created_by) return new Response('not found', { status: 404 });
    // Meta's one-time check when the webhook is saved in the Meta app.
    if (req.method === 'GET') {
      if (integ.kind === 'whatsapp' && params.get('hub.mode') === 'subscribe' && same(params.get('hub.verify_token') ?? '', await verifyToken(id))) return new Response(params.get('hub.challenge') ?? '', { status: 200 });
      return new Response('forbidden', { status: 403 });
    }
    if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
    const raw = await req.text();
    const secret = await loadSecret(id);
    let text = '';
    let decision: { approvalId: string; approve: boolean; ack?: () => Promise<void> } | null = null;
    let twiml = false;
    if (integ.kind === 'telegram') {
      if (!same(req.headers.get('x-telegram-bot-api-secret-token') ?? '', await telegramSecret(id))) return new Response('forbidden', { status: 403 });
      const u = JSON.parse(raw || '{}');
      const chat = String(u.message?.chat?.id ?? u.callback_query?.message?.chat?.id ?? '');
      if (chat !== String(integ.config?.chat_id)) return json(200, { ignored: true });
      text = String(u.message?.text ?? '').slice(0, 4000);
      const data = String(u.callback_query?.data ?? '');
      const m = /^ap:([0-9a-f-]{36}):(y|n)$/.exec(data);
      if (m) decision = { approvalId: m[1], approve: m[2] === 'y', ack: async () => { await fetch(`https://api.telegram.org/bot${secret.token}/answerCallbackQuery`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback_query_id: u.callback_query.id }), signal: sig() }); } };
    } else if (integ.kind === 'whatsapp') {
      const expected = secret.app_secret ? `sha256=${hex(await hmac('SHA-256', secret.app_secret, raw))}` : '';
      if (!expected || !same(req.headers.get('x-hub-signature-256') ?? '', expected)) return new Response('forbidden', { status: 403 });
      const msg = JSON.parse(raw || '{}')?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!msg || digits(msg.from) !== digits(integ.config?.to)) return json(200, { ignored: true });
      text = String(msg.text?.body ?? '').slice(0, 4000);
      const m = /^ap:([0-9a-f-]{36}):(y|n)$/.exec(String(msg.interactive?.button_reply?.id ?? ''));
      if (m) decision = { approvalId: m[1], approve: m[2] === 'y' };
    } else {
      // Twilio signs the full URL plus the sorted form fields with the account's auth token (HMAC-SHA1, base64).
      const form = new URLSearchParams(raw);
      // Signed over the public link Twilio called (the runtime may see an internal one).
      const signed = hookUrl(id) + [...form.keys()].sort().map(k => k + (form.get(k) ?? '')).join('');
      const expected = btoa(String.fromCharCode(...new Uint8Array(await hmac('SHA-1', secret.token ?? '', signed))));
      if (!same(req.headers.get('x-twilio-signature') ?? '', expected)) return new Response('forbidden', { status: 403 });
      if (digits(form.get('From')) !== digits(integ.config?.to)) return new Response('<Response/>', { headers: { 'content-type': 'text/xml' } });
      text = String(form.get('Body') ?? '').slice(0, 1500);
      const m = /^(approve|yes|ναι|έγκριση|reject|no|όχι|απόρριψη)\s+([0-9a-f]{8})/i.exec(text.trim());
      if (m) {
        const { data: pending } = await admin.from('approvals').select('id').eq('organization_id', integ.organization_id).eq('status', 'pending').limit(100);
        const a = (pending ?? []).find((x: any) => String(x.id).startsWith(m[2].toLowerCase()));
        if (a) decision = { approvalId: a.id, approve: /^(approve|yes|ναι|έγκριση)/i.test(m[1]) };
      }
      twiml = true;
    }

    const owner = integ.created_by as string;
    const work = (async () => {
      const ch = channelFor(integ, secret)!;
      const { data: member } = await admin.from('organization_members').select('role').eq('organization_id', integ.organization_id).eq('user_id', owner).maybeSingle();
      if (!member || !WRITERS.includes(member.role)) return;
      const lang = await langOf(owner);
      if (decision) {
        await decision.ack?.().catch(() => undefined);
        const status = decision.approve ? 'approved' : 'rejected';
        const { data: done } = await admin.from('approvals').update({ status, decided_by: owner, decided_at: new Date().toISOString(), decision_note: `via ${integ.kind}` })
          .eq('id', decision.approvalId).eq('organization_id', integ.organization_id).eq('status', 'pending').select('id').maybeSingle();
        await ch.send(done ? `${t(lang, decision.approve ? 'approved' : 'rejected')}${decision.approve ? `\n${t(lang, 'sendNote')}` : ''}` : t(lang, 'gone'));
        return;
      }
      const cmd = text.trim().toLowerCase();
      if (!cmd) return;
      if (cmd === '/start' || cmd === '/help') { await ch.send(t(lang, 'hello')); return; }
      if (cmd === '/approvals') {
        const { data: list } = await admin.from('approvals').select('id, action, payload, risk').eq('organization_id', integ.organization_id).eq('status', 'pending').order('requested_at', { ascending: false }).limit(5);
        if (!list?.length) { await ch.send(t(lang, 'none')); return; }
        for (const a of list) await ch.send(`${approvalText(a, lang)}${integ.kind === 'twilio' ? `\n\nReply "approve ${String(a.id).slice(0, 8)}" or "reject ${String(a.id).slice(0, 8)}"` : ''}`, integ.kind === 'twilio' ? undefined : approvalButtons(a, lang));
        return;
      }
      if (cmd === '/tasks') {
        const { data: list } = await admin.from('tasks').select('title, status, result').eq('organization_id', integ.organization_id).eq('kind', 'task').order('updated_at', { ascending: false }).limit(6);
        await ch.send(list?.length ? list.map((x: any) => `• ${x.title} — ${x.status}${x.result?.summary ? `\n  ${String(x.result.summary).slice(0, 200)}` : ''}`).join('\n') : t(lang, 'notasks'));
        return;
      }
      // Anything else goes to the AI CEO, in one ongoing conversation per connected app.
      await ch.typing?.().catch(() => undefined);
      const { data: agents } = await admin.from('agents').select('id, type').eq('organization_id', integ.organization_id).eq('enabled', true).order('created_at').limit(50);
      const ceo = (agents ?? []).find((a: any) => a.type === 'ceo') ?? (agents ?? [])[0];
      if (!ceo) { await ch.send(t(lang, 'error')); return; }
      let convoId = String(integ.config?.conversation_id ?? '');
      const { data: convo } = convoId ? await admin.from('conversations').select('id, status, agent_id').eq('id', convoId).maybeSingle() : { data: null };
      if (!convo || convo.status !== 'active' || convo.agent_id !== ceo.id) {
        const { data: created } = await admin.from('conversations').insert({ organization_id: integ.organization_id, user_id: owner, agent_id: ceo.id, title: integ.kind === 'telegram' ? 'Telegram' : integ.kind === 'whatsapp' ? 'WhatsApp' : 'SMS', status: 'active' }).select('id').single();
        if (!created) { await ch.send(t(lang, 'error')); return; }
        convoId = created.id;
        await admin.from('integrations').update({ config: { ...(integ.config ?? {}), conversation_id: convoId } }).eq('id', integ.id);
      }
      const r = await fetch(`${url}/functions/v1/agent-chat`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${service}`, 'x-cron-secret': cronSecret },
        body: JSON.stringify({ conversation_id: convoId, message: text, lang, system_user_id: owner }), signal: AbortSignal.timeout(120_000) }).catch(() => null);
      const out = r && r.ok ? await r.json().catch(() => null) : null;
      await ch.send(String(out?.message?.content ?? '') || t(lang, 'error'));
    })().catch(() => undefined);
    (globalThis as any).EdgeRuntime?.waitUntil?.(work);
    if (!(globalThis as any).EdgeRuntime?.waitUntil) await work;
    return twiml ? new Response('<Response/>', { headers: { 'content-type': 'text/xml' } }) : json(200, { ok: true });
  }

  // ------------------------------------------------------------ manager turns two-way messaging on or off
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user) return json(401, { error: 'unauthorized' });
  const body = await req.json().catch(() => ({}));
  const { data: integ } = await admin.from('integrations').select('id, organization_id, kind, config, created_by').eq('id', String(body.integration_id ?? '')).maybeSingle();
  if (!integ || !CHANNELS.includes(integ.kind)) return json(404, { error: 'not_found' });
  const { data: member } = await admin.from('organization_members').select('role').eq('organization_id', integ.organization_id).eq('user_id', who.user.id).maybeSingle();
  if (!member || !MANAGERS.includes(member.role)) return json(403, { error: 'forbidden' });
  const secret = await loadSecret(integ.id);
  const on = body.action === 'enable';
  if (body.action !== 'enable' && body.action !== 'disable') return json(400, { error: 'bad_request' });
  let setup: Record<string, string> = {};
  if (integ.kind === 'telegram') {
    if (on && !/^-?\d{3,20}$/.test(String(integ.config?.chat_id ?? ''))) return json(422, { error: 'numeric_chat_id_required' });
    const r = await fetch(`https://api.telegram.org/bot${secret.token}/${on ? 'setWebhook' : 'deleteWebhook'}`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(on ? { url: hookUrl(integ.id), secret_token: await telegramSecret(integ.id), allowed_updates: ['message', 'callback_query'], drop_pending_updates: true } : { drop_pending_updates: true }), signal: sig() });
    if (!r.ok) return json(502, { error: 'telegram_refused' });
  } else if (integ.kind === 'whatsapp') {
    if (on) {
      const appSecret = String(body.app_secret ?? '').trim();
      if (!/^[a-f0-9]{32}$/i.test(appSecret) && !secret.app_secret) return json(422, { error: 'app_secret_required' });
      if (appSecret) await admin.from('integration_secrets').update({ secret: JSON.stringify({ ...secret, app_secret: appSecret }) }).eq('integration_id', integ.id);
      setup = { callback_url: hookUrl(integ.id), verify_token: await verifyToken(integ.id) };
    }
  } else if (on) {
    setup = { sms_webhook_url: hookUrl(integ.id) };
  }
  // The person who turns it on is the one the messages act for (their chat / number was verified at connect time).
  await admin.from('integrations').update({ config: { ...(integ.config ?? {}), inbound: on }, ...(on ? { created_by: who.user.id } : {}) }).eq('id', integ.id);
  if (on && integ.kind === 'telegram') {
    const lang = await langOf(who.user.id);
    await telegram(secret.token, String(integ.config?.chat_id)).send(t(lang, 'hello')).catch(() => undefined);
  }
  return json(200, { ok: true, inbound: on, ...setup });
});
