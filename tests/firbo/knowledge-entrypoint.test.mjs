/** Actual Knowledge handler, synthetic database/provider doubles only.
 * SQL rollback semantics are separately tested against PostgreSQL; this suite
 * proves endpoint errors/permissions stop before any real provider request.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const originalDeno = globalThis.Deno;
const originalFetch = globalThis.fetch;
let state, handler;
globalThis.Deno = { env: { get: key => ({ SUPABASE_URL: 'https://db.example.test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', SUPABASE_ANON_KEY: 'anon-test' })[key] }, serve: fn => { handler = fn; } };
globalThis.__knowledgeClient = (...args) => state.client(...args);
globalThis.__knowledgeTools = {
  chunkText: text => text.trim() ? [text.trim().slice(0, 900)] : [],
  embed: async () => { state.embeddings++; return null; },
};
globalThis.__knowledgePage = async () => {
  state.providerCalls++;
  if (state.options.providerError) throw new Error('http_503');
  return state.options.emptyProvider ? '' : 'New synthetic knowledge content for the test source.';
};
globalThis.fetch = async (url) => { throw Error(`Unexpected external request: ${String(url)}`); };
const temp = await mkdtemp(join(tmpdir(), 'firbo-knowledge-test-'));
const source = await readFile(new URL('../../supabase/functions/knowledge/index.ts', import.meta.url), 'utf8');
const code = source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';", 'const createClient = (...args: any[]) => (globalThis as any).__knowledgeClient(...args);')
  .replace("import { chunkText, embed } from '../_shared/agent-tools.ts';", 'const { chunkText, embed } = (globalThis as any).__knowledgeTools;')
  .replace("import { readPageDirect } from '../_shared/free-search.ts';", 'const readPageDirect = (globalThis as any).__knowledgePage;');
const path = join(temp, 'knowledge.ts');
await writeFile(path, code);
await import(pathToFileURL(path).href);
after(async () => {
  globalThis.Deno = originalDeno; globalThis.fetch = originalFetch;
  delete globalThis.__knowledgeClient; delete globalThis.__knowledgeTools; delete globalThis.__knowledgePage;
  await rm(temp, { recursive: true, force: true });
});

function fixture(options = {}) {
  const current = {
    options, reads: [], writes: [], rpcs: [], embeddings: 0, providerCalls: 0, httpCalls: [],
    source: { id: SOURCE, organization_id: ORG, name: 'Synthetic document', type: options.sourceType ?? 'url', status: options.indexing ? 'indexing' : 'ready', item_count: 1, url: 'https://source.example.test', integration_id: 'integration-test', metadata: { preserve: true }, last_error: null },
    chunks: [{ source_id: SOURCE, organization_id: ORG, content: 'Previous synthetic knowledge remains searchable.' }],
  };
  const matches = (row, filters) => filters.every(([op, key, value]) => op === 'neq' ? row[key] !== value : row[key] === value);
  const error = { message: 'Synthetic database failure' };
  const execute = (table, op, payload, filters, selection) => {
    const record = { table, op, payload, filters, selection };
    if (op === 'select') {
      current.reads.push(record);
      if (table === 'organization_members') return { data: options.noMembership ? null : { role: options.role ?? 'owner' }, error: options.roleError ? error : null };
      if (table === 'knowledge_sources') {
        if (selection === 'id') return { data: null, count: 1, error: options.countError ? error : null };
        return { data: current.source && matches(current.source, filters) ? { ...current.source } : null, error: options.sourceError ? error : null };
      }
      if (table === 'knowledge_chunks') return { data: [], error: options.embeddingReadError ? error : null };
      if (table === 'integrations') return { data: { id: 'integration-test', organization_id: options.foreignApp ? 'other-org' : ORG, kind: 'notion', name: 'Synthetic app', config: {} }, error: options.integrationError ? error : null };
      if (table === 'integration_secrets') return { data: { secret: '{"token":"synthetic-test-only"}' }, error: options.secretError ? error : null };
      if (table === 'cron_secrets') return { data: { value: 'cron-test-only' }, error: options.cronError ? error : null };
      throw Error('Unhandled read ' + table);
    }
    current.writes.push(record);
    assert.equal(table, 'knowledge_sources', 'handler must never directly delete or insert chunks');
    if (op === 'insert') {
      if (options.insertError) return { data: null, error };
      current.source = { ...current.source, ...payload }; return { data: { ...current.source }, error: null };
    }
    if (op === 'delete') {
      if (options.deleteError) return { data: null, error };
      if (options.deleteLost) return { data: null, error: null };
      assert.ok(filters.some(([, key, value]) => key === 'organization_id' && value === ORG));
      current.source = null; current.chunks = []; return { data: { id: SOURCE }, error: null };
    }
    if (payload.status === 'indexing' && options.claimError || payload.status === 'failed' && options.statusError) return { data: null, error };
    if (!current.source || !matches(current.source, filters)) return { data: null, error: null };
    current.source = { ...current.source, ...payload }; return { data: { id: SOURCE }, error: null };
  };
  current.client = () => ({
    auth: { getUser: async () => ({ data: { user: options.unsigned ? null : { id: USER } }, error: null }) },
    rpc: async (fn, args) => {
      current.rpcs.push({ fn, args });
      if (fn === 'plan_limit') return { data: 100, error: options.planError ? error : null };
      if (fn === 'match_knowledge') return { data: current.chunks, error: options.searchError ? error : null };
      assert.equal(fn, 'replace_knowledge_chunks');
      assert.equal(args.p_org, ORG); assert.equal(args.p_source, SOURCE);
      assert.equal(args.p_actor, USER);
      assert.ok(args.p_chunks.every(chunk => !('organization_id' in chunk) && !('source_id' in chunk)));
      if (options.replaceError || options.revokedDuringRead) return { data: null, error };
      current.chunks = args.p_chunks.map(chunk => ({ ...chunk, source_id: SOURCE, organization_id: ORG }));
      current.source = { ...current.source, status: 'ready', item_count: current.chunks.length, last_error: null };
      return { data: current.chunks.length, error: null };
    },
    from: table => {
      let op = 'select', payload, selection; const filters = [];
      const query = {
        select(value) { selection = value; return query; },
        insert(value) { op = 'insert'; payload = value; return query; },
        update(value) { op = 'update'; payload = value; return query; },
        delete() { op = 'delete'; return query; },
        eq(key, value) { filters.push(['eq', key, value]); return query; },
        neq(key, value) { filters.push(['neq', key, value]); return query; },
        is() { return query; }, limit() { return query; },
        maybeSingle() { return Promise.resolve(execute(table, op, payload, filters, selection)); },
        single() { return query.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve(execute(table, op, payload, filters, selection)).then(resolve, reject); },
      };
      return query;
    },
  });
  globalThis.fetch = async (url, init) => {
    current.httpCalls.push({ url: String(url), init });
    if (options.notionPartialFailure && String(url) === 'https://api.notion.com/v1/search') {
      return Response.json({ results: [
        { id: 'synthetic-page-a', properties: {}, url: 'https://source.example.test/page-a' },
        { id: 'synthetic-page-b', properties: {}, url: 'https://source.example.test/page-b' },
      ] });
    }
    if (options.notionPartialFailure && String(url).includes('/blocks/synthetic-page-a/')) {
      return Response.json({ results: [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'First synthetic page loaded.' }] } }] });
    }
    if (options.notionPartialFailure && String(url).includes('/blocks/synthetic-page-b/')) return Response.json({ error: 'synthetic failure' }, { status: 503 });
    throw Error(`Unexpected external request: ${String(url)}`);
  };
  state = current; return current;
}
async function invoke(action, options = {}, extra = {}) {
  const current = fixture(options);
  const response = await handler(new Request('https://db.example.test/functions/v1/knowledge', { method: 'POST', headers: { authorization: 'Bearer synthetic-user', 'content-type': 'application/json' }, body: JSON.stringify({ action, source_id: SOURCE, organization_id: ORG, ...extra }) }));
  return { current, response, body: await response.json() };
}

for (const [label, options, status] of [
  ['unsigned', { unsigned: true }, 401], ['viewer', { role: 'viewer' }, 403],
  ['missing membership', { noMembership: true }, 403], ['membership database error', { roleError: true }, 503],
  ['source database error', { sourceError: true }, 503], ['claim database error', { claimError: true }, 503],
  ['already indexing', { indexing: true }, 409],
]) test(`Knowledge sync ${label} stops before provider`, async () => {
  const { current, response } = await invoke('sync', options);
  assert.equal(response.status, status); assert.equal(current.providerCalls, 0); assert.equal(current.rpcs.length, 0);
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});

for (const [label, options] of [['count', { countError: true }], ['plan', { planError: true }], ['integration', { integrationError: true }]]) {
  test(`Knowledge add ${label} database failure stops before provider and source insertion`, async () => {
    const { current, response } = await invoke('add_app', options, { integration_id: 'integration-test' });
    assert.equal(response.status, 503); assert.equal(current.providerCalls, 0); assert.equal(current.writes.length, 0);
  });
}
test('foreign integration is rejected before insertion or provider', async () => {
  const { current, response } = await invoke('add_app', { foreignApp: true }, { integration_id: 'integration-test' });
  assert.equal(response.status, 400); assert.equal(current.writes.length, 0); assert.equal(current.providerCalls, 0);
});
for (const options of [{ integrationError: true }, { secretError: true }]) test('app refresh database/secret failure stops before provider', async () => {
  const { current, response } = await invoke('sync', { sourceType: 'integration', ...options });
  assert.equal(response.status, 502); assert.equal(current.httpCalls.length, 0); assert.equal(current.rpcs.length, 0);
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});
test('partially unreadable connected app does not publish a partial replacement', async () => {
  const { current, response } = await invoke('sync', { sourceType: 'integration', notionPartialFailure: true });
  assert.equal(response.status, 502); assert.equal(current.httpCalls.length, 3); assert.equal(current.rpcs.length, 0);
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});
test('replacement failure retains old chunks and marks failed refresh honestly', async () => {
  const { current, response, body } = await invoke('sync', { replaceError: true });
  assert.equal(response.status, 502); assert.equal(body.reason, 'save_failed');
  assert.equal(current.source.status, 'failed'); assert.equal(current.source.item_count, 1);
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});
test('role revoked during remote read cannot publish a replacement', async () => {
  const { current, response } = await invoke('sync', { revokedDuringRead: true });
  assert.equal(response.status, 502); assert.equal(current.providerCalls, 1);
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});
for (const options of [{ providerError: true }, { emptyProvider: true }]) test('failed or empty upstream preserves prior material', async () => {
  const { current, response } = await invoke('sync', options);
  assert.equal(response.status, 502); assert.equal(current.rpcs.length, 0);
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});
test('failed status save is reported as unavailable, not successful refresh', async () => {
  const { current, response, body } = await invoke('sync', { replaceError: true, statusError: true });
  assert.equal(response.status, 503); assert.equal(body.error, 'status_save_failed');
  assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
});
test('successful keyword save reports optional embedding outage and preserves source metadata', async () => {
  const { current, response, body } = await invoke('sync', { embeddingReadError: true });
  assert.equal(response.status, 200); assert.equal(body.passages, 1); assert.equal(body.embedding_error, 'embedding_incomplete');
  assert.equal(body.embedding_pending, true); assert.equal(current.source.status, 'ready');
  assert.deepEqual(current.source.metadata, { preserve: true }); assert.match(current.chunks[0].content, /^New synthetic/);
});
for (const [options, status, code] of [[{ deleteError: true }, 503, 'delete_failed'], [{ deleteLost: true }, 404, 'not_found']]) {
  test(`source deletion checks ${code} and leaves chunks intact`, async () => {
    const { current, response, body } = await invoke('delete', options);
    assert.equal(response.status, status); assert.equal(body.error, code);
    assert.equal(current.chunks[0].content, 'Previous synthetic knowledge remains searchable.');
    assert.equal(current.writes.length, 1); assert.equal(current.writes[0].table, 'knowledge_sources');
  });
}
test('successful source deletion is scoped and relies on one FK-cascade transaction', async () => {
  const { current, response, body } = await invoke('delete');
  assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(current.writes.length, 1);
  assert.equal(current.source, null); assert.deepEqual(current.chunks, []); assert.equal(current.providerCalls, 0);
});
