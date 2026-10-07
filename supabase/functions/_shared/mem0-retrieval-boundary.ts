/** Preparatory OSS Mem0 boundary. No SDK, transport, ingestion or live consumer. */
export interface MemoryScope { organizationId: string; agentId: string }
export interface AuthoritativeMemory {
  id: string;
  organization_id: string;
  agent_id: string | null;
  content: string;
  updated_at: string;
  expires_at: string | null;
  metadata: Record<string, unknown>;
}
export interface MemoryReference {
  firbo_memory_id: string;
  firbo_organization_id: string;
  firbo_agent_scope: string;
  firbo_revision: string;
}
export interface ResolvedMemory {
  id: string;
  content: string;
  agent_id: string | null;
  source_task_id: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_RESULTS = 64;
const MAX_NOTES = 12;
const MAX_NOTE_CHARS = 4000;
const MAX_CONTEXT_CHARS = 12000;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value));

function scopeChecked(scope: MemoryScope): MemoryScope {
  if (!object(scope) || !uuid(scope.organizationId) || !uuid(scope.agentId)) {
    throw new Error('memory_scope_invalid');
  }
  return { organizationId: scope.organizationId, agentId: scope.agentId };
}

function limitChecked(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_NOTES) throw new Error('memory_limit_invalid');
  return limit;
}

function rowChecked(row: unknown): row is AuthoritativeMemory {
  return object(row) && uuid(row.id) && uuid(row.organization_id)
    && (row.agent_id === null || uuid(row.agent_id))
    && typeof row.content === 'string' && row.content.trim().length > 0
    && row.content.length <= MAX_NOTE_CHARS && timestamp(row.updated_at)
    && (row.expires_at === null || timestamp(row.expires_at)) && object(row.metadata);
}

/** Metadata for a future indexer. Never replaces or writes the authoritative row. */
export async function memoryIndexReference(row: AuthoritativeMemory): Promise<MemoryReference> {
  if (!rowChecked(row)) throw new Error('memory_row_invalid');
  // Include actual content: updated_at alone is insufficient for user corrections.
  const material = JSON.stringify([
    row.id, row.organization_id, row.agent_id, row.content, row.updated_at, row.expires_at,
  ]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(material));
  return {
    firbo_memory_id: row.id,
    firbo_organization_id: row.organization_id,
    firbo_agent_scope: row.agent_id ?? 'company',
    firbo_revision: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join(''),
  };
}

/** Caller must derive scope from authenticated server context, never model arguments.
 * `enabled` is supplied by a future reviewed server integration, not a model tool flag.
 * Returning a request is not authorization, accounting admission or dispatch.
 */
export function buildMem0SearchRequest(scope: MemoryScope, query: string, enabled = false, limit = MAX_NOTES) {
  const trusted = scopeChecked(scope);
  limitChecked(limit);
  if (enabled !== true) return null;
  if (typeof query !== 'string' || !query.trim() || query.length > 2000) throw new Error('memory_query_invalid');
  return {
    query,
    limit,
    filters: {
      AND: [
        { firbo_organization_id: trusted.organizationId },
        { OR: [{ firbo_agent_scope: 'company' }, { firbo_agent_scope: trusted.agentId }] },
      ],
    },
  };
}

/** Treat Mem0 only as untrusted ranked references. Never use its returned prose.
 * readCurrentRows must perform a fresh, authorized, company-scoped DB read AFTER
 * search completion. Deletion/correction between search and this read wins.
 * DB failures propagate; callers must not silently use stale provider text.
 */
export async function resolveMem0Search(
  scope: MemoryScope,
  response: unknown,
  readCurrentRows: (scope: MemoryScope, ids: string[]) => Promise<unknown>,
  options: { limit?: number; now?: () => number } = {},
): Promise<ResolvedMemory[]> {
  const trusted = scopeChecked(scope);
  const limit = limitChecked(options.limit ?? MAX_NOTES);
  if (!object(response) || !Array.isArray(response.results) || response.results.length > MAX_RESULTS) {
    throw new Error('memory_response_invalid');
  }
  // Copy primitive fields before awaiting; response mutation cannot change the request/result binding.
  const references: MemoryReference[] = response.results.flatMap(item => {
    if (!object(item) || !object(item.metadata)) return [];
    const m = item.metadata;
    if (!uuid(m.firbo_memory_id) || m.firbo_organization_id !== trusted.organizationId
      || (m.firbo_agent_scope !== 'company' && m.firbo_agent_scope !== trusted.agentId)
      || typeof m.firbo_revision !== 'string' || !/^[a-f0-9]{64}$/.test(m.firbo_revision)) return [];
    return [{ firbo_memory_id: m.firbo_memory_id, firbo_organization_id: trusted.organizationId,
      firbo_agent_scope: m.firbo_agent_scope, firbo_revision: m.firbo_revision }];
  });
  const ids = [...new Set(references.map(m => m.firbo_memory_id))];
  if (!ids.length) return [];
  const rows = await readCurrentRows({ ...trusted }, [...ids]);
  if (!Array.isArray(rows) || rows.length > MAX_RESULTS) throw new Error('memory_readback_invalid');
  const now = (options.now ?? Date.now)();
  if (!Number.isFinite(now)) throw new Error('memory_clock_invalid');
  const wanted = new Set(ids);
  const current = new Map<string, AuthoritativeMemory>();
  const duplicate = new Set<string>();
  // A duplicate DB identity is ambiguous, even if only one duplicate looks valid.
  const seen = new Set<string>();
  for (const row of rows) {
    if (object(row) && uuid(row.id)) {
      if (seen.has(row.id)) duplicate.add(row.id);
      seen.add(row.id);
    }
    if (!rowChecked(row) || !wanted.has(row.id) || row.organization_id !== trusted.organizationId
      || (row.agent_id !== null && row.agent_id !== trusted.agentId)
      || row.metadata.deleted_at != null
      || (row.expires_at !== null && Date.parse(row.expires_at) <= now)) continue;
    // Snapshot DB primitives before hashing across an await.
    current.set(row.id, { ...row, metadata: { ...row.metadata } });
  }
  const revisions = new Map<string, MemoryReference>();
  for (const [id, row] of current) if (!duplicate.has(id)) revisions.set(id, await memoryIndexReference(row));
  // Also exclude notes expiring during async validation, not merely at DB return.
  const finishedAt = (options.now ?? Date.now)();
  if (!Number.isFinite(finishedAt) || finishedAt < now) throw new Error('memory_clock_invalid');
  const resolved: ResolvedMemory[] = [];
  const emitted = new Set<string>();
  let chars = 0;
  for (const reference of references) {
    const row = current.get(reference.firbo_memory_id);
    const revision = revisions.get(reference.firbo_memory_id);
    if (!row || !revision || emitted.has(row.id) || revision.firbo_revision !== reference.firbo_revision
      || revision.firbo_agent_scope !== reference.firbo_agent_scope
      || (row.expires_at !== null && Date.parse(row.expires_at) <= finishedAt)
      || chars + row.content.length > MAX_CONTEXT_CHARS) continue;
    emitted.add(row.id);
    chars += row.content.length;
    resolved.push({ id: row.id, content: row.content, agent_id: row.agent_id,
      source_task_id: uuid(row.metadata.source_task_id) ? row.metadata.source_task_id : null });
    if (resolved.length === limit) break;
  }
  return resolved;
}
