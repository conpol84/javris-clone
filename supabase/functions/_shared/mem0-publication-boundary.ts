/**
 * Default-disabled Mem0 publication/delete boundary.
 *
 * This module deliberately contains no Supabase client, RPC name, migration,
 * vector-store transport, or live consumer. A future server-only integration
 * must provide one atomic database callback that locks and re-reads the current
 * authoritative memory before publishing or deleting any index material.
 */

import {
  fingerprintMem0Payload,
  type Mem0PreparationReceipt,
} from './mem0-transport-accounting.ts';

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9:_./-]{0,159}$/;
const MAX_SOURCE_CHARS = 12_000;
const MAX_EXTRACTED_CHARS = 4_000;
const MAX_DIMENSIONS = 4_000;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export interface Mem0PublicationConfig {
  enabled: true;
  extractionModel: string;
  embeddingModel: string;
  dimensions: number;
}

export interface TrustedMem0PublicationContext {
  /** Must be constructed by a private server handler, never copied from model input. */
  trustedServer: true;
  databaseRole: 'service_role';
  organizationId: string;
  actorUserId: string;
  agentId: string;
  memoryId: string;
  expectedRevision: string;
  operationId: string;
}

export interface Mem0PublicationMaterial {
  memoryId: string;
  organizationId: string;
  agentId: string | null;
  memoryRevision: string;
  sourceText: string;
  extracted: string;
  vector: number[];
  receipts: Mem0PreparationReceipt[];
}

export interface Mem0AtomicPublicationCommand {
  operationId: string;
  organizationId: string;
  actorUserId: string;
  agentId: string;
  memoryId: string;
  expectedRevision: string;
  mode: 'publish-candidate' | 'delete-if-not-current';
  candidate: null | {
    agentId: string | null;
    sourceText: string;
    extracted: string;
    vector: number[];
    extractionRequestId: string;
    embeddingRequestId: string;
    extractionPayloadSha256: string;
    embeddingPayloadSha256: string;
    extractionModel: string;
    embeddingModel: string;
    dimensions: number;
  };
}

export type Mem0AtomicPublicationStatus =
  | 'published'
  | 'already_current'
  | 'deleted'
  | 'already_absent'
  | 'stale'
  | 'denied';

export interface Mem0AtomicPublicationResult {
  operationId: string;
  organizationId: string;
  memoryId: string;
  status: Mem0AtomicPublicationStatus;
  currentRevision: string | null;
  publicationRevision: string | null;
}

export interface Mem0PublicationStore {
  /**
   * Future implementation requirement: one service-only DB transaction/RPC.
   * It must lock and read the authoritative memory and publication identity,
   * enforce company/agent scope, compare current content-bound revision, then
   * upsert or delete atomically. It must never trust candidate prose as the
   * authoritative memory and must not expose EXECUTE to anon/authenticated.
   */
  applyAtomic(command: Mem0AtomicPublicationCommand): Promise<Mem0AtomicPublicationResult>;
}

export interface Mem0PublicationReceipt {
  operationId: string;
  memoryId: string;
  expectedRevision: string;
  status: 'published' | 'already_current' | 'deleted' | 'already_absent';
  publicationRevision: string | null;
}

export class Mem0PublicationError extends Error {
  readonly reconciliationRequired: boolean;
  readonly operationId?: string;

  constructor(code: string, reconciliationRequired = false, operationId?: string) {
    super(code);
    this.name = 'Mem0PublicationError';
    this.reconciliationRequired = reconciliationRequired;
    this.operationId = operationId;
  }
}

function validateConfig(value: unknown): Mem0PublicationConfig {
  if (!object(value) || value.enabled !== true
    || typeof value.extractionModel !== 'string' || !MODEL.test(value.extractionModel)
    || typeof value.embeddingModel !== 'string' || !MODEL.test(value.embeddingModel)
    || !Number.isSafeInteger(value.dimensions) || Number(value.dimensions) < 1
    || Number(value.dimensions) > MAX_DIMENSIONS) throw new Error('mem0_publication_disabled');
  return { enabled: true, extractionModel: value.extractionModel,
    embeddingModel: value.embeddingModel, dimensions: Number(value.dimensions) };
}

