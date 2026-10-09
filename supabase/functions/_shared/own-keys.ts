// Bring-your-own API keys (Pro, Business, Enterprise). A company saves its own OpenAI / Anthropic / ... key once;
// an agent whose model is "<provider>:<model>" then calls that provider directly with the company's key,
// so the provider bills the company and Firbo records the usage at $0.
// The key is stored encrypted in Supabase Vault and is only readable by the service role (provider_key_for_runtime).

/** OpenAI-compatible chat endpoints of the providers a company can connect. */
export const OWN_KEY_BASES: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  deepseek: 'https://api.deepseek.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  xai: 'https://api.x.ai/v1',
};
export const OWN_KEY_PROVIDERS = Object.keys(OWN_KEY_BASES);

export interface OwnKeyTarget { provider: string; model: string; base: string; key: string; own: true }

/** "openai:gpt-5-mini" -> { provider: 'openai', model: 'gpt-5-mini' } when the provider supports own keys. */
export function ownKeyModel(spec: string | null | undefined): { provider: string; model: string } | null {
  if (!spec) return null;
  const i = spec.indexOf(':');
  if (i <= 0) return null;
  const provider = spec.slice(0, i).trim().toLowerCase();
  const model = spec.slice(i + 1).trim();
  if (!(provider in OWN_KEY_BASES) || !/^[\w.\/:-]{1,120}$/.test(model)) return null;
  return { provider, model };
}

/** The company's own key for this agent's model, or null (no key, unsupported provider, or a plan without byo_keys). */
export async function ownKeyTarget(
  admin: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
  organizationId: string,
  spec: string | null | undefined,
): Promise<OwnKeyTarget | null> {
  const m = ownKeyModel(spec);
  if (!m) return null;
  try {
    const { data, error } = await admin.rpc('provider_key_for_runtime', { p_org: organizationId, p_provider: m.provider });
    if (error || typeof data !== 'string' || data.length < 8) return null;
    return { ...m, base: OWN_KEY_BASES[m.provider], key: data, own: true };
  } catch {
    return null;
  }
}

/** Chat request body for a provider: OpenAI's newer models take max_completion_tokens and no temperature. */
export function chatBody(target: { provider: string; model: string }, messages: unknown[], temperature: number, maxTokens: number) {
  return target.provider === 'openai'
    ? { model: target.model, max_completion_tokens: Math.max(maxTokens, 8000), messages }
    : { model: target.model, max_tokens: maxTokens, temperature, messages };
}

const CHAT_MODEL: Record<string, (id: string) => boolean> = {
  openai: id => /^(gpt-|o\d|chatgpt-)/.test(id) && !/(audio|realtime|tts|transcribe|image|search|embedding|moderation|instruct)/.test(id),
  anthropic: id => id.startsWith('claude'),
  google: id => id.startsWith('gemini') && !/(embedding|image|tts|live|aqa)/.test(id),
  groq: id => !/(whisper|tts|guard|distil)/.test(id),
  mistral: id => !/(embed|moderation|ocr)/.test(id),
  deepseek: () => true,
  openrouter: () => true,
  xai: id => id.startsWith('grok') && !/image/.test(id),
};

/** Checks a key with the provider (a read-only "list models" call) and returns the chat models it can use. */
export async function verifyProviderKey(provider: string, key: string, fetcher: typeof fetch = fetch): Promise<{ ok: true; models: string[] } | { ok: false; reason: 'invalid_key' | 'provider_unreachable' }> {
  const base = OWN_KEY_BASES[provider];
  if (!base) return { ok: false, reason: 'invalid_key' };
  let url = `${base}/models`;
  let headers: Record<string, string> = { authorization: `Bearer ${key}` };
  if (provider === 'anthropic') { url = 'https://api.anthropic.com/v1/models?limit=100'; headers = { 'x-api-key': key, 'anthropic-version': '2023-06-01' }; }
  // OpenRouter lists models without a key, so check the key itself instead.
  if (provider === 'openrouter') url = 'https://openrouter.ai/api/v1/key';
  let res: Response;
  try { res = await fetcher(url, { headers, signal: AbortSignal.timeout(15_000) }); } catch { return { ok: false, reason: 'provider_unreachable' }; }
  if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid_key' };
  if (!res.ok) return { ok: false, reason: 'provider_unreachable' };
  if (provider === 'openrouter') return { ok: true, models: [] };
  const body = await res.json().catch(() => null) as { data?: { id?: unknown }[] } | null;
  const keep = CHAT_MODEL[provider] ?? (() => true);
  const ids = (Array.isArray(body?.data) ? body!.data : [])
    .map(m => String(m?.id ?? '').replace(/^models\//, ''))
    .filter(id => id && /^[\w.\/:-]{1,120}$/.test(id) && keep(id.toLowerCase()));
  return { ok: true, models: [...new Set(ids)].sort().reverse().slice(0, 60) };
}
