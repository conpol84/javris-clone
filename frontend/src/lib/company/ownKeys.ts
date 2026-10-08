import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

/** Providers a company can connect with its own API key (Pro, Business, Enterprise). Same list as the server. */
export const OWN_KEY_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', keysUrl: 'https://platform.openai.com/api-keys', example: 'gpt-5-mini' },
  { id: 'anthropic', name: 'Anthropic (Claude)', keysUrl: 'https://console.anthropic.com/settings/keys', example: 'claude-sonnet-5-5' },
  { id: 'google', name: 'Google Gemini', keysUrl: 'https://aistudio.google.com/apikey', example: 'gemini-2.5-flash' },
  { id: 'groq', name: 'Groq', keysUrl: 'https://console.groq.com/keys', example: 'llama-3.3-70b-versatile' },
  { id: 'mistral', name: 'Mistral', keysUrl: 'https://console.mistral.ai/api-keys', example: 'mistral-large-latest' },
  { id: 'deepseek', name: 'DeepSeek', keysUrl: 'https://platform.deepseek.com/api_keys', example: 'deepseek-chat' },
  { id: 'openrouter', name: 'OpenRouter', keysUrl: 'https://openrouter.ai/keys', example: 'anthropic/claude-sonnet-4' },
  { id: 'xai', name: 'xAI (Grok)', keysUrl: 'https://console.x.ai', example: 'grok-4' },
] as const;
export type OwnKeyProvider = (typeof OWN_KEY_PROVIDERS)[number]['id'];

export interface OwnKeyRow {
  provider: OwnKeyProvider;
  key_hint: string;
  models: string[];
  updated_at: string;
}

export async function listOwnKeys(orgId: string): Promise<OwnKeyRow[]> {
  const { data, error } = await requireClient()
    .from('org_provider_keys')
    .select('provider, key_hint, models, updated_at')
    .eq('organization_id', orgId)
    .order('provider');
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as OwnKeyRow[];
}

export type OwnKeyError = 'invalid_key' | 'provider_unreachable' | 'plan_limit' | 'forbidden' | 'save_failed' | 'unknown';
export class OwnKeyFailure extends Error {
  constructor(public code: OwnKeyError) {
    super(code);
  }
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke('provider-keys', { body });
  if (error) {
    let code: OwnKeyError = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (['invalid_key', 'provider_unreachable', 'plan_limit', 'forbidden', 'save_failed'].includes(b?.error)) code = b.error;
      } catch {
        /* keep unknown */
      }
    }
    throw new OwnKeyFailure(code);
  }
  return data as T;
}

/** The server checks the key with the provider before it stores it encrypted; the key never comes back. */
export const saveOwnKey = (organization_id: string, provider: OwnKeyProvider, key: string) =>
  call<{ ok: true; key_hint: string; models: string[] }>({ action: 'save', organization_id, provider, key });
export const removeOwnKey = (organization_id: string, provider: OwnKeyProvider) =>
  call<{ ok: true }>({ action: 'remove', organization_id, provider });
