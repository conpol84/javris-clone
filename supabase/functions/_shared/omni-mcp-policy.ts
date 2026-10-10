/** One FIRBO MCP backend, one organization ledger, one platform OmniRoute.
 * The shared gateway is NOT a separate company agent, memory or MCP database.
 * A descriptive AgentSkills catalogue never grants tool execution.
 */
export const FIRBO_OMNI_MCP_URL = 'https://gateway.firboai.app/api/mcp/stream' as const;

export const OMNI_READONLY_MCP_TOOLS = [
  'omniroute_get_health',
  'omniroute_check_quota',
  'omniroute_cost_report',
  'omniroute_list_models_catalog',
  'omniroute_list_combos',
] as const;

/** Treat every request to the shared gateway as privileged, even if its
 * path is wrong. Do not forward a scoped MCP key to /dashboard or /api/keys.
 */
export function omniMcpEndpoint(raw: unknown): 'shared' | 'wrong_path' | 'other' {
  if (typeof raw !== 'string') return 'other';
  let parsed: URL;
  try { parsed = new URL(raw); } catch { return 'other'; }
  if (parsed.hostname.toLowerCase() !== 'gateway.firboai.app') return 'other';
  return parsed.href === FIRBO_OMNI_MCP_URL ? 'shared' : 'wrong_path';
}

const READONLY = new Set<string>(OMNI_READONLY_MCP_TOOLS);

/** Fail closed: no execute, write, tool_search, webhook, tunnel, key rotation
 * or skill install even if the remote provider advertises them.
 */
export function isOmniReadOnlyMcpTool(value: unknown): value is typeof OMNI_READONLY_MCP_TOOLS[number] {
  return typeof value === 'string' && READONLY.has(value);
}

export function filterOmniReadOnlyTools<T extends { name: string }>(tools: readonly T[]): T[] {
  return tools.filter(tool => isOmniReadOnlyMcpTool(tool.name));
}
