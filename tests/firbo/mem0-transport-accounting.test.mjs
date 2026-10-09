import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fingerprintMem0Payload,
  maximumMem0AttemptCost,
  Mem0AttemptError,
  prepareMem0IndexMaterial,
  validateMem0TransportConfig,
} from '../../supabase/functions/_shared/mem0-transport-accounting.ts';

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-07T17:30:00Z');
const config = {
  enabled: true,
  extraction: { route: 'selfhosted:extract/v1', model: 'firbo-extract-1', maxInputTokens: 20_000, maxOutputTokens: 512,
    price: { usdPerMillionInputTokens: 2, usdPerMillionOutputTokens: 8,
      source: 'https://billing.example.test/extraction', verifiedAt: '2026-10-07T17:00:00Z' } },
  embedding: { route: 'selfhosted:embed/v1', model: 'firbo-embed-384', maxInputTokens: 8_000, maxOutputTokens: 0, dimensions: 384,
    price: { usdPerMillionInputTokens: 0.1, usdPerMillionOutputTokens: 0,
      source: 'https://billing.example.test/embedding', verifiedAt: '2026-10-07T17:00:00Z' } },
};
const context = { organizationId: id(1), actorUserId: id(2), agentId: id(3), memoryId: id(4),
  memoryRevision: 'a'.repeat(64), extractionRequestKey: id(5), embeddingRequestKey: id(6),
  sourceText: 'The owner-approved policy is version 7.' };

function fakeLedger(options = {}) {
  const calls = [];
  let n = 20;
  return {
    calls,
    async reserve(args) {
      calls.push(['reserve', args]);
      if (options.reserveError) throw new Error(options.reserveError);
      return { requestId: id(n++), duplicate: options.duplicate === true };
    },
    async beginDispatch(args) {
      calls.push(['begin', args]);
      if (options.beginError) throw new Error('db_down');
      return { allowed: options.dispatchAllowed !== false };
    },
    async settle(args) {
      calls.push(['settle', args]);
      if (options.settleError) throw new Error('db_down');
      if (options.invalidSettlement) return 'released';
      return options.overrun ? 'settled_overrun' : 'settled';
    },
    async markAmbiguous(args) {
      calls.push(['ambiguous', args]);
      if (options.ambiguousError) throw new Error('db_down');
    },
  };
}

const transports = (changes = {}) => ({
  async extract({ requestId, payloadSha256, sourceText }) {
    changes.onExtract?.();
    return { value: `Fact: ${sourceText}`, usage: { model: config.extraction.model,
      inputTokens: 10, outputTokens: 5, latencyMs: 20 }, requestId, payloadSha256 };
  },
  async embed({ text }) {
    changes.onEmbed?.();
    return { value: Array(384).fill(0.125), usage: { model: config.embedding.model,
      inputTokens: 8, outputTokens: 0, latencyMs: 15 }, text };
  },
  ...changes,
});

test('default/malformed configuration fails closed before ledger or transport', async () => {
  for (const value of [null, {}, { ...config, enabled: false }, { ...config, enabled: 'true' }]) {
    const ledger = fakeLedger(); let dispatches = 0;
    await assert.rejects(prepareMem0IndexMaterial(context, value, ledger, transports({ onExtract: () => dispatches++ }), now), /mem0_disabled/);
    assert.equal(dispatches, 0); assert.equal(ledger.calls.length, 0);
  }
});

test('pricing requires current HTTPS evidence; zero is accepted only as explicit reviewed configuration', () => {
  const bad = [
    { ...config, extraction: { ...config.extraction, price: { ...config.extraction.price, source: 'memory' } } },
    { ...config, extraction: { ...config.extraction, price: { ...config.extraction.price, verifiedAt: '2026-08-01T00:00:00Z' } } },
    { ...config, extraction: { ...config.extraction, price: { ...config.extraction.price, usdPerMillionInputTokens: -1 } } },
  ];
  for (const value of bad) assert.throws(() => validateMem0TransportConfig(value, now), /price_unverified/);
  const zero = structuredClone(config); zero.embedding.price.usdPerMillionInputTokens = 0;
  assert.equal(validateMem0TransportConfig(zero, now).embedding.price.usdPerMillionInputTokens, 0);
});

