/** Shared text-inference gateway used by Firbo chat and tasks.
 * Server-only. Defaults to legacy routing; no secrets/settings are changed by import.
 * A selected gateway route makes ONE request to OmniRoute. Provider fallback is
 * owned by its combo, never a silent direct-provider retry in Firbo.
 */
export type EnvReader = (name: string) => string | undefined;
export interface GatewayPlan {
  readonly mode: 'canary' | 'gateway';
  readonly base: string;
  readonly key: string;
  readonly model: string;
  readonly priceIn: number;
  readonly priceOut: number;
}
export interface GatewayTrace {
  request_id: string;
  mode: 'canary' | 'gateway';
  route: 'omniroute';
  requested_model: string;
  reported_model: string | null;
  status: 'succeeded' | 'failed';
  error: string | null;
  elapsed_ms: number;
  application_attempts: 0 | 1;
  gateway_fallback: 'unverified';
  usage_reported: boolean;
  cost_basis: 'configured_estimate';
}
export interface GatewayCompletion {
  completion: { choices: [{ message: { content: string } }]; usage: { prompt_tokens: number; completion_tokens: number } };
  cost: number;
  trace: GatewayTrace;
}
export class GatewayError extends Error {
  readonly code: string;
  readonly trace?: GatewayTrace;
  constructor(code: string, trace?: GatewayTrace) {
    super(code);
    this.name = 'GatewayError';
    this.code = code;
    this.trace = trace;
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/;
const list = (value: string | undefined) => (value ?? '').split(',').map(s => s.trim()).filter(Boolean);

/** Pass ONLY an agent already loaded with a verified organization/role check. */
export function gatewayForAgent(agent: { id: string; model?: string | null }, env: EnvReader, options: { force?: boolean } = {}): GatewayPlan | null {
  const mode = options.force ? 'gateway' : env('FIRBO_TEXT_ROUTING_MODE') ?? 'legacy';
  if (mode === 'legacy') return null;
  if (mode !== 'canary' && mode !== 'gateway') throw new GatewayError('invalid_routing_mode');
  if (!UUID.test(agent.id)) throw new GatewayError('invalid_agent_id');
  if (mode === 'canary') {
    const agents = list(env('FIRBO_GATEWAY_CANARY_AGENTS'));
    if (agents.length > 100 || agents.some(id => !UUID.test(id))) throw new GatewayError('invalid_canary_agents');
    if (!agents.map(id => id.toLowerCase()).includes(agent.id.toLowerCase())) return null;
  }
  const allowed = list(env('FIRBO_GATEWAY_ALLOWED_MODELS') ?? 'firbo-economy,firbo-quality');
  if (!allowed.length || allowed.length > 100 || allowed.some(m => !MODEL.test(m) || m.includes('://'))) {
    throw new GatewayError('invalid_gateway_allowlist');
  }
  const selected = agent.model?.trim() || 'auto';
  // Never reinterpret a direct-provider preference as some other model silently.
  const model = selected === 'auto' ? env('FIRBO_GATEWAY_DEFAULT_MODEL') ?? 'firbo-economy'
    : selected.startsWith('omniroute:') ? selected.slice('omniroute:'.length) : '';
  // A forced (plan-based) route may use its own admin-chosen combo; every other route must be on the allowlist.
  if (!model || !(allowed.includes(model) || (options.force && MODEL.test(model) && !model.includes('://')))) throw new GatewayError('gateway_model_not_allowed');
  let endpoint: URL;
  try {
    endpoint = new URL(env('OMNIROUTE_BASE_URL') ?? '');
    const origin = new URL(env('FIRBO_GATEWAY_ORIGIN') ?? 'https://gateway.firboai.app');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') throw new Error();
    if (endpoint.protocol !== 'https:' || endpoint.origin !== origin.origin || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['/', '/v1', '/v1/'].includes(endpoint.pathname)) throw new Error();
  } catch {
    throw new GatewayError('invalid_gateway_endpoint');
  }
  const key = env('OMNIROUTE_API_KEY')?.trim();
  if (!key || /[\r\n]/.test(key)) throw new GatewayError('gateway_key_missing');
  const managementKey = env('OMNIROUTE_MANAGEMENT_KEY')?.trim();
  if (managementKey && key === managementKey) throw new GatewayError('gateway_inference_key_required');
  const rate = (name: string): number => {
    const raw = env(name)?.trim();
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0 || n > 1_000_000) throw new GatewayError('gateway_cost_rates_required');
    return n;
  };
  const plan = { mode, base: endpoint.origin + '/v1', key, model,
    priceIn: rate('OMNIROUTE_PRICE_IN_PER_M'), priceOut: rate('OMNIROUTE_PRICE_OUT_PER_M') } as GatewayPlan;
  // An accidental JSON log of the plan must not reveal the inference key.
  Object.defineProperty(plan, 'key', { value: key, enumerable: false });
  Object.defineProperty(plan, 'toJSON', { value: () => ({ mode, model, key: '[redacted]' }), enumerable: false });
  return Object.freeze(plan);
}

/**
 * Plan rule, opt-in (FIRBO_FREE_PLAN_ROUTING=gateway): companies on the Free plan always use the admin-managed
 * free combo (FIRBO_FREE_PLAN_MODEL, default "firbo-free"), whatever their agents' model setting says.
 * Every other plan keeps the normal routing. With the switch off nothing changes.
 */
export function gatewayForOrgPlan(agent: { id: string; model?: string | null }, orgPlan: string | null | undefined, env: EnvReader): GatewayPlan | null {
  if (orgPlan !== 'free' || (env('FIRBO_FREE_PLAN_ROUTING') ?? 'off') !== 'gateway') return gatewayForAgent(agent, env);
  const model = env('FIRBO_FREE_PLAN_MODEL')?.trim() || 'firbo-free';
  return gatewayForAgent({ ...agent, model: 'omniroute:' + model }, env, { force: true });
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new GatewayError('gateway_timeout_or_cancelled'));
  return new Promise((resolve, reject) => {
    const aborted = () => { signal.removeEventListener('abort', aborted); reject(new GatewayError('gateway_timeout_or_cancelled')); };
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(value => { signal.removeEventListener('abort', aborted); resolve(value); },
      error => { signal.removeEventListener('abort', aborted); reject(error); });
  });
}

