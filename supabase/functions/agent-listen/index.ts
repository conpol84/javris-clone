// Firbo AI voice input: turns a short recording from the microphone into text, so talking to the CEO works in every browser.
// Caller must be a signed-in writer of the company; max ~1.5 MB / one spoken turn per call; metered into usage_events.
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const WRITERS = ['owner', 'admin', 'manager', 'member'];
const MAX_BYTES = 1_500_000;
const LANGS = new Set(['en', 'el', 'es', 'pt', 'de', 'fr', 'zh', 'ar']);

/** Backends to try in order: OpenAI directly, then the company gateway (OmniRoute). */
function backends(): { base: string; key: string }[] {
  const out: { base: string; key: string }[] = [];
  const o = Deno.env.get('OPENAI_API_KEY');
  if (o) out.push({ base: 'https://api.openai.com/v1', key: o });
  for (const [b, k] of [['LLM_BASE_URL', 'LLM_API_KEY'], ['OMNIROUTE_BASE_URL', 'OMNIROUTE_API_KEY']]) {
    const base = Deno.env.get(b);
    const key = Deno.env.get(k);
    if (base && key) out.push({ base: base.replace(/\/+$/, '').replace(/\/v1$/, '') + '/v1', key });
  }
  return out;
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const orgId = String(form.get('organization_id') ?? '');
  const audio = form.get('audio');
  const lang = String(form.get('lang') ?? 'en').split('-')[0];
  if (!orgId || !(audio instanceof File) || audio.size < 800) return json(400, { error: 'bad_request' });
  if (audio.size > MAX_BYTES) return json(413, { error: 'too_long' });

  const admin = createClient(url, service);
  const { data: member } = await admin.from('organization_members').select('role').eq('organization_id', orgId).eq('user_id', user.id).maybeSingle();
  if (!member || !WRITERS.includes(member.role)) return json(403, { error: 'forbidden' });

  const { count: orgDay } = await admin.from('usage_events').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  if ((orgDay ?? 0) >= Number(Deno.env.get('ORG_DAILY_RUN_LIMIT') ?? 100) * 3) return json(429, { error: 'rate_limited' });

  const list = backends();
  if (list.length === 0) return json(503, { error: 'not_configured' });

  const t0 = Date.now();
  for (const b of list) {
    for (const model of ['gpt-4o-mini-transcribe', 'whisper-1']) {
      try {
        const body = new FormData();
        body.append('file', audio, audio.name || 'speech.webm');
        body.append('model', model);
        if (LANGS.has(lang)) body.append('language', lang);
        const res = await fetch(`${b.base}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${b.key}` }, body, signal: AbortSignal.timeout(30_000) });
        if (!res.ok) continue;
        const j = await res.json();
        const text = typeof j?.text === 'string' ? j.text.trim().slice(0, 1000) : '';
        await admin.from('usage_events').insert({
          organization_id: orgId,
          user_id: user.id,
          model: `stt:${model}`,
          input_tokens: Math.round(audio.size / 1000),
          output_tokens: text.length,
          cost_usd: Math.round((Math.min(60, audio.size / 16_000) / 60) * 0.006 * 1e6) / 1e6,
          latency_ms: Date.now() - t0,
        });
        return json(200, { text });
      } catch {
        /* try the next model or gateway */
      }
    }
  }
  return json(502, { error: 'stt_error' });
});
