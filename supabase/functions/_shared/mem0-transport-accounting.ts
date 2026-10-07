/**
 * Default-disabled Mem0 preparation boundary.
 *
 * This module does not install Mem0, choose a provider, write a vector store or
 * call the FIRBO database.  A future server integration must supply an
 * authorized durable ledger and two explicit transports.  Extraction and
 * embedding are different billable attempts with different request identities.
 */

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const ROUTE = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,119}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,159}$/;
const MAX_SOURCE_CHARS = 12_000;
const MAX_EXTRACTED_CHARS = 4_000;
const MAX_PRICE_AGE_MS = 31 * 24 * 60 * 60 * 1_000;
const enc = new TextEncoder();

export type Mem0AttemptKind = 'memory-extraction' | 'memory-embedding';

export interface VerifiedPrice {
  usdPerMillionInputTokens: number;
  usdPerMillionOutputTokens: number;
  source: string;
  verifiedAt: string;
}

export interface Mem0Route {
  route: string;
  model: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  price: VerifiedPrice;
}

export interface Mem0TransportConfig {
  enabled: true;
  extraction: Mem0Route;
  embedding: Mem0Route & { dimensions: number };
}

export interface Mem0Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface Mem0LedgerReservation {
  requestId: string;
  duplicate: boolean;
}

export interface Mem0Ledger {
  reserve(args: {
    kind: Mem0AttemptKind;
    organizationId: string;
    actorUserId: string;
    agentId: string;
    requestKey: string;
    payloadSha256: string;
    route: string;
    model: string;
    inputTokenCap: number;
    outputTokenCap: number;
    reservedUsd: number;
  }): Promise<Mem0LedgerReservation>;
  beginDispatch(args: {
    requestId: string;
    kind: Mem0AttemptKind;
    payloadSha256: string;
  }): Promise<{ allowed: boolean }>;
  settle(args: {
    requestId: string;
    kind: Mem0AttemptKind;
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
    latencyMs: number;
  }): Promise<'settled' | 'settled_overrun'>;
  markAmbiguous(args: { requestId: string; kind: Mem0AttemptKind; reason: string }): Promise<void>;
}

export interface Mem0PreparationReceipt {
  kind: Mem0AttemptKind;
  requestId: string;
  payloadSha256: string;
  status: 'settled' | 'settled_overrun';
  costUsd: number;
}

export class Mem0AttemptError extends Error {
  readonly kind: Mem0AttemptKind;
  readonly reconciliationRequired: boolean;
  readonly requestId?: string;

