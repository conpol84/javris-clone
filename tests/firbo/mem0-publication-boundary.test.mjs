import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Mem0PublicationError,
  reconcileMem0Publication,
} from '../../supabase/functions/_shared/mem0-publication-boundary.ts';
import { fingerprintMem0Payload } from '../../supabase/functions/_shared/mem0-transport-accounting.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const context = {
  trustedServer: true,
  databaseRole: 'service_role',
  organizationId: id(1),
  actorUserId: id(2),
  agentId: id(3),
  memoryId: id(4),
  expectedRevision: 'a'.repeat(64),
  operationId: id(5),
};
const config = {
  enabled: true,
  extractionModel: 'firbo-extract-1',
  embeddingModel: 'firbo-embed-384',
  dimensions: 3,
};

async function material(changes = {}) {
  const sourceText = changes.sourceText ?? 'The current owner-approved fact.';
  const extracted = changes.extracted ?? 'Fact: the current owner-approved fact.';
  const memoryId = changes.memoryId ?? context.memoryId;
  const memoryRevision = changes.memoryRevision ?? context.expectedRevision;
  const extractionPayloadSha256 = await fingerprintMem0Payload({
    operation: 'memory-extraction', memoryId, memoryRevision,
    model: config.extractionModel, sourceText,
  });
  const embeddingPayloadSha256 = await fingerprintMem0Payload({
    operation: 'memory-embedding', memoryId, memoryRevision,
    model: config.embeddingModel, dimensions: config.dimensions, text: extracted,
  });
  return {
    memoryId,
    organizationId: context.organizationId,
    agentId: null,
    memoryRevision,
    sourceText,
    extracted,
    vector: [0.1, 0.2, 0.3],
    receipts: [
      { kind: 'memory-extraction', requestId: id(10), payloadSha256: extractionPayloadSha256,
        status: 'settled', costUsd: 0.0002 },
      { kind: 'memory-embedding', requestId: id(11), payloadSha256: embeddingPayloadSha256,
        status: 'settled_overrun', costUsd: 0.0001 },
    ],
    ...changes,
  };
}

function fakeStore(handler) {
  const calls = [];
  return {
    calls,
    async applyAtomic(command) {
      calls.push(command);
      if (handler) return handler(command);
      return {
        operationId: command.operationId,
        organizationId: command.organizationId,
        memoryId: command.memoryId,
        status: 'published',
        currentRevision: command.expectedRevision,
        publicationRevision: command.expectedRevision,
      };
    },
  };
}

test('default-disabled or malformed configuration dispatches no database operation', async () => {
  for (const value of [null, {}, { ...config, enabled: false }, { ...config, dimensions: 0 }]) {
    const store = fakeStore();
    await assert.rejects(reconcileMem0Publication(context, value, await material(), store), /publication_disabled/);
    assert.equal(store.calls.length, 0);
  }
});

test('only trusted private service context may reach the atomic callback', async () => {
  const invalid = [
    { ...context, trustedServer: false },
    { ...context, databaseRole: 'authenticated' },
    { ...context, organizationId: id(9) + 'x' },
    { ...context, expectedRevision: '*' },
    { ...context, operationId: '*' },
  ];
  for (const value of invalid) {
    const store = fakeStore();
    await assert.rejects(reconcileMem0Publication(value, config, await material(), store), /context_invalid/);
    assert.equal(store.calls.length, 0);
  }
});

test('valid settled receipts are bound to exact source, extraction, models, revision and dimensions', async () => {
  const store = fakeStore();
  const receipt = await reconcileMem0Publication(context, config, await material(), store);
  assert.deepEqual(receipt, {
    operationId: context.operationId,
    memoryId: context.memoryId,
    expectedRevision: context.expectedRevision,
    status: 'published',
    publicationRevision: context.expectedRevision,
  });
  assert.equal(store.calls.length, 1);
  assert.equal(store.calls[0].mode, 'publish-candidate');
  assert.deepEqual(store.calls[0].candidate.vector, [0.1, 0.2, 0.3]);
  assert.equal(store.calls[0].candidate.extractionRequestId, id(10));
  assert.equal(store.calls[0].candidate.embeddingRequestId, id(11));
});

test('tampered source or extracted text cannot reuse settled transport receipts', async () => {
  for (const change of [{ sourceText: 'tampered' }, { extracted: 'tampered' }]) {
    const original = await material();
    const store = fakeStore();
    await assert.rejects(reconcileMem0Publication(context, config, { ...original, ...change }, store), /receipt_mismatch/);
    assert.equal(store.calls.length, 0);
  }
});

test('wrong company, agent, revision, vector or receipt identity fails before database dispatch', async () => {
  const original = await material();
  const invalid = [
    { ...original, organizationId: id(9) },
    { ...original, agentId: id(9) },
    { ...original, memoryRevision: 'b'.repeat(64) },
    { ...original, vector: [0.1] },
    { ...original, vector: [0.1, Infinity, 0.3] },
    { ...original, receipts: [original.receipts[0], { ...original.receipts[1], requestId: original.receipts[0].requestId }] },
    { ...original, receipts: [{ ...original.receipts[0], status: 'reserved' }, original.receipts[1]] },
  ];
  for (const value of invalid) {
    const store = fakeStore();
    await assert.rejects(reconcileMem0Publication(context, config, value, store), /material_invalid|receipt_invalid|receipt_mismatch/);
    assert.equal(store.calls.length, 0);
  }
});

test('duplicate publication is idempotent only when DB confirms the same current revision', async () => {
  const store = fakeStore(command => ({
    operationId: command.operationId,
    organizationId: command.organizationId,
    memoryId: command.memoryId,
    status: 'already_current',
    currentRevision: command.expectedRevision,
    publicationRevision: command.expectedRevision,
  }));
  assert.equal((await reconcileMem0Publication(context, config, await material(), store)).status, 'already_current');
  assert.equal(store.calls.length, 1);
});