test('model capabilities, dimensions and token bounds are explicit and bounded', () => {
  for (const dimensions of [0, 4001, 1.5, NaN]) {
    assert.throws(() => validateMem0TransportConfig({ ...config, embedding: { ...config.embedding, dimensions } }, now), /dimensions_invalid/);
  }
  assert.throws(() => validateMem0TransportConfig({ ...config,
    embedding: { ...config.embedding, maxOutputTokens: 1 } }, now), /route_invalid/);
  assert.throws(() => maximumMem0AttemptCost(config.extraction, 20001), /input_bound_invalid/);
});

test('canonical fingerprints bind exact payload independent of object insertion order', async () => {
  assert.equal(await fingerprintMem0Payload({ b: 2, a: [1, true] }), await fingerprintMem0Payload({ a: [1, true], b: 2 }));
  assert.notEqual(await fingerprintMem0Payload({ a: 1 }), await fingerprintMem0Payload({ a: 2 }));
  await assert.rejects(fingerprintMem0Payload({ a: Infinity }), /payload_invalid/);
});

test('two successful operations use separate reservations, dispatches, settlements and receipts', async () => {
  const ledger = fakeLedger(); let extractionCalls = 0; let embeddingCalls = 0;
  const result = await prepareMem0IndexMaterial(context, config, ledger, transports({
    onExtract: () => extractionCalls++, onEmbed: () => embeddingCalls++,
  }), now);
  assert.equal(extractionCalls, 1); assert.equal(embeddingCalls, 1);
  assert.equal(result.extracted, `Fact: ${context.sourceText}`);
  assert.equal(result.vector.length, 384); assert.equal(result.receipts.length, 2);
  assert.deepEqual(result.receipts.map(r => r.kind), ['memory-extraction', 'memory-embedding']);
  assert.notEqual(result.receipts[0].requestId, result.receipts[1].requestId);
  assert.notEqual(result.receipts[0].payloadSha256, result.receipts[1].payloadSha256);
  assert.deepEqual(ledger.calls.map(c => c[0]), ['reserve','begin','settle','reserve','begin','settle']);
  assert.equal(ledger.calls[0][1].requestKey, context.extractionRequestKey);
  assert.equal(ledger.calls[3][1].requestKey, context.embeddingRequestKey);
  assert.equal(ledger.calls[2][1].costUsd, 0.00006);
  assert.equal(ledger.calls[5][1].costUsd, 0.000001);
});

test('failed admission and duplicate delivery dispatch zero provider calls', async () => {
  for (const options of [{ reserveError: 'budget_exceeded' }, { duplicate: true }]) {
    const ledger = fakeLedger(options); let dispatches = 0;
    await assert.rejects(prepareMem0IndexMaterial(context, config, ledger,
      transports({ onExtract: () => dispatches++ }), now), /budget_exceeded|request_in_progress/);
    assert.equal(dispatches, 0);
    assert.equal(ledger.calls.filter(c => c[0] === 'settle').length, 0);
  }
});

test('unknown dispatch state is reconciliation-required and never calls transport', async () => {
  for (const options of [{ beginError: true }, { dispatchAllowed: false }]) {
    const ledger = fakeLedger(options); let dispatches = 0;
    await assert.rejects(prepareMem0IndexMaterial(context, config, ledger, transports({ onExtract: () => dispatches++ }), now), error => {
      assert.ok(error instanceof Mem0AttemptError); assert.equal(error.reconciliationRequired, true); return true;
    });
    assert.equal(dispatches, 0);
  }
});