function validateContext(value: unknown): TrustedMem0PublicationContext {
  if (!object(value) || value.trustedServer !== true || value.databaseRole !== 'service_role'
    || typeof value.organizationId !== 'string' || !UUID.test(value.organizationId)
    || typeof value.actorUserId !== 'string' || !UUID.test(value.actorUserId)
    || typeof value.agentId !== 'string' || !UUID.test(value.agentId)
    || typeof value.memoryId !== 'string' || !UUID.test(value.memoryId)
    || typeof value.expectedRevision !== 'string' || !SHA256.test(value.expectedRevision)
    || typeof value.operationId !== 'string' || !UUID.test(value.operationId)) {
    throw new Error('mem0_publication_context_invalid');
  }
  return {
    trustedServer: true,
    databaseRole: 'service_role',
    organizationId: value.organizationId,
    actorUserId: value.actorUserId,
    agentId: value.agentId,
    memoryId: value.memoryId,
    expectedRevision: value.expectedRevision,
    operationId: value.operationId,
  };
}

function validateReceipt(value: unknown, kind: Mem0PreparationReceipt['kind']): Mem0PreparationReceipt {
  if (!object(value) || value.kind !== kind
    || typeof value.requestId !== 'string' || !UUID.test(value.requestId)
    || typeof value.payloadSha256 !== 'string' || !SHA256.test(value.payloadSha256)
    || (value.status !== 'settled' && value.status !== 'settled_overrun')
    || !Number.isFinite(value.costUsd) || Number(value.costUsd) < 0 || Number(value.costUsd) > 1_000) {
    throw new Error('mem0_publication_receipt_invalid');
  }
  return { kind, requestId: value.requestId, payloadSha256: value.payloadSha256,
    status: value.status, costUsd: Number(value.costUsd) };
}

async function validateMaterial(
  value: unknown,
  context: TrustedMem0PublicationContext,
  config: Mem0PublicationConfig,
): Promise<NonNullable<Mem0AtomicPublicationCommand['candidate']>> {
  if (!object(value) || value.memoryId !== context.memoryId
    || value.organizationId !== context.organizationId
    || (value.agentId !== null && value.agentId !== context.agentId)
    || value.memoryRevision !== context.expectedRevision
    || typeof value.sourceText !== 'string' || !value.sourceText.trim()
    || value.sourceText.length > MAX_SOURCE_CHARS
    || typeof value.extracted !== 'string' || !value.extracted.trim()
    || value.extracted.length > MAX_EXTRACTED_CHARS
    || !Array.isArray(value.vector) || value.vector.length !== config.dimensions
    || value.vector.some(item => !Number.isFinite(item) || Math.abs(Number(item)) > 1_000_000)
    || !Array.isArray(value.receipts) || value.receipts.length !== 2) {
    throw new Error('mem0_publication_material_invalid');
  }

  const byKind = new Map(value.receipts.map(receipt => [object(receipt) ? receipt.kind : null, receipt]));
  if (byKind.size !== 2) throw new Error('mem0_publication_receipt_invalid');
  const extraction = validateReceipt(byKind.get('memory-extraction'), 'memory-extraction');
  const embedding = validateReceipt(byKind.get('memory-embedding'), 'memory-embedding');
  if (extraction.requestId === embedding.requestId) throw new Error('mem0_publication_receipt_invalid');

  // Capture all primitive/material values before hashing across awaits. The
  // caller can retain and mutate its objects; those mutations must not redirect
  // the future atomic command to another tenant, revision, text or vector.
  const agentId = value.agentId;
  const sourceText = value.sourceText;
  const extracted = value.extracted;
  const vector = value.vector.map(Number);

  const extractionPayloadSha256 = await fingerprintMem0Payload({
    operation: 'memory-extraction', memoryId: context.memoryId,
    memoryRevision: context.expectedRevision, model: config.extractionModel,
    sourceText,
  });
  const embeddingPayloadSha256 = await fingerprintMem0Payload({
    operation: 'memory-embedding', memoryId: context.memoryId,
    memoryRevision: context.expectedRevision, model: config.embeddingModel,
    dimensions: config.dimensions, text: extracted,
  });
  if (extraction.payloadSha256 !== extractionPayloadSha256
    || embedding.payloadSha256 !== embeddingPayloadSha256) {
    throw new Error('mem0_publication_receipt_mismatch');
  }

  return {
    agentId,
    sourceText,
    extracted,
    vector,
    extractionRequestId: extraction.requestId,
    embeddingRequestId: embedding.requestId,
    extractionPayloadSha256,
    embeddingPayloadSha256,
    extractionModel: config.extractionModel,
    embeddingModel: config.embeddingModel,
    dimensions: config.dimensions,
  };
}