  constructor(code: string, kind: Mem0AttemptKind, reconciliationRequired = false, requestId?: string) {
    super(code);
    this.name = 'Mem0AttemptError';
    this.kind = kind;
    this.reconciliationRequired = reconciliationRequired;
    this.requestId = requestId;
  }
}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('mem0_payload_invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!object(value)) throw new Error('mem0_payload_invalid');
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function fingerprintMem0Payload(payload: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(canonicalJson(payload)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function routeChecked(route: Mem0Route, now: number, embedding: boolean): Mem0Route {
  if (!object(route) || !ROUTE.test(route.route) || !MODEL.test(route.model)
    || !Number.isSafeInteger(route.maxInputTokens) || route.maxInputTokens < 1 || route.maxInputTokens > 1_000_000
    || !Number.isSafeInteger(route.maxOutputTokens) || route.maxOutputTokens < (embedding ? 0 : 1)
    || route.maxOutputTokens > (embedding ? 0 : 100_000)
    || !object(route.price)) throw new Error('mem0_route_invalid');
  const price = route.price;
  const verifiedAt = timestamp(price.verifiedAt);
  if (!Number.isFinite(price.usdPerMillionInputTokens) || price.usdPerMillionInputTokens < 0
    || price.usdPerMillionInputTokens > 1_000_000
    || !Number.isFinite(price.usdPerMillionOutputTokens) || price.usdPerMillionOutputTokens < 0
    || price.usdPerMillionOutputTokens > 1_000_000
    || typeof price.source !== 'string' || !/^https:\/\/.{1,1000}$/.test(price.source)
    || !Number.isFinite(verifiedAt) || verifiedAt > now || now - verifiedAt > MAX_PRICE_AGE_MS) {
    throw new Error('mem0_price_unverified');
  }
  return { ...route, price: { ...price } };
}

export function validateMem0TransportConfig(config: unknown, now = Date.now()): Mem0TransportConfig {
  if (!object(config) || config.enabled !== true || !Number.isFinite(now)) throw new Error('mem0_disabled');
  const extraction = routeChecked(config.extraction as Mem0Route, now, false);
  const embedding = routeChecked(config.embedding as Mem0Route, now, true) as Mem0Route & { dimensions?: number };
  const dimensions = (config.embedding as { dimensions?: unknown }).dimensions;
  if (!Number.isSafeInteger(dimensions) || Number(dimensions) < 1 || Number(dimensions) > 4_000) {
    throw new Error('mem0_dimensions_invalid');
  }
  return { enabled: true, extraction, embedding: { ...embedding, dimensions: Number(dimensions) } };
}

function tokenCap(text: string): number {
  // Conservative bound: no tokenizer can bill more input tokens than UTF-8 bytes
  // for the reviewed text-only routes accepted by this contract.
  return enc.encode(text).byteLength;
}

function roundedCost(inputTokens: number, outputTokens: number, price: VerifiedPrice): number {
  const cost = (inputTokens * price.usdPerMillionInputTokens
    + outputTokens * price.usdPerMillionOutputTokens) / 1_000_000;
  const rounded = Math.ceil(cost * 1_000_000) / 1_000_000;
  if (!Number.isFinite(rounded) || rounded < 0 || rounded > 1_000) throw new Error('mem0_cost_invalid');
  return rounded;
}

export function maximumMem0AttemptCost(route: Mem0Route, inputTokenCap: number): number {
  if (!Number.isSafeInteger(inputTokenCap) || inputTokenCap < 1 || inputTokenCap > route.maxInputTokens) {
    throw new Error('mem0_input_bound_invalid');
  }
  return roundedCost(inputTokenCap, route.maxOutputTokens, route.price);
}

function usageChecked(usage: unknown, route: Mem0Route): Mem0Usage & { costUsd: number } {
  if (!object(usage) || usage.model !== route.model
    || !Number.isSafeInteger(usage.inputTokens) || Number(usage.inputTokens) < 0 || Number(usage.inputTokens) > route.maxInputTokens
    || !Number.isSafeInteger(usage.outputTokens) || Number(usage.outputTokens) < 0 || Number(usage.outputTokens) > route.maxOutputTokens
    || !Number.isSafeInteger(usage.latencyMs) || Number(usage.latencyMs) < 0 || Number(usage.latencyMs) > 3_600_000) {
    throw new Error('mem0_usage_invalid');
  }
  return { model: route.model, inputTokens: Number(usage.inputTokens), outputTokens: Number(usage.outputTokens),
    latencyMs: Number(usage.latencyMs), costUsd: roundedCost(Number(usage.inputTokens), Number(usage.outputTokens), route.price) };
}

function contextChecked(context: unknown) {
  if (!object(context) || typeof context.organizationId !== 'string' || !UUID.test(context.organizationId)
    || typeof context.actorUserId !== 'string' || !UUID.test(context.actorUserId)
    || typeof context.agentId !== 'string' || !UUID.test(context.agentId)
    || typeof context.memoryId !== 'string' || !UUID.test(context.memoryId)
    || typeof context.memoryRevision !== 'string' || !SHA256.test(context.memoryRevision)
    || typeof context.extractionRequestKey !== 'string' || !UUID.test(context.extractionRequestKey)
    || typeof context.embeddingRequestKey !== 'string' || !UUID.test(context.embeddingRequestKey)
    || context.extractionRequestKey === context.embeddingRequestKey
    || typeof context.sourceText !== 'string' || !context.sourceText.trim()
    || context.sourceText.length > MAX_SOURCE_CHARS) throw new Error('mem0_context_invalid');
  return {
    organizationId: context.organizationId, actorUserId: context.actorUserId,
    agentId: context.agentId, memoryId: context.memoryId, memoryRevision: context.memoryRevision,
    extractionRequestKey: context.extractionRequestKey, embeddingRequestKey: context.embeddingRequestKey,
    sourceText: context.sourceText,
  };
}

async function markAmbiguousBestEffort(ledger: Mem0Ledger, args: {
  requestId: string; kind: Mem0AttemptKind; reason: string;
}): Promise<void> {
  try {
    await ledger.markAmbiguous(args);
  } catch {
    // The caller still receives reconciliationRequired=true. Do not retry the
    // transport merely because the reconciliation marker could not be saved.
    console.error(JSON.stringify({ event: 'firbo_mem0_reconciliation_marker_failed',
      request_id: args.requestId, kind: args.kind }));
  }
}

async function accountedAttempt<T>(ledger: Mem0Ledger, kind: Mem0AttemptKind, route: Mem0Route,
  common: ReturnType<typeof contextChecked>, requestKey: string, payload: unknown, inputCap: number,
  transport: (context: { requestId: string; payloadSha256: string }) => Promise<{ value: T; usage: Mem0Usage }>) {
  const payloadSha256 = await fingerprintMem0Payload(payload);
  const reservedUsd = maximumMem0AttemptCost(route, inputCap);
  let reservation: Mem0LedgerReservation;
  try {
    reservation = await ledger.reserve({ kind, organizationId: common.organizationId, actorUserId: common.actorUserId,
      agentId: common.agentId, requestKey, payloadSha256, route: route.route, model: route.model,
      inputTokenCap: inputCap, outputTokenCap: route.maxOutputTokens, reservedUsd });
  } catch (error) {
    throw new Mem0AttemptError(error instanceof Error ? error.message : 'budget_unavailable', kind);
  }
  if (!UUID.test(reservation.requestId) || reservation.duplicate) {
    throw new Mem0AttemptError('request_in_progress', kind, false, UUID.test(reservation.requestId) ? reservation.requestId : undefined);
  }
  let dispatch: { allowed: boolean };
  try {
    dispatch = await ledger.beginDispatch({ requestId: reservation.requestId, kind, payloadSha256 });
  } catch {
    throw new Mem0AttemptError('dispatch_unavailable', kind, true, reservation.requestId);
  }
  if (dispatch.allowed !== true) throw new Mem0AttemptError('request_in_progress', kind, true, reservation.requestId);

  let completed: Awaited<ReturnType<typeof transport>>;
  try {
    completed = await transport({ requestId: reservation.requestId, payloadSha256 });
  } catch (error) {
    const reason = error instanceof Error && /^[a-z0-9_]{1,80}$/.test(error.message)
      ? error.message : 'provider_result_unknown';
    await markAmbiguousBestEffort(ledger, { requestId: reservation.requestId, kind, reason });
    throw new Mem0AttemptError(reason, kind, true, reservation.requestId);
  }

  let usage: Mem0Usage & { costUsd: number };
  try {
    usage = usageChecked(completed.usage, route);
  } catch {
    await markAmbiguousBestEffort(ledger, { requestId: reservation.requestId, kind, reason: 'provider_usage_invalid' });
    throw new Mem0AttemptError('provider_usage_invalid', kind, true, reservation.requestId);
  }
  try {
    const status = await ledger.settle({ requestId: reservation.requestId, kind, ...usage });
    if (status !== 'settled' && status !== 'settled_overrun') throw new Error('settlement_result_invalid');
    return { value: completed.value, receipt: { kind, requestId: reservation.requestId, payloadSha256,
      status, costUsd: usage.costUsd } satisfies Mem0PreparationReceipt };
  } catch {
    await markAmbiguousBestEffort(ledger, { requestId: reservation.requestId, kind, reason: 'settlement_result_unknown' });
    throw new Mem0AttemptError('usage_save_failed', kind, true, reservation.requestId);
  }
}

/**
 * Prepare one authoritative memory for a future index write.  Publication is
 * deliberately absent: the caller must re-read the authoritative revision and
 * apply a separately reviewed atomic publication policy after both receipts.
 */
export async function prepareMem0IndexMaterial(context: unknown, configValue: unknown, ledger: Mem0Ledger, transports: {
  extract(context: { requestId: string; payloadSha256: string; sourceText: string }): Promise<{ value: string; usage: Mem0Usage }>;
  embed(context: { requestId: string; payloadSha256: string; text: string }): Promise<{ value: number[]; usage: Mem0Usage }>;
}, now = Date.now()): Promise<{ extracted: string; vector: number[]; dimensions: number; receipts: Mem0PreparationReceipt[] }> {
  const common = contextChecked(context);
  const config = validateMem0TransportConfig(configValue, now);
  const extractionPayload = { operation: 'memory-extraction', memoryId: common.memoryId,
    memoryRevision: common.memoryRevision, model: config.extraction.model, sourceText: common.sourceText };
  const extraction = await accountedAttempt(ledger, 'memory-extraction', config.extraction, common,
    common.extractionRequestKey, extractionPayload, tokenCap(common.sourceText),
    c => transports.extract({ ...c, sourceText: common.sourceText }));
  if (typeof extraction.value !== 'string' || !extraction.value.trim() || extraction.value.length > MAX_EXTRACTED_CHARS) {
    // The provider call is already settled. Invalid content is not published and
    // must not trigger the second paid attempt.
    throw new Mem0AttemptError('extraction_result_invalid', 'memory-extraction');
  }
  const extracted = extraction.value;
  const embeddingPayload = { operation: 'memory-embedding', memoryId: common.memoryId,
    memoryRevision: common.memoryRevision, model: config.embedding.model, dimensions: config.embedding.dimensions, text: extracted };
  const embedding = await accountedAttempt(ledger, 'memory-embedding', config.embedding, common,
    common.embeddingRequestKey, embeddingPayload, tokenCap(extracted),
    c => transports.embed({ ...c, text: extracted }));
  if (!Array.isArray(embedding.value) || embedding.value.length !== config.embedding.dimensions
    || embedding.value.some(value => !Number.isFinite(value))) {
    throw new Mem0AttemptError('embedding_result_invalid', 'memory-embedding');
  }
  return { extracted, vector: [...embedding.value], dimensions: config.embedding.dimensions,
    receipts: [extraction.receipt, embedding.receipt] };
}
