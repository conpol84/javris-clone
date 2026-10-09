import { MAX_PCM_BYTES, profileOf, renderWave, speechRequest, validMp3 } from './audio-profile.ts';
// Client constructor is injected so the exact handler is testable without keys.
export type Dependencies = { createClient: (...args: any[]) => any; env: (name: string) => string | undefined; http?: typeof fetch };
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-expose-headers': 'X-Firbo-Voice-Profile, X-Firbo-Audio-Format, X-Firbo-Voice-Model',
  'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
};
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
/** Cancel a slow reader even if its transport ignores the AbortSignal. */
async function boundedRead(body: ReadableStream<Uint8Array> | null, max: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!body) throw new Error('invalid_body');
  const reader = body.getReader(); let abort = () => {};
  try {
    const cancelled = new Promise<never>((_, reject) => {
      abort = () => { void reader.cancel().catch(() => {}); reject(new DOMException('Cancelled', 'AbortError')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    let total = 0; const chunks: Uint8Array[] = [];
    while (true) {
      const part = await Promise.race([reader.read(), cancelled]);
      if (part.done) break;
      total += part.value.length;
      if (total > max) throw new Error('body_too_large');
      chunks.push(part.value);
    }
    const out = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
    return out;
  } finally { signal.removeEventListener('abort', abort); void reader.cancel().catch(() => {}); }
}
export function createSpeechHandler({ createClient, env, http = fetch }: Dependencies) {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!req.headers.get('authorization')) return json(401, { error: 'unauthorized' });
    const url = env('SUPABASE_URL'), anon = env('SUPABASE_ANON_KEY'), service = env('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !anon || !service) return json(503, { error: 'not_configured' });
    try {
      const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization')! } } });
      const who = await userClient.auth.getUser();
      const user = who.data?.user;
      if (who.error || !user) return json(401, { error: 'unauthorized' });
      let body: Record<string, unknown>;
      try {
        const raw = await boundedRead(req.body, 16_384, AbortSignal.any([req.signal, AbortSignal.timeout(5000)]));
        body = JSON.parse(new TextDecoder().decode(raw));
        if (!body || Array.isArray(body) || typeof body !== 'object') return json(400, { error: 'bad_request' });
      } catch { return json(400, { error: 'bad_request' }); }
      const text = typeof body.text === 'string' ? body.text.replace(/\s+/g, ' ').trim() : '';
      const org = body.organization_id;
      if (typeof org !== 'string' || !org.trim() || org.length > 80 || !text) return json(400, { error: 'bad_request' });
      if (text.length > 700) return json(413, { error: 'too_long' });
      let profile;
      try { profile = profileOf(body.voice_profile); } catch { return json(400, { error: 'bad_request' }); }
      // Old frontends still receive MP3. WAV is explicitly negotiated by new clients.
      if (body.audio_format !== undefined && body.audio_format !== 'wav') return json(400, { error: 'bad_request' });
      const wave = body.audio_format === 'wav';
      const admin = createClient(url, service);
      const membership = await admin.from('organization_members').select('role').eq('organization_id', org).eq('user_id', user.id).maybeSingle();
      if (membership.error) return json(503, { error: 'authorization_unavailable' });
      if (!membership.data || !['owner', 'admin', 'manager', 'member'].includes(membership.data.role)) return json(403, { error: 'forbidden' });
      const allowed = (env('RUN_ALLOWED_EMAILS') ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
      const email = String(user.email ?? '').toLowerCase();
      if (allowed.length && !allowed.includes(email) && !allowed.includes(`@${email.split('@')[1] ?? ''}`)) return json(403, { error: 'forbidden' });
      const key = env('OPENAI_API_KEY');
      if (!key) return json(503, { error: 'not_configured' });
      const limit = Number(env('ORG_DAILY_RUN_LIMIT') ?? 100);
      if (!Number.isFinite(limit) || limit < 1 || limit > 1_000_000) return json(503, { error: 'not_configured' });
      const usage = await admin.from('usage_events').select('id', { count: 'exact', head: true }).eq('organization_id', org).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
      if (usage.error || typeof usage.count !== 'number') return json(503, { error: 'usage_unavailable' });
      if (usage.count >= limit * 3) return json(429, { error: 'rate_limited' });
      // Existing estimate convention is retained; this is not a new atomic budget ledger.
      const price = Number(env('TTS_PRICE_PER_1K_CHARS') ?? 0.015);
      if (!Number.isFinite(price) || price < 0) return json(503, { error: 'not_configured' });
      const started = Date.now();
      const requestSignal = AbortSignal.any([req.signal, AbortSignal.timeout(28_000)]);
      for (const model of ['gpt-4o-mini-tts', 'tts-1']) {
        if (requestSignal.aborted) return json(504, { error: 'voice_timeout' });
        let res: Response;
        try {
          res = await http('https://api.openai.com/v1/audio/speech', {
            method: 'POST', redirect: 'error',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
            body: JSON.stringify(speechRequest(model, text, profile, wave)), signal: requestSignal,
          });
        } catch { return json(requestSignal.aborted ? 504 : 502, { error: 'voice_error' }); }
        if (!res.ok) {
          void res.body?.cancel().catch(() => {});
          if (res.status === 429) return json(429, { error: 'rate_limited' });
          if ([401, 402, 403].includes(res.status)) return json(503, { error: 'voice_unavailable' });
          // Retry only definite model rejection, never a timeout or partially received voice.
          if ([400, 404].includes(res.status) && model === 'gpt-4o-mini-tts') continue;
          return json(502, { error: 'voice_error' });
        }
        let audio: Uint8Array;
        try {
          const type = (res.headers.get('content-type') ?? '').split(';')[0];
          if (!['application/octet-stream', 'audio/pcm', 'audio/mpeg', 'audio/mp3'].includes(type)) throw new Error('invalid_audio');
          const source = await boundedRead(res.body, wave ? MAX_PCM_BYTES : 8_000_000, requestSignal);
          if (requestSignal.aborted) throw new Error('cancelled');
          if (wave) { if (['audio/mpeg','audio/mp3'].includes(type) || validMp3(source)) throw new Error('invalid_pcm'); audio = renderWave(source, profile); }
          else { if (!validMp3(source)) throw new Error('invalid_audio'); audio = source; }
        } catch { return json(502, { error: 'voice_error' }); }
        const saved = await admin.from('usage_events').insert({
          organization_id: org, user_id: user.id, model: `openai:${model}`,
          input_tokens: text.length, output_tokens: 0,
          cost_usd: Math.round(text.length / 1000 * price * 1e6) / 1e6, latency_ms: Date.now() - started,
        });
        if (saved.error) return json(503, { error: 'usage_unavailable' });
        if (req.signal.aborted) return json(499, { error: 'cancelled' });
        // octet-stream is required for the existing Supabase SDK Blob response path.
        return new Response(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength) as ArrayBuffer, {
          status: 200, headers: { ...CORS, 'content-type': 'application/octet-stream',
            'x-firbo-voice-profile': profile,
            'x-firbo-audio-format': wave ? 'wav' : 'mp3', 'x-firbo-voice-model': model },
        });
      }
      return json(502, { error: 'voice_error' });
    } catch { return json(503, { error: 'voice_unavailable' }); }
  };
}
