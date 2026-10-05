// Company knowledge (OpenJarvis's connectors + hybrid retrieval, Firbo style): text, files, web pages and connected apps
// (Notion, GitHub, Google Drive, Gmail, Google Calendar, Outlook) are split into passages, stored per company with a
// 384-number meaning vector (built-in gte-small model) and a keyword index, and searched by the agents' knowledge power.
//
// Guarantees: every action is checked against the caller's role in the company (managers add, sync and delete; members
// search). Tokens of connected apps never leave the server. One company's passages are never visible to another.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { chunkText, embed } from '../_shared/agent-tools.ts';
import { readPageDirect } from '../_shared/free-search.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const MANAGERS = ['owner', 'admin', 'manager'];
const READABLE_APPS = ['notion', 'github', 'gdrive_read', 'gmail_read', 'gcal_read', 'outlook_read'];
const MAX_TEXT = 400_000;
const MAX_CHUNKS = 400;
const sig = (ms = 15_000) => AbortSignal.timeout(ms);
const flat = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

interface Doc { title: string; url: string | null; text: string }

/** Text of the company's connected app, as documents. Throws with a short reason the page can show. */
async function readApp(kind: string, token: string, config: Record<string, unknown>): Promise<Doc[]> {
  const get = async (url: string, headers: Record<string, string>) => {
    const r = await fetch(url, { headers, signal: sig() });
    if (r.status === 401 || r.status === 403) throw new Error('reauth');
    if (!r.ok) throw new Error(`http_${r.status}`);
    return r;
  };
  const bearer = { authorization: `Bearer ${token}` };
  if (kind === 'notion') {
    const h = { ...bearer, 'Notion-Version': '2022-06-28', 'content-type': 'application/json' };
    const r = await fetch('https://api.notion.com/v1/search', { method: 'POST', headers: h, body: JSON.stringify({ page_size: 40, filter: { property: 'object', value: 'page' } }), signal: sig() });
    if (r.status === 401) throw new Error('reauth');
    if (!r.ok) throw new Error(`http_${r.status}`);
    const pages = ((await r.json())?.results ?? []).slice(0, 40);
    const docs: Doc[] = [];
    for (const p of pages) {
      const titleProp = Object.values(p.properties ?? {}).find((x: any) => x?.type === 'title') as any;
      const title = (titleProp?.title ?? []).map((t: any) => t.plain_text).join('') || 'Notion page';
      const b = await get(`https://api.notion.com/v1/blocks/${p.id}/children?page_size=100`, h).then(x => x.json());
      const text = (b.results ?? []).map((blk: any) => (blk[blk.type]?.rich_text ?? []).map((t: any) => t.plain_text).join('')).filter(Boolean).join('\n');
      if (text.trim()) docs.push({ title, url: p.url ?? null, text });
    }
    return docs;
  }
  if (kind === 'github') {
    const repo = String(config.repo ?? '');
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('bad_repo');
    const h = { ...bearer, 'user-agent': 'firbo-ai', accept: 'application/vnd.github+json' };
    const docs: Doc[] = [];
    const readme = await fetch(`https://api.github.com/repos/${repo}/readme`, { headers: { ...h, accept: 'application/vnd.github.raw' }, signal: sig() });
    if (readme.status === 401 || readme.status === 403) throw new Error('reauth');
    if (!readme.ok && readme.status !== 404) throw new Error(`http_${readme.status}`);
    if (readme.ok) docs.push({ title: `${repo} README`, url: `https://github.com/${repo}#readme`, text: await readme.text() });
    const tree = await fetch(`https://api.github.com/repos/${repo}/contents/docs`, { headers: h, signal: sig() });
    if (!tree.ok && tree.status !== 404) throw new Error(`http_${tree.status}`);
    if (tree.ok) {
      for (const f of ((await tree.json()) ?? []).filter((x: any) => x.type === 'file' && /\.(md|mdx|txt)$/i.test(x.name)).slice(0, 15)) {
        const raw = await fetch(f.download_url, { signal: sig() });
        if (!raw.ok) throw new Error(`http_${raw.status}`);
        docs.push({ title: `${repo}/${f.path}`, url: f.html_url ?? null, text: await raw.text() });
      }
    }
    const issues = await get(`https://api.github.com/repos/${repo}/issues?state=all&per_page=30&sort=updated`, h).then(x => x.json());
    for (const i of issues ?? []) docs.push({ title: `${i.pull_request ? 'PR' : 'Issue'} #${i.number}: ${flat(i.title, 150)}`, url: i.html_url ?? null, text: `${i.title}\nState: ${i.state}\n${i.body ?? ''}` });
    return docs;
  }
  if (kind === 'gdrive_read') {
    const q = encodeURIComponent("trashed=false and (mimeType='application/vnd.google-apps.document' or mimeType='application/vnd.google-apps.spreadsheet' or mimeType='application/vnd.google-apps.presentation' or mimeType='text/plain' or mimeType='text/markdown' or mimeType='text/csv')");
    const list = await get(`https://www.googleapis.com/drive/v3/files?pageSize=30&orderBy=modifiedTime desc&fields=files(id,name,mimeType,webViewLink)&q=${q}`, bearer).then(x => x.json());
    const docs: Doc[] = [];
    for (const f of (list.files ?? []).slice(0, 30)) {
      const exportAs = f.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'text/csv' : 'text/plain';
      const url = f.mimeType.startsWith('application/vnd.google-apps.') ? `https://www.googleapis.com/drive/v3/files/${f.id}/export?mimeType=${encodeURIComponent(exportAs)}` : `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`;
      const r = await fetch(url, { headers: bearer, signal: sig() });
      if (r.status === 401 || r.status === 403) throw new Error('reauth');
      if (!r.ok) throw new Error(`http_${r.status}`);
      docs.push({ title: f.name, url: f.webViewLink ?? null, text: (await r.text()).slice(0, 60_000) });
    }
    return docs;
  }
  if (kind === 'gmail_read') {
    const list = await get('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=30&q=newer_than:60d -category:promotions -category:social', bearer).then(x => x.json());
    const decode = (d: string) => { try { return new TextDecoder().decode(Uint8Array.from(atob(d.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0))); } catch { return ''; } };
    const plain = (part: any): string => part?.mimeType === 'text/plain' && part.body?.data ? decode(part.body.data) : (part?.parts ?? []).map(plain).find(Boolean) ?? '';
    const docs: Doc[] = [];
    for (const m of (list.messages ?? []).slice(0, 30)) {
      const msg = await get(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=full`, bearer).then(x => x.json());
      const hdr = (n: string) => (msg.payload?.headers ?? []).find((x: any) => String(x.name).toLowerCase() === n)?.value ?? '';
      const body = plain(msg.payload) || msg.snippet || '';
      docs.push({ title: `Email: ${flat(hdr('subject'), 150) || '(no subject)'}`, url: `https://mail.google.com/mail/u/0/#all/${m.id}`, text: `From: ${hdr('from')}\nDate: ${hdr('date')}\nSubject: ${hdr('subject')}\n\n${body.slice(0, 8000)}` });
    }
    return docs;
  }
  if (kind === 'gcal_read') {
    const from = new Date(Date.now() - 14 * 86_400_000).toISOString();
    const to = new Date(Date.now() + 45 * 86_400_000).toISOString();
    const ev = await get(`https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=100&timeMin=${encodeURIComponent(from)}&timeMax=${encodeURIComponent(to)}`, bearer).then(x => x.json());
    const lines = (ev.items ?? []).map((e: any) => `- ${e.start?.dateTime ?? e.start?.date ?? ''}: ${flat(e.summary, 150)}${e.location ? ` @ ${flat(e.location, 100)}` : ''}${e.description ? ` — ${flat(e.description, 300)}` : ''}`);
    return lines.length ? [{ title: 'Calendar (last 2 weeks and next 6 weeks)', url: 'https://calendar.google.com', text: lines.join('\n') }] : [];
  }
  if (kind === 'outlook_read') {
    const mail = await get('https://graph.microsoft.com/v1.0/me/messages?$top=30&$select=subject,from,receivedDateTime,bodyPreview,webLink', bearer).then(x => x.json());
    return (mail.value ?? []).map((m: any) => ({ title: `Email: ${flat(m.subject, 150) || '(no subject)'}`, url: m.webLink ?? null,
      text: `From: ${m.from?.emailAddress?.address ?? ''}\nDate: ${m.receivedDateTime}\nSubject: ${m.subject}\n\n${m.bodyPreview ?? ''}` }));
  }
  throw new Error('unsupported_app');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const admin = createClient(url, service);
  let body: Record<string, any> = {};
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
  const started = Date.now();

  /** Fills in meaning vectors for passages that do not have one yet, within the time left. */
  const embedPending = async (filter: { org?: string; source?: string }, budgetMs: number) => {
    let done = 0;
    while (Date.now() - started < budgetMs) {
      let q = admin.from('knowledge_chunks').select('id, title, content').is('vec', null).limit(20);
      if (filter.org) q = q.eq('organization_id', filter.org);
      if (filter.source) q = q.eq('source_id', filter.source);
      const { data, error } = await q;
      if (error) throw new Error('database_unavailable');
      if (!data?.length) break;
      for (const c of data) {
        const v = await embed(`${c.title}\n${c.content}`);
        if (!v) return done; // no model in this runtime: keyword search still works
        let update = admin.from('knowledge_chunks').update({ vec: JSON.stringify(v) }).eq('id', c.id);
        if (filter.org) update = update.eq('organization_id', filter.org);
        if (filter.source) update = update.eq('source_id', filter.source);
        const { data: saved, error: saveError } = await update.select('id').maybeSingle();
        if (saveError) throw new Error('database_unavailable');
        if (!saved) continue; // a concurrent source deletion/replacement removed this passage
        done++;
        if (Date.now() - started > budgetMs) break;
      }
    }
    return done;
  };

  try {
  // Scheduler: finish the vectors in the background.
  const cron = req.headers.get('x-cron-secret');
  if (cron) {
    const { data: sec, error } = await admin.from('cron_secrets').select('value').eq('name', 'shifts').maybeSingle();
    if (error) throw new Error('database_unavailable');
    if (!sec || sec.value !== cron) return json(401, { error: 'unauthorized' });
    if (body.action !== 'embed_pending') return json(400, { error: 'bad_request' });
    return json(200, { embedded: await embedPending({}, 100_000) });
  }

  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });
  const roleIn = async (org: string) => {
    const { data, error } = await admin.from('organization_members').select('role').eq('organization_id', org).eq('user_id', user.id).maybeSingle();
    if (error) throw new Error('database_unavailable');
    return data?.role as string | undefined;
  };

  // Replaces a source's passages with the given documents and starts the vectors.
  const store = async (source: { id: string; organization_id: string }, docs: Doc[]) => {
    const rows: Record<string, unknown>[] = [];
    let total = 0;
    for (const d of docs) {
      const text = d.text.slice(0, Math.max(0, MAX_TEXT - total));
      total += text.length;
      chunkText(text).forEach((content, i) => rows.push({ title: d.title.slice(0, 200), url: d.url, content, chunk_index: i, metadata: {} }));
      if (total >= MAX_TEXT) break;
    }
    const keep = rows.slice(0, MAX_CHUNKS);
    if (!keep.length) throw new Error('empty_source');
    // The RPC locks the scoped source and replaces passages plus ready metadata
    // in one transaction. Any failed insert rolls back to the previous knowledge.
    const { data: passages, error } = await admin.rpc('replace_knowledge_chunks', { p_org: source.organization_id, p_source: source.id, p_actor: user.id, p_chunks: keep });
    if (error || passages !== keep.length) throw new Error('save_failed');
    let embedded = 0;
    let embeddingError: string | null = null;
    try { embedded = await embedPending({ org: source.organization_id, source: source.id }, 40_000); }
    catch { embeddingError = 'embedding_incomplete'; }
    // Keywords remain available immediately; optional vectors can finish by cron.
    return { passages: keep.length, embedded, embedding_pending: embedded < keep.length, embedding_error: embeddingError, truncated: rows.length > keep.length || total >= MAX_TEXT };
  };

  const sync = async (source: any) => {
    if (source.type === 'url' || source.type === 'website') {
      const text = await readPageDirect(String(source.url), fetch, req.signal);
      return await store(source, [{ title: source.name, url: source.url, text }]);
    }
    if (source.type === 'integration') {
      const { data: integ, error } = await admin.from('integrations').select('id, kind, config, organization_id').eq('id', source.integration_id).eq('organization_id', source.organization_id).maybeSingle();
      if (error) throw new Error('database_unavailable');
      if (!integ || integ.organization_id !== source.organization_id || !READABLE_APPS.includes(integ.kind)) throw new Error('app_missing');
      let token = '';
      if (integ.kind === 'notion' || integ.kind === 'github') {
        const { data: s, error: secretError } = await admin.from('integration_secrets').select('secret').eq('integration_id', integ.id).maybeSingle();
        if (secretError) throw new Error('database_unavailable');
        try { token = JSON.parse(String(s?.secret ?? '{}')).token ?? ''; } catch { token = ''; }
      } else {
        const { data: c, error: cronError } = await admin.from('cron_secrets').select('value').eq('name', 'shifts').maybeSingle();
        if (cronError) throw new Error('database_unavailable');
        if (!c?.value) throw new Error('reauth');
        const r = await fetch(`${url}/functions/v1/integrations`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${service}`, 'x-cron-secret': c?.value ?? '' }, body: JSON.stringify({ action: 'access_token', id: integ.id }), signal: sig() });
        token = r.ok ? String((await r.json()).token ?? '') : '';
        if (r.status === 409) throw new Error('reauth');
      }
      if (!token) throw new Error('reauth');
      return await store(source, await readApp(integ.kind, token, (integ.config ?? {}) as Record<string, unknown>));
    }
    throw new Error('not_syncable');
  };

  const fail = async (source: { id: string; organization_id: string }, error: unknown) => {
    const reason = error instanceof Error ? error.message.slice(0, 80) : 'failed';
    const { data, error: saveError } = await admin.from('knowledge_sources').update({ status: 'failed', last_error: reason, updated_at: new Date().toISOString() })
      .eq('id', source.id).eq('organization_id', source.organization_id).eq('status', 'indexing').select('id').maybeSingle();
    if (saveError) return json(503, { error: 'status_save_failed', reason });
    if (!data) return json(409, { error: 'source_changed', reason });
    return json(502, { error: 'sync_failed', reason });
  };

  if (body.action === 'search') {
    const org = String(body.organization_id ?? '');
    const query = flat(body.query, 300);
    if (!org || !query) return json(400, { error: 'bad_request' });
    if (!(await roleIn(org))) return json(403, { error: 'forbidden' });
    const v = await embed(query);
    const { data, error } = await userClient.rpc('match_knowledge', { p_org: org, p_query: query, p_embedding: v ? JSON.stringify(v) : null, p_limit: 8 });
    if (error) return json(500, { error: 'search_failed' });
    return json(200, { results: data ?? [], semantic: !!v });
  }

  if (['add_text', 'add_url', 'add_app'].includes(body.action)) {
    const org = String(body.organization_id ?? '');
    if (!org || !MANAGERS.includes((await roleIn(org)) ?? '')) return json(403, { error: 'forbidden' });
    const { count, error: countError } = await admin.from('knowledge_sources').select('id', { count: 'exact', head: true }).eq('organization_id', org);
    if (countError || count == null) throw new Error('database_unavailable');
    const { data: cap, error: capError } = await admin.rpc('plan_limit', { p_org: org, p_key: 'knowledge_sources' });
    if (capError || (cap != null && !Number.isFinite(Number(cap)))) throw new Error('database_unavailable');
    if (cap != null && (count ?? 0) >= Number(cap)) return json(429, { error: 'plan_limit' });
    let row: Record<string, unknown>;
    let docs: Doc[] | null = null;
    if (body.action === 'add_text') {
      const name = flat(body.name, 120);
      const text = String(body.text ?? '').slice(0, MAX_TEXT);
      if (!name || text.trim().length < 20) return json(400, { error: 'too_short' });
      row = { type: body.kind === 'upload' ? 'upload' : 'text', name, metadata: { chars: text.length } };
      docs = [{ title: name, url: null, text }];
    } else if (body.action === 'add_url') {
      const link = String(body.url ?? '').trim();
      if (!/^https?:\/\/[^\s]+$/.test(link) || link.length > 500) return json(400, { error: 'bad_url' });
      row = { type: 'url', name: flat(body.name, 120) || link.replace(/^https?:\/\//, '').slice(0, 120), url: link };
    } else {
      const { data: integ, error: integrationError } = await admin.from('integrations').select('id, kind, name, organization_id').eq('id', String(body.integration_id ?? '')).eq('organization_id', org).maybeSingle();
      if (integrationError) throw new Error('database_unavailable');
      if (!integ || integ.organization_id !== org || !READABLE_APPS.includes(integ.kind)) return json(400, { error: 'app_not_readable' });
      row = { type: 'integration', name: integ.name, integration_id: integ.id, metadata: { kind: integ.kind } };
    }
    const { data: source, error } = await admin.from('knowledge_sources').insert({ ...row, organization_id: org, status: 'indexing', created_by: user.id }).select('*').single();
    if (error || !source) return json(500, { error: 'save_failed' });
    try {
      return json(200, { source_id: source.id, ...(docs ? await store(source, docs) : await sync(source)) });
    } catch (e) {
      return await fail(source, e);
    }
  }

  if (body.action === 'sync' || body.action === 'delete') {
    const { data: source, error: sourceError } = await admin.from('knowledge_sources').select('*').eq('id', String(body.source_id ?? '')).maybeSingle();
    if (sourceError) throw new Error('database_unavailable');
    if (!source) return json(404, { error: 'not_found' });
    if (!MANAGERS.includes((await roleIn(source.organization_id)) ?? '')) return json(403, { error: 'forbidden' });
    if (body.action === 'delete') {
      // The composite FK cascades chunks atomically with this source deletion.
      const { data: deleted, error } = await userClient.from('knowledge_sources').delete().eq('id', source.id).eq('organization_id', source.organization_id).select('id').maybeSingle();
      if (error) return json(503, { error: 'delete_failed' });
      if (!deleted) return json(404, { error: 'not_found' });
      return json(200, { ok: true });
    }
    const { data: claimed, error: claimError } = await admin.from('knowledge_sources').update({ status: 'indexing', last_error: null })
      .eq('id', source.id).eq('organization_id', source.organization_id).neq('status', 'indexing').select('id').maybeSingle();
    if (claimError) throw new Error('database_unavailable');
    if (!claimed) return json(409, { error: 'sync_in_progress' });
    try { return json(200, await sync(source)); } catch (e) { return await fail(source, e); }
  }

  return json(400, { error: 'bad_request' });
  } catch {
    return json(503, { error: 'database_unavailable' });
  }
});