test('authoritative deletion or expiry may atomically remove a prepared candidate', async () => {
  for (const status of ['deleted', 'already_absent']) {
    const store = fakeStore(command => ({
      operationId: command.operationId,
      organizationId: command.organizationId,
      memoryId: command.memoryId,
      status,
      currentRevision: null,
      publicationRevision: null,
    }));
    const receipt = await reconcileMem0Publication(context, config, await material(), store);
    assert.equal(receipt.status, status);
    assert.equal(receipt.publicationRevision, null);
  }
});

test('delete intent contains no candidate and still delegates the live-row decision atomically', async () => {
  const store = fakeStore(command => ({
    operationId: command.operationId,
    organizationId: command.organizationId,
    memoryId: command.memoryId,
    status: 'deleted',
    currentRevision: null,
    publicationRevision: null,
  }));
  const receipt = await reconcileMem0Publication(context, config, null, store);
  assert.equal(receipt.status, 'deleted');
  assert.equal(store.calls[0].mode, 'delete-if-not-current');
  assert.equal(store.calls[0].candidate, null);
});

test('correction race is stale and never represented as a successful publication', async () => {
  const store = fakeStore(command => ({
    operationId: command.operationId,
    organizationId: command.organizationId,
    memoryId: command.memoryId,
    status: 'stale',
    currentRevision: 'b'.repeat(64),
    publicationRevision: null,
  }));
  await assert.rejects(reconcileMem0Publication(context, config, await material(), store), error => {
    assert.ok(error instanceof Mem0PublicationError);
    assert.equal(error.message, 'mem0_publication_stale');
    assert.equal(error.reconciliationRequired, false);
    return true;
  });
  assert.equal(store.calls.length, 1);
});

test('DB authorization denial is terminal and not retried', async () => {
  const store = fakeStore(command => ({
    operationId: command.operationId,
    organizationId: command.organizationId,
    memoryId: command.memoryId,
    status: 'denied',
    currentRevision: null,
    publicationRevision: null,
  }));
  await assert.rejects(reconcileMem0Publication(context, config, await material(), store), error =>
    error instanceof Mem0PublicationError && error.message === 'mem0_publication_denied'
      && error.reconciliationRequired === false);
  assert.equal(store.calls.length, 1);
});

test('lost DB response is reconciliation-required and the atomic callback runs once', async () => {
  let calls = 0;
  const store = fakeStore(() => { calls++; throw new Error('connection_lost'); });
  await assert.rejects(reconcileMem0Publication(context, config, await material(), store), error => {
    assert.ok(error instanceof Mem0PublicationError);
    assert.equal(error.message, 'mem0_publication_result_unknown');
    assert.equal(error.reconciliationRequired, true);
    assert.equal(error.operationId, context.operationId);
    return true;
  });
  assert.equal(calls, 1);
});

test('malformed or mismatched DB receipt is ambiguous because commit may have occurred', async () => {
  const values = [
    null,
    {},
    { operationId: id(99), organizationId: context.organizationId, memoryId: context.memoryId,
      status: 'published', currentRevision: context.expectedRevision, publicationRevision: context.expectedRevision },
    { operationId: context.operationId, organizationId: context.organizationId, memoryId: context.memoryId,
      status: 'published', currentRevision: 'b'.repeat(64), publicationRevision: context.expectedRevision },
    { operationId: context.operationId, organizationId: context.organizationId, memoryId: context.memoryId,
      status: 'deleted', currentRevision: null, publicationRevision: context.expectedRevision },
  ];
  for (const value of values) {
    const store = fakeStore(() => value);
    await assert.rejects(reconcileMem0Publication(context, config, await material(), store), error =>
      error instanceof Mem0PublicationError && error.reconciliationRequired === true);
    assert.equal(store.calls.length, 1);
  }
});

test('scope and candidate are snapshotted before the asynchronous atomic call', async () => {
  const mutableContext = structuredClone(context);
  const mutableMaterial = await material();
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const store = fakeStore(async command => {
    await wait;
    assert.equal(command.organizationId, context.organizationId);
    assert.equal(command.memoryId, context.memoryId);
    assert.equal(command.candidate.sourceText, 'The current owner-approved fact.');
    assert.deepEqual(command.candidate.vector, [0.1, 0.2, 0.3]);
    return {
      operationId: command.operationId,
      organizationId: command.organizationId,
      memoryId: command.memoryId,
      status: 'published',
      currentRevision: command.expectedRevision,
      publicationRevision: command.expectedRevision,
    };
  });
  const pending = reconcileMem0Publication(mutableContext, config, mutableMaterial, store);
  await new Promise(resolve => setImmediate(resolve));
  mutableContext.organizationId = id(99);
  mutableMaterial.sourceText = 'redirected';
  mutableMaterial.vector[0] = 99;
  release();
  assert.equal((await pending).status, 'published');
});

test('oversized prose, vectors and costs are rejected before atomic publication', async () => {
  const original = await material();
  const invalid = [
    { ...original, sourceText: 'x'.repeat(12001) },
    { ...original, extracted: 'x'.repeat(4001) },
    { ...original, vector: [0.1, 0.2, 1_000_001] },
    { ...original, receipts: [{ ...original.receipts[0], costUsd: 1001 }, original.receipts[1]] },
  ];
  for (const value of invalid) {
    const store = fakeStore();
    await assert.rejects(reconcileMem0Publication(context, config, value, store), /material_invalid|receipt_invalid/);
    assert.equal(store.calls.length, 0);
  }
});