test('transport failure becomes ambiguous and never falls through to embedding', async () => {
  const ledger = fakeLedger(); let embeddingCalls = 0;
  await assert.rejects(prepareMem0IndexMaterial(context, config, ledger, transports({
    async extract() { throw new Error('provider_timeout'); }, onEmbed: () => embeddingCalls++,
  }), now), error => error instanceof Mem0AttemptError && error.message === 'provider_timeout' && error.reconciliationRequired);
  assert.equal(embeddingCalls, 0);
  assert.deepEqual(ledger.calls.map(c => c[0]), ['reserve','begin','ambiguous']);
  assert.equal(ledger.calls[2][1].reason, 'provider_timeout');
});

test('failed ambiguity marker cannot cause a retry or hide reconciliation-required state', async () => {
  const ledger = fakeLedger({ ambiguousError: true }); let extractionCalls = 0;
  await assert.rejects(prepareMem0IndexMaterial(context, config, ledger, transports({
    async extract() { extractionCalls++; throw new Error('provider_timeout'); },
  }), now), error => error instanceof Mem0AttemptError && error.message === 'provider_timeout' && error.reconciliationRequired);
  assert.equal(extractionCalls, 1);
  assert.deepEqual(ledger.calls.map(c => c[0]), ['reserve','begin','ambiguous']);
});

test('missing or mismatched usage is ambiguous and cannot be settled as zero', async () => {
  for (const usage of [undefined, { model: 'wrong', inputTokens: 1, outputTokens: 1, latencyMs: 1 },
    { model: config.extraction.model, inputTokens: 20001, outputTokens: 1, latencyMs: 1 }]) {
    const ledger = fakeLedger();
    await assert.rejects(prepareMem0IndexMaterial(context, config, ledger, transports({
      async extract() { return { value: 'fact', usage }; },
    }), now), /provider_usage_invalid/);
    assert.equal(ledger.calls.some(c => c[0] === 'settle'), false);
    assert.equal(ledger.calls.at(-1)[1].reason, 'provider_usage_invalid');
  }
});

test('settlement ambiguity never starts the second paid operation', async () => {
  for (const options of [{ settleError: true }, { invalidSettlement: true }]) {
    const ledger = fakeLedger(options); let embeddingCalls = 0;
    await assert.rejects(prepareMem0IndexMaterial(context, config, ledger,
      transports({ onEmbed: () => embeddingCalls++ }), now), /usage_save_failed/);
    assert.equal(embeddingCalls, 0);
    assert.deepEqual(ledger.calls.map(c => c[0]), ['reserve','begin','settle','ambiguous']);
  }
});

test('settled invalid extraction is not indexed and does not buy an embedding', async () => {
  const ledger = fakeLedger(); let embeddingCalls = 0;
  await assert.rejects(prepareMem0IndexMaterial(context, config, ledger, transports({
    async extract() { return { value: '', usage: { model: config.extraction.model, inputTokens: 1, outputTokens: 1, latencyMs: 1 } }; },
    onEmbed: () => embeddingCalls++,
  }), now), /extraction_result_invalid/);
  assert.equal(embeddingCalls, 0);
  assert.deepEqual(ledger.calls.map(c => c[0]), ['reserve','begin','settle']);
});

test('wrong embedding dimension is settled but withheld from publication', async () => {
  const ledger = fakeLedger();
  await assert.rejects(prepareMem0IndexMaterial(context, config, ledger, transports({
    async embed() { return { value: [0.1], usage: { model: config.embedding.model, inputTokens: 1, outputTokens: 0, latencyMs: 1 } }; },
  }), now), /embedding_result_invalid/);
  assert.equal(ledger.calls.filter(c => c[0] === 'settle').length, 2);
});

test('scope, revision, distinct request identities and source bounds fail before admission', async () => {
  const invalid = [
    { ...context, organizationId: '*' },
    { ...context, memoryRevision: 'x' },
    { ...context, embeddingRequestKey: context.extractionRequestKey },
    { ...context, sourceText: 'x'.repeat(12001) },
  ];
  for (const value of invalid) {
    const ledger = fakeLedger();
    await assert.rejects(prepareMem0IndexMaterial(value, config, ledger, transports(), now), /context_invalid/);
    assert.equal(ledger.calls.length, 0);
  }
});
