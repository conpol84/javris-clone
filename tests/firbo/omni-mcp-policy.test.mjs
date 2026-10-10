import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FIRBO_OMNI_MCP_URL, OMNI_READONLY_MCP_TOOLS, omniMcpEndpoint,
  isOmniReadOnlyMcpTool, filterOmniReadOnlyTools,
} from '../../supabase/functions/_shared/omni-mcp-policy.ts';

const gateway = 'https://gateway.firboai.app';
const edge = readFileSync(new URL('../../supabase/functions/mcp/index.ts', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../../frontend/src/pages/IntegrationsPage.tsx', import.meta.url), 'utf8');

test('only canonical OmniRoute Streamable HTTP endpoint enters protected shared mode', () => {
  assert.equal(FIRBO_OMNI_MCP_URL, gateway + '/api/mcp/stream');
  assert.equal(omniMcpEndpoint(FIRBO_OMNI_MCP_URL), 'shared');
  for (const raw of [
    gateway, gateway + '/api/mcp/sse', gateway + '/dashboard',
    gateway + '/api/mcp/stream?token=abc', gateway + '/api/mcp/stream#ignored',
    'http://gateway.firboai.app/api/mcp/stream',
    'https://gateway.firboai.app./api/mcp/stream',
    'https://user:pass@gateway.firboai.app/api/mcp/stream',
    'https://gateway.firboai.app:8443/api/mcp/stream',
  ]) assert.equal(omniMcpEndpoint(raw), 'wrong_path', raw);
  for (const raw of [
    'https://gateway.firboai.app.evil.test/api/mcp/stream',
    'https://other.example/api/mcp/stream',
    '', undefined, {}, 'not a url',
  ]) assert.equal(omniMcpEndpoint(raw), 'other');
});

test('advertised executable tools cannot be promoted to the central shared gateway connection', () => {
  assert.deepEqual(OMNI_READONLY_MCP_TOOLS, [
    'omniroute_get_health', 'omniroute_check_quota',
    'omniroute_cost_report', 'omniroute_list_models_catalog',
    'omniroute_list_combos',
  ]);
  const dangerous=[
    'omniroute_route_request', 'omniroute_switch_combo',
    'omniroute_create_combo','omniroute_set_budget_guard',
    'omniroute_cache_flush','omniroute_web_search',
    'omniroute_sync_pricing','omniroute_install_skill',
    'omniroute_rotate_key','omniroute_execute_cli','omniroute_tool_search',
    'tools/call','omniroute_get_health_extra','Omniroute_get_health',
  ];
  for (const name of dangerous) assert.equal(isOmniReadOnlyMcpTool(name),false,name);
  assert.equal(isOmniReadOnlyMcpTool('omniroute_get_health'),true);
  const advertised = [{name:'omniroute_get_health'},{name:'omniroute_route_request'}, {name:'omniroute_check_quota'}];
  assert.deepEqual(filterOmniReadOnlyTools(advertised), [advertised[0],advertised[2]]);
});

test('reuses existing company MCP Edge, RBAC, audit and confirmation; denies shared mutations before any session', () => {
  assert.match(edge, /userClient\.rpc\('is_platform_admin'\)/);
  assert.match(edge, /omni === 'shared' && !\(await isPlatformAdmin\(\)\)/);
  assert.match(edge, /omni === 'shared' && !isOmniReadOnlyMcpTool\(tool\)/);
  assert.match(edge, /filterOmniReadOnlyTools\(advertised\)/);
  assert.match(edge, /if \(body\.confirm !== true\)/);
  assert.match(edge, /action: 'mcp\.tool_requested'/);
  assert.match(edge, /action: 'mcp\.tool_completed'/);
  assert.ok(edge.indexOf("if (omni === 'shared' && !isOmniReadOnlyMcpTool(tool))") <
            edge.indexOf("const s = await open(serverUrl, token)"));
  assert.doesNotMatch(edge,/Deno\.serve.*Deno\.serve/s);
  assert.match(frontend, /const openOmniRoute = \(\) => \{/);
  assert.match(frontend, /open\('mcp'\)/);
  assert.match(frontend, /FIRBO_OMNI_MCP_URL/);
  assert.doesNotMatch(frontend, /OMNIROUTE_MANAGEMENT_KEY|OMNIROUTE_API_KEY/);
});
