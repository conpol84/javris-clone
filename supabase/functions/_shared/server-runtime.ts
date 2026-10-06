/** Installed agent inventory, not permission or successful execution evidence. */
export interface ServerRuntime {
  contract: 'openjarvis-runtime/v1';
  agent_loaded: boolean;
  tool_inventory_known: boolean;
  tool_count: number | null;
  tool_names: string[];
  truncated: boolean;
}
export function serverRuntime(value: unknown): ServerRuntime | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (v.contract !== 'openjarvis-runtime/v1' || typeof v.agent_loaded !== 'boolean' ||
      typeof v.tool_inventory_known !== 'boolean' || typeof v.truncated !== 'boolean' ||
      !Array.isArray(v.tool_names) || v.tool_names.length > 128 ||
      v.tool_names.some(n => typeof n !== 'string' || !n || n.length > 120) ||
      new Set(v.tool_names).size !== v.tool_names.length) return null;
  if (!v.tool_inventory_known) {
    if (v.tool_count !== null || v.tool_names.length || v.truncated) return null;
  } else if (!v.agent_loaded || !Number.isSafeInteger(v.tool_count) ||
      (v.tool_count as number) < 0 ||
      v.tool_names.length !== Math.min(v.tool_count as number, 128) ||
      v.truncated !== ((v.tool_count as number) > 128)) return null;
  return {
    contract: 'openjarvis-runtime/v1', agent_loaded: v.agent_loaded,
    tool_inventory_known: v.tool_inventory_known, tool_count: v.tool_count as number | null,
    tool_names: [...v.tool_names] as string[], truncated: v.truncated,
  };
}
