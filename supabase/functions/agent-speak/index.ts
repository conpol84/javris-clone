// Firbo AI premium voice: turns a short reply into natural speech (OpenAI text-to-speech) for the CEO voice console.
//
// Guarantees (enforced here, not in the browser):
//  - caller must be a signed-in writer of the company named in the request (role check with the service role)
//  - at most 700 characters per call; every call is metered into usage_events and counts toward the company's daily cap
//  - the key lives only in the OPENAI_API_KEY Edge Function secret
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

const WRITERS = ['owner', 'admin', 'manager', 'member'];
const MAX_CHARS = 700;
const MODELS = ['gpt-4o-mini-tts', 'tts-1'];

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

  let body: { organization_id?: string; text?: string } = {};
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
  if (!body.organization_id || typeof body.organization_id !== 'string' || !text) return json(400, { error: 'bad_request' });
  if (text.length > MAX_CHARS) return json(413, { error: 'too_long' });

  const admin = createClient(url, service);
  const { data: member } = await admin.from('organization_members').select('role').eq('organization_id', body.organization_id).eq('user_id', user.id).maybeSingle();
  if (!member || !WRITERS.includes(member.role)) return json(403, { error: 'forbidden' });
  const allowed = (Deno.env.get('RUN_ALLOWED_EMAILS') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const email = (user.email ?? '').toLowerCase();
  if (allowed.length > 0 && !allowed.includes(email) && !allowed.includes(`@${email.split('@')[1] ?? ''}`)) return json(403, { error: 'forbidden' });

  const key = Deno.env.get('OPENAI_API_KEY');
  if (!key) return json(503, { error: 'not_configured' });

  const { count: orgDay } = await admin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', body.organization_id)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  if ((orgDay ?? 0) >= Number(Deno.env.get('ORG_DAILY_RUN_LIMIT') ?? 100) * 3) return json(429, { error: 'rate_limited' });

  const t0 = Date.now();
  for (const model of MODELS) {
    try {
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          voice: 'onyx',
          input: text,
          response_format: 'mp3',
          ...(model === 'gpt-4o-mini-tts' ? { instructions: 'Speak like a calm, confident, futuristic AI chief executive: warm, measured and clear.' } : {}),
        }),
        signal: AbortSignal.timeout(40_000),
      });
      if (!res.ok) continue;
      const audio = new Uint8Array(await res.arrayBuffer());
      await admin.from('usage_events').insert({
        organization_id: body.organization_id,
        user_id: user.id,
        model: `openai:${model}`,
        input_tokens: text.length,
        output_tokens: 0,
        cost_usd: Math.round((text.length / 1000) * Number(Deno.env.get('TTS_PRICE_PER_1K_CHARS') ?? 0.015) * 1e6) / 1e6,
        latency_ms: Date.now() - t0,
      });
      // octet-stream so the browser SDK hands the bytes back as a Blob.
      return new Response(audio, { status: 200, headers: { ...cors, 'content-type': 'application/octet-stream' } });
    } catch {
      /* try the next model */
    }
  }
  return json(502, { error: 'voice_error' });
});
