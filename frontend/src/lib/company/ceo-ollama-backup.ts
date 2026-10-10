/** CEO fallback is a *new-turn* choice after cloud failures, never replay.
 * Stores no prompts, keys, model response bodies or cross-tenant state.
 * The server independently authorizes the local-only route; this is only UX.
 */
const WINDOW_MS = 4 * 60_000;
const active = new Map<string, number>();
const ALLOWED_REASONS = new Set([
  'model_error', 'gateway_error', 'gateway_transport_error',
  'gateway_timeout_or_cancelled', 'gateway_http_429',
  'gateway_http_502', 'gateway_http_503', 'gateway_http_504',
  'model_provider_unavailable', 'model_provider_rate_limited',
  'desktop_model_rate_limited',
]);

function scope(org: string, user: string, agent: string): string | null {
  if (![org, user, agent].every(s => typeof s === 'string' && s.length > 0 && s.length <= 128)) return null;
  return JSON.stringify([org, user, agent]);
}

/** A definite *frontend error*, not a proof the previous provider did no work.
 * It influences only the NEXT, fresh, user-initiated request with a new ID. */
export function observeCeoCloudFailure(
  org: string, user: string, agent: string, code: string, reason?: string,
  now = Date.now(),
): boolean {
  const id = scope(org, user, agent);
  if (!id || !Number.isFinite(now) || code !== 'model_error'
    || !ALLOWED_REASONS.has(reason ?? 'model_error')) return false;
  if (active.size >= 512) {
    for (const [key, expiry] of active) if (expiry <= now) active.delete(key);
    if (active.size >= 512) active.delete(active.keys().next().value!);
  }
  active.set(id, now + WINDOW_MS);
  return true;
}

/** Automatically goes back to normal OmniRoute after the bounded cooldown. */
export function preferCeoLocalBackup(
  org: string, user: string, agent: string, now = Date.now(),
): boolean {
  const id = scope(org, user, agent);
  if (!id || !Number.isFinite(now)) return false;
  const until = active.get(id);
  if (!until) return false;
  if (until <= now) { active.delete(id); return false; }
  return true;
}

export function clearCeoLocalBackup(org: string, user: string, agent: string): void {
  const id = scope(org, user, agent);
  if (id) active.delete(id);
}