function validateResult(value: unknown, command: Mem0AtomicPublicationCommand): Mem0AtomicPublicationResult {
  if (!object(value) || value.operationId !== command.operationId
    || value.organizationId !== command.organizationId || value.memoryId !== command.memoryId
    || !['published', 'already_current', 'deleted', 'already_absent', 'stale', 'denied'].includes(String(value.status))
    || (value.currentRevision !== null && (typeof value.currentRevision !== 'string' || !SHA256.test(value.currentRevision)))
    || (value.publicationRevision !== null
      && (typeof value.publicationRevision !== 'string' || !SHA256.test(value.publicationRevision)))) {
    throw new Error('mem0_publication_result_invalid');
  }
  const result = value as unknown as Mem0AtomicPublicationResult;
  if ((result.status === 'published' || result.status === 'already_current')
    && (!command.candidate || result.currentRevision !== command.expectedRevision
      || result.publicationRevision !== command.expectedRevision)) {
    throw new Error('mem0_publication_result_invalid');
  }
  if ((result.status === 'deleted' || result.status === 'already_absent')
    && result.publicationRevision !== null) throw new Error('mem0_publication_result_invalid');
  if (result.status === 'stale' && result.currentRevision === command.expectedRevision) {
    throw new Error('mem0_publication_result_invalid');
  }
  return { ...result };
}

/**
 * Reconcile one prepared candidate, or one deletion intent, against the fresh
 * authoritative row inside a single future database transaction.
 *
 * A thrown store call or malformed response is reconciliation-required because
 * the atomic transaction may already have committed. This function never retries.
 */
export async function reconcileMem0Publication(
  contextValue: unknown,
  configValue: unknown,
  materialValue: unknown | null,
  store: Mem0PublicationStore,
): Promise<Mem0PublicationReceipt> {
  const context = validateContext(contextValue);
  const config = validateConfig(configValue);
  const candidate = materialValue === null ? null : await validateMaterial(materialValue, context, config);
  const command: Mem0AtomicPublicationCommand = {
    operationId: context.operationId,
    organizationId: context.organizationId,
    actorUserId: context.actorUserId,
    agentId: context.agentId,
    memoryId: context.memoryId,
    expectedRevision: context.expectedRevision,
    mode: candidate ? 'publish-candidate' : 'delete-if-not-current',
    candidate,
  };

  let raw: Mem0AtomicPublicationResult;
  try {
    raw = await store.applyAtomic(command);
  } catch {
    throw new Mem0PublicationError('mem0_publication_result_unknown', true, context.operationId);
  }

  let result: Mem0AtomicPublicationResult;
  try {
    result = validateResult(raw, command);
  } catch {
    throw new Mem0PublicationError('mem0_publication_result_unknown', true, context.operationId);
  }
  if (result.status === 'stale') {
    throw new Mem0PublicationError('mem0_publication_stale', false, context.operationId);
  }
  if (result.status === 'denied') {
    throw new Mem0PublicationError('mem0_publication_denied', false, context.operationId);
  }
  return {
    operationId: context.operationId,
    memoryId: context.memoryId,
    expectedRevision: context.expectedRevision,
    status: result.status,
    publicationRevision: result.publicationRevision,
  };
}