export async function boundedGatewayJson(response: Response, signal: AbortSignal, limit = 1_000_000): Promise<unknown> {
  if (!response.body) throw new GatewayError('gateway_invalid_response');
  const reader = response.body.getReader();
  let total = 0;
  const chunks: Uint8Array[] = [];
  let completed = false;
  try {
    while (true) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) { completed = true; break; }
      total += value.byteLength;
      if (total > limit) throw new GatewayError('gateway_response_too_large');
      chunks.push(value);
    }
    const all = new Uint8Array(total);
    let offset = 0;
    for (const part of chunks) { all.set(part, offset); offset += part.byteLength; }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(all)); }
    catch { throw new GatewayError('gateway_invalid_json'); }
  } finally {
    if (!completed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type Message = { role: string; content: string };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const tokens = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 && n <= 1_000_000_000;

export async function completeViaGateway(plan: GatewayPlan, messages: Message[], temperature: number,
  options: { fetcher?: typeof fetch; signal?: AbortSignal; timeoutMs?: number; maxTokens?: number } = {}): Promise<GatewayCompletion> {
  const started = Date.now();
  const trace: GatewayTrace = {
    request_id: crypto.randomUUID(), mode: plan.mode, route: 'omniroute', requested_model: plan.model,
    reported_model: null, status: 'failed', error: null, elapsed_ms: 0, application_attempts: 0,
    gateway_fallback: 'unverified', usage_reported: false, cost_basis: 'configured_estimate',
  };
  const invalid = (code: string): never => { trace.error = code; throw new GatewayError(code, trace); };
  if (!messages.length || messages.length > 64 || messages.some(m => !['system','user','assistant'].includes(m.role) || typeof m.content !== 'string')) {
    invalid('invalid_gateway_messages');
  }
  const maxTokens = options.maxTokens ?? 1800;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 8000 || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    invalid('invalid_gateway_parameters');
  }
  const body = JSON.stringify({ model: plan.model, messages, max_tokens: maxTokens, temperature, stream: false });
  if (new TextEncoder().encode(body).byteLength > 256_000) invalid('gateway_request_too_large');
  const duration = options.timeoutMs ?? 90_000;
  if (!Number.isFinite(duration) || duration < 1 || duration > 90_000) invalid('invalid_gateway_timeout');
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timer = setTimeout(onAbort, duration);
  let response: Response | undefined;
  try {
    if (controller.signal.aborted) throw new GatewayError('gateway_timeout_or_cancelled');
    trace.application_attempts = 1;
    response = await withAbort((options.fetcher ?? fetch)(plan.base + '/chat/completions', {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${plan.key}`, 'x-request-id': trace.request_id }, body,
    }), controller.signal);
    if (!response.ok) throw new GatewayError(`gateway_http_${response.status}`);
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) throw new GatewayError('gateway_invalid_content_type');
    const data = await boundedGatewayJson(response, controller.signal);
    if (!record(data) || !Array.isArray(data.choices) || !record(data.choices[0]) || !record(data.choices[0].message)) throw new GatewayError('gateway_invalid_response');
    const content = data.choices[0].message.content;
    if (typeof content !== 'string' || !content.trim()) throw new GatewayError('gateway_empty_response');
    // Do not silently turn missing usage into a verified zero-cost completion.
    if (!record(data.usage) || !tokens(data.usage.prompt_tokens) || !tokens(data.usage.completion_tokens)) throw new GatewayError('gateway_usage_missing');
    if (typeof data.model === 'string' && MODEL.test(data.model) && !data.model.includes('://')) trace.reported_model = data.model;
    trace.status = 'succeeded';
    trace.usage_reported = true;
    trace.elapsed_ms = Date.now() - started;
    const cost = Math.round((data.usage.prompt_tokens * plan.priceIn + data.usage.completion_tokens * plan.priceOut)) / 1_000_000;
    return { completion: { choices: [{ message: { content } }], usage: { prompt_tokens: data.usage.prompt_tokens, completion_tokens: data.usage.completion_tokens } }, cost, trace };
  } catch (error) {
    // Never propagate raw fetch/provider exceptions, which may contain a URL, credential or prompt.
    trace.error = controller.signal.aborted ? 'gateway_timeout_or_cancelled' : error instanceof GatewayError ? error.code : 'gateway_transport_error';
    trace.elapsed_ms = Date.now() - started;
    throw new GatewayError(trace.error, trace);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
    if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    controller.abort();
  }
}
