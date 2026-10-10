/** FIRBO CEO local fallback eligibility.
 * This file is imported only by agent-chat, not by the immutable 19-file
 * agent-runner bundle. Never change the shared runner source manifest here.
 */
import { freeForOrganization } from './free-routing.ts';
import type { EnvReader } from './gateway-routing.ts';

/** Sanitize a legacy direct-provider failure: no raw exception, prompt or key. */
export function legacyProviderFailureCode(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  const match = /^[a-z0-9_-]{1,32}_http_(\d{3})$/.exec(message);
  if (match) {
    const status = Number(match[1]);
    if (status === 429) return 'model_provider_rate_limited';
    if (status === 401 || status === 403) return 'model_provider_auth_error';
    if (status === 402) return 'model_provider_payment_required';
    if (status === 400 || status === 404) return 'model_request_rejected';
    if (status >= 500 && status <= 599) return 'model_provider_unavailable';
    return 'model_provider_http_error';
  }
  if (/^[a-z0-9_-]{1,32}_empty$/.test(message)) return 'model_empty_response';
  if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name))
    return 'model_timeout_or_cancelled';
  return 'model_error';
}

/** Disabled by default; one direct provider must have definitely rejected HTTP429.
 * Own-key and non-CEO access are never eligible. Timeouts, ambiguous 5xx,
 * gateway combos or multiple target chains are never auto-replayed.
 */
export function approvedFreeCeoFallback(input: {
  organizationId: string; isCeo: boolean; isOwnerOrAdmin: boolean;
  isUserSession: boolean; hasOwnKey: boolean; alreadyFree: boolean;
  directTargetCount: number; directProvider: string; directBase: string;
  errorCode: string; env: EnvReader;
}): boolean {
  if (!input.isCeo || !input.isOwnerOrAdmin || !input.isUserSession
    || input.hasOwnKey || input.alreadyFree || input.directTargetCount !== 1
    // OmniRoute may have done upstream work before returning 429: no auto-replay.
    || input.directProvider !== 'openai' || input.directBase !== 'https://api.openai.com/v1'
    || input.errorCode !== 'model_provider_rate_limited'
    || input.env('FIRBO_ALLOW_LOCAL_FALLBACK') !== 'on') return false;
  try { return freeForOrganization(input.organizationId, input.env); }
  catch { return false; }
}
