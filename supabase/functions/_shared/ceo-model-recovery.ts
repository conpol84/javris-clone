/** FIRBO CEO local fallback eligibility.
 * This file is imported only by agent-chat, not by the immutable 19-file
 * agent-runner bundle. Never change the shared runner source manifest here.
 */
import { freeForOrganization, completeViaFree, type FreeCompletion } from './free-routing.ts';
import { GatewayError } from './gateway-routing.ts';
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


/** This never auto-retries an earlier failed request. It selects a local-only
 * provider before a NEW CEO turn and only after explicit server configuration.
 * Non-CEO agents, user BYOK models and members retain the previous route. */
export function ownerCeoLocalPrimaryEnabled(input: {
  organizationId: string; isCeo: boolean; isOwnerOrAdmin: boolean;
  isUserSession: boolean; hasOwnKey: boolean;
  agentModel: string | null | undefined; env: EnvReader;
}): boolean {
  if (!input.isCeo || !input.isOwnerOrAdmin || !input.isUserSession
    || input.hasOwnKey || (input.agentModel && input.agentModel !== 'auto')
    || input.env('FIRBO_CEO_LOCAL_ONLY_PRIMARY') !== 'on') return false;
  try { return freeForOrganization(input.organizationId, input.env); }
  catch { return false; }
}

/** Owner-only Ollama STANDBY, not default model selection.
 * The owner client may choose a local-only route for a NEW request after a
 * cloud failure. It cannot replay the prior request, pick a model or use BYOK.
 * The native API independently validates JWT, role, company and local-only.
 */
export function ownerCeoOllamaBackupEnabled(input: {
  requested: boolean; organizationId: string; isCeo: boolean;
  isOwnerOrAdmin: boolean; isUserSession: boolean; hasOwnKey: boolean;
  agentModel: string | null | undefined; env: EnvReader;
}): boolean {
  if (input.requested !== true
    || input.env('FIRBO_CEO_OLLAMA_BACKUP') !== 'on'
    || !input.isCeo || !input.isOwnerOrAdmin || !input.isUserSession
    || input.hasOwnKey || (input.agentModel && input.agentModel !== 'auto')) return false;
  try { return freeForOrganization(input.organizationId, input.env); }
  catch { return false; }
}

const FREE_ROUTE = 'https://api.firboai.app/v1/firbo/free/chat/completions';
const LOCAL_ONLY_ROUTE = 'https://api.firboai.app/v1/firbo/free/local/chat/completions';

/** Reuse the already-reviewed first-party free-route envelope/auth/bounds and
 * replace ONLY its fixed transport destination with the new native Ollama-only
 * endpoint. The original runner-shared free-routing.ts remains byte-identical.
 * Native FastAPI independently enforces owner + company ACL and no cloud route.
 */
export async function completeViaCeoLocalOnly(
  organizationId: string, authorization: string, requestId: string,
  messages: Array<{role:string;content:string}>,
  options: {signal?:AbortSignal; fetcher?:typeof fetch} = {},
): Promise<FreeCompletion> {
  const result = await completeViaFree(
    organizationId, authorization, requestId, messages,
    {
      signal: options.signal,
      fetcher: (url, init) => {
        if (String(url) !== FREE_ROUTE) throw new GatewayError('local_endpoint_drift');
        return (options.fetcher ?? fetch)(LOCAL_ONLY_ROUTE, init);
      },
    },
  );
  if (!/^ollama:qwen3:(1\.7b|4b|8b)$/.test(result.trace.reported_model)
    || result.trace.cost_basis !== 'self_hosted_no_metered_fee'
    || result.trace.provider_fee_usd !== 0) throw new GatewayError('local_contract_not_verified');
  return result;
}
