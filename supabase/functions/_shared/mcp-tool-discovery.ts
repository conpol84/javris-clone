/** Bounded MCP discovery for the EXISTING FIRBO integration.
 *
 * Ordinary company MCPs retain the established first-100-tools behaviour.
 * The single shared, platform-admin-only OmniRoute gateway scans up to 256
 * distinct advertised names across eight pages, but materializes ONLY the
 * five source-allowlisted read-only tools. Advertising is not permission.
 *
 * No credentials, HTTP, tenant data, payments or execution live here.
 */
import { isOmniReadOnlyMcpTool } from './omni-mcp-policy.ts';

export interface McpAdvertisedTool {
  name: string;
  description: string;
  inputSchema: unknown;
}

type ToolPage = { tools?: unknown; nextCursor?: unknown } | null;
type PageReader = (params: { cursor?: string }, requestId: number) => Promise<ToolPage>;

const STANDARD_TOOL_LIMIT = 100;
const STANDARD_PAGE_LIMIT = 5;
const SHARED_OMNI_TOOL_LIMIT = 256;
const SHARED_OMNI_PAGE_LIMIT = 8;

const VALID_TOOL_NAME = /^[A-Za-z0-9_.:/-]{1,100}$/;
const VALID_CURSOR = /^[^\u0000-\u001f\u007f]{1,500}$/;

export async function discoverMcpTools(
  readPage: PageReader,
  sharedOmni = false,
): Promise<McpAdvertisedTool[]> {
  const tools: McpAdvertisedTool[] = [];
  const names = new Set<string>();
  const cursors = new Set<string>();
  const maxNames = sharedOmni ? SHARED_OMNI_TOOL_LIMIT : STANDARD_TOOL_LIMIT;
  const maxPages = sharedOmni ? SHARED_OMNI_PAGE_LIMIT : STANDARD_PAGE_LIMIT;
  let cursor: string | undefined;

  for (let page = 0; page < maxPages; page++) {
    const result = await readPage(cursor ? { cursor } : {}, 10 + page);
    if (!result || !Array.isArray(result.tools)) throw new Error('bad_response');

    for (const entry of result.tools) {
      const record = entry && typeof entry === 'object' && !Array.isArray(entry)
        ? entry as Record<string, unknown> : {};
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!VALID_TOOL_NAME.test(name)) {
        // Preserve the pre-existing skip behaviour for all unrelated MCP servers.
        if (sharedOmni) throw new Error('omni_bad_tool_name');
        continue;
      }
      if (names.has(name)) {
        if (sharedOmni) throw new Error('omni_duplicate_tool_name');
        continue;
      }
      names.add(name);
      if (sharedOmni && names.size > maxNames) throw new Error('omni_catalog_limit');

      // Do NOT build/store/return schemas for the other ~105 Omni tools.
      // They are neither company-approved nor executable via this adapter.
      if (sharedOmni && !isOmniReadOnlyMcpTool(name)) continue;

      let inputSchema: unknown = {};
      if (record.inputSchema && typeof record.inputSchema === 'object' &&
          !Array.isArray(record.inputSchema)) {
        try {
          if (JSON.stringify(record.inputSchema).length <= 20_000) {
            inputSchema = record.inputSchema;
          }
        } catch { /* an untrusted schema is not required for discovery */ }
      }
      tools.push({
        name,
        description: String(record.description ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 300),
        inputSchema,
      });
      if (!sharedOmni && tools.length >= STANDARD_TOOL_LIMIT) return tools;
    }

    const next = result.nextCursor;
    if (next === undefined || next === null || next === '') return tools;
    if (typeof next !== 'string' || !VALID_CURSOR.test(next)) {
      // Legacy third-party MCPs treated malformed cursors as end-of-list.
      // The central OmniRoute gateway alone requires complete pagination.
      if (sharedOmni) throw new Error('bad_response');
      return tools;
    }
    if (cursors.has(next)) throw new Error('bad_response');
    cursors.add(next);
    cursor = next;
  }

  // A global shared gateway must not silently lose a later allowlisted tool.
  if (sharedOmni) throw new Error('omni_catalog_incomplete');
  return tools; // Other company MCPs keep their existing five-page cap.
}
