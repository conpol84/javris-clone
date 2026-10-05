// The OpenJarvis server on Firbo's VPS (code, files, browser tools), reachable for platform admins only.
// Secrets: OPENJARVIS_URL (https, e.g. https://api.firboai.app/jarvis) and OPENJARVIS_API_KEY (the key in serve.env).
// The key never reaches the browser; every call is checked against public.platform_admins.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  if (!who?.user) return json(401, { error: 'unauthorized' });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: isAdmin } = await admin.from('platform_admins').select('user_id').eq('user_id', who.user.id).maybeSingle();
  if (!isAdmin) return json(403, { error: 'forbidden' });

  const base = (Deno.env.get('OPENJARVIS_URL') ?? '').replace(/\/+$/, '');
  const key = Deno.env.get('OPENJARVIS_API_KEY') ?? '';
  if (!/^https:\/\/[^\s/]+/.test(base) || !key) return json(200, { configured: false });
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${key}` };
  const get = async (path: string) => {
    const res = await fetch(`${base}${path}`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`http_${res.status}`);
    return res.json();
  };

  let body: { action?: string; message?: string; model?: string } = {};
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }

  if (body.action === 'chat') {
    const message = String(body.message ?? '').trim().slice(0, 4000);
    if (!message) return json(400, { error: 'empty_message' });
    const started = Date.now();
    try {
      const res = await fetch(`${base}/v1/chat/completions`, { method: 'POST', headers, signal: AbortSignal.timeout(140_000),
        body: JSON.stringify({ ...(body.model ? { model: String(body.model).slice(0, 120) } : {}), messages: [{ role: 'user', content: message }], stream: false }) });
      if (!res.ok) return json(502, { error: `jarvis_http_${res.status}` });
      const out = await res.json();
      return json(200, { reply: String(out?.choices?.[0]?.message?.content ?? ''), model: out?.model ?? null, ms: Date.now() - started });
    } catch (error) {
      return json(504, { error: error instanceof Error && error.name === 'TimeoutError' ? 'jarvis_timeout' : 'jarvis_unreachable' });
    }
  }

  // Status: is it up, which model/agent/engine, which models it can use.
  try {
    const [info, models] = await Promise.all([get('/v1/info'), get('/v1/models').catch(() => ({ data: [] }))]);
    return json(200, { configured: true, online: true, model: info?.model ?? '', agent: info?.agent ?? '', engine: info?.engine ?? '',
      models: (Array.isArray(models?.data) ? models.data : []).map((m: any) => String(m?.id ?? '')).filter(Boolean).slice(0, 50) });
  } catch (error) {
    return json(200, { configured: true, online: false, reason: error instanceof Error ? error.message.slice(0, 40) : 'error' });
  }
});
