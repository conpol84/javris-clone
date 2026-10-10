import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { discoverMcpTools } from '../../supabase/functions/_shared/mcp-tool-discovery.ts';

const allow = [
  'omniroute_get_health',
  'omniroute_check_quota',
  'omniroute_cost_report',
  'omniroute_list_models_catalog',
  'omniroute_list_combos',
];

function catalogs(names, pageSize = names.length) {
  const pages = [];
  for (let i = 0; i < names.length; i += pageSize) {
    const tools = names.slice(i, i + pageSize).map(name => ({
      name,
      description: 'Caution: ' + name,
      inputSchema: { type: 'object', properties: {} },
    }));
    pages.push({
      tools,
      nextCursor: i + pageSize < names.length ? String(i + pageSize) : undefined,
    });
  }
  if (!pages.length) pages.push({ tools: [] });
  const calls = [];
  async function reader(params, requestId) {
    const index = params.cursor === undefined ? 0 : Number(params.cursor) / pageSize;
    calls.push({ params, requestId });
    return pages[index];
  }
  return { reader, calls };
}

test('110 Omni tools, five approved IDs AFTER legacy 100-cap, no write tool output', async () => {
  const names = Array.from({length: 105}, (_, i) => 'omniroute_unapproved_' + i).concat(allow);
  const { reader, calls } = catalogs(names);
  const results = await discoverMcpTools(reader, true);
  assert.deepEqual(results.map(x => x.name), allow);
  assert.ok(results.every(x => x.description.length <= 300));
  assert.equal(calls.length, 1);
  assert.equal(results.some(x => x.name.includes('unapproved')), false);
});

test('211 tools paginated; filter only five read-only names even if on final page', async () => {
  const names = Array.from({length: 206}, (_, i) => 'omniroute_unapproved_' + i).concat(allow);
  const { reader, calls } = catalogs(names, 70);
  const results = await discoverMcpTools(reader, true);
  assert.deepEqual(results.map(x=>x.name), allow);
  assert.deepEqual(calls.map(x => x.params.cursor ?? null), [null, '70', '140', '210']);
  assert.deepEqual(calls.map(x => x.requestId), [10, 11, 12, 13]);
});

test('exact 256 distinct Omni tools accepted with bounded output', async () => {
  const names = Array.from({length: 251}, (_, i) => 'not_authorized_' + i).concat(allow);
  const { reader, calls } = catalogs(names, 32);
  const result = await discoverMcpTools(reader, true);
  assert.deepEqual(result.map(x=>x.name), allow);
  assert.equal(calls.length, 8);
});

test('257 distinct Omni tools fail closed rather than silently truncating', async () => {
  const names = Array.from({length: 252}, (_, i) => 'not_authorized_' + i).concat(allow);
  const { reader, calls } = catalogs(names, 256);
  await assert.rejects(discoverMcpTools(reader, true), /omni_catalog_limit/);
  assert.equal(calls.length, 2);
});

test('incomplete page 8 fails closed instead of losing permitted tools', async () => {
  const names = Array.from({length: 12}, (_, i) => 'unapproved_' + i).concat(allow);
  const { reader } = catalogs(names, 1);
  await assert.rejects(discoverMcpTools(reader, true), /omni_catalog_incomplete/);
});

test('empty catalog is successful without inventing tool names', async () => {
  const { reader } = catalogs([]);
  assert.deepEqual(await discoverMcpTools(reader, true), []);
});

test('duplicate and malformed Omni tool names fail closed', async () => {
  for (const values of [
    ['omniroute_get_health', 'omniroute_get_health'],
    ['omniroute_get_health', 'x\nmalicious'],
    ['omniroute_get_health', ''],
  ]) {
    const { reader } = catalogs(values);
    await assert.rejects(
      discoverMcpTools(reader, true),
      /omni_duplicate_tool_name|omni_bad_tool_name/,
    );
  }
});

test('bad pagination cursor, cycles and non-list page fail closed', async () => {
  await assert.rejects(
    discoverMcpTools(async () => ({tools:[{name:'ok'}],nextCursor:'\u0000bad'}),true),
    /bad_response/,
  );
  await assert.rejects(
    discoverMcpTools(async () => ({tools:[{name:'ok'}],nextCursor:'same'}),true),
    /bad_response|omni_duplicate_tool_name/,
  );
  await assert.rejects(discoverMcpTools(async () => ({tools:null}),true), /bad_response/);
});

test('untrusted schemas only materialized for allowed tools, bounded to 20k', async () => {
  const {reader} = catalogs(['omniroute_route_request','omniroute_get_health']);
  const r = await discoverMcpTools(reader, true);
  assert.deepEqual(r.map(x=>x.name), ['omniroute_get_health']);
  const large = await discoverMcpTools(
    async()=>({tools:[{name:'omniroute_get_health',inputSchema:{privateData:'x'.repeat(21000)}}]}),
    true,
  );
  assert.deepEqual(large[0].inputSchema, {});
});

test('ordinary third-party MCP integrations keep original first-100-tool behavior', async () => {
  const names = Array.from({length: 110}, (_, i) => 'third_party_tool_' + i);
  const {reader,calls} = catalogs(names);
  const r = await discoverMcpTools(reader, false);
  assert.equal(r.length, 100);
  assert.deepEqual(r.map(x=>x.name), names.slice(0,100));
  assert.equal(calls.length, 1);
});

test('ordinary third-party MCP keeps skip invalid/duplicate and finite 5-page cap', async () => {
  const {reader} = catalogs(['valid','bad\nname','valid','also_good']);
  assert.deepEqual((await discoverMcpTools(reader,false)).map(t=>t.name),['valid','also_good']);
  const many = Array.from({length: 8}, (_, i) => 'third_party_' + i);
  const {reader:paginated,calls} = catalogs(many,1);
  const out = await discoverMcpTools(paginated,false);
  assert.equal(out.length,5);
  assert.equal(calls.length,5);
});

test('existing FIRBO MCP Edge invokes shared discovery at ALL three entrypoints', async () => {
  const edge = readFileSync(new URL('../../supabase/functions/mcp/index.ts', import.meta.url),'utf8');
  assert.match(edge, /import \{ discoverMcpTools \} from '\.\.\/_shared\/mcp-tool-discovery\.ts';/);
  assert.match(edge, /return discoverMcpTools\(/);
  assert.equal((edge.match(/listTools\(s, omni === 'shared'\)/g)||[]).length, 2);
  assert.equal((edge.match(/listTools\(await open\(u\.toString\(\), token\), omni === 'shared'\)/g)||[]).length, 1);
  assert.match(edge, /isPlatformAdmin/);
  assert.match(edge, /omniMcpPilotEnabled/);
  assert.match(edge, /filterOmniReadOnlyTools\(advertised\)/);
});


test('generic third-party MCP malformed cursor retains historical end-of-list semantics', async () => {
  const pages = [123, 'bad\ncursor', []];
  for (const nextCursor of pages) {
    let calls = 0;
    const result = await discoverMcpTools(async () => {
      calls++;
      return { tools: [{ name: 'normal_external_tool' }], nextCursor };
    }, false);
    assert.deepEqual(result.map(x => x.name), ['normal_external_tool']);
    assert.equal(calls, 1);
  }
});

test('shared OmniRoute rejects invalid cursor rather than quietly losing later allowlisted tools', async () => {
  for (const nextCursor of [123, 'bad\ncursor', []]) {
    await assert.rejects(discoverMcpTools(
      async () => ({ tools: [{ name: 'omniroute_get_health' }], nextCursor }), true),
      /bad_response/,
    );
  }
});
