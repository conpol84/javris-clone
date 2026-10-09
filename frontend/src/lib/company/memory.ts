import { requireClient } from './client';

export const MEMORY_TYPES = ['company', 'project', 'instruction', 'decision', 'fact', 'user_preference'] as const;
export type MemoryType = (typeof MEMORY_TYPES)[number] | 'conversation';

export interface MemoryRow {
  id: string;
  content: string;
  memory_type: MemoryType;
  importance: number;
  agent_id: string | null;
  created_at: string;
}

export const MEMORY_COLORS: Record<MemoryType, string> = {
  company: '#00d4ff',
  project: '#a78bfa',
  instruction: '#fbbf24',
  decision: '#34d399',
  fact: '#60a5fa',
  user_preference: '#f472b6',
  conversation: '#94a3b8',
};

export async function listMemories(orgId: string): Promise<MemoryRow[]> {
  const { data, error } = await requireClient()
    .from('memories')
    .select('id, content, memory_type, importance, agent_id, created_at')
    .eq('organization_id', orgId)
    .order('importance', { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  return (data ?? []) as MemoryRow[];
}

export async function addMemory(orgId: string, userId: string, input: { content: string; type: MemoryType; importance: number; agentId?: string | null }): Promise<void> {
  const { error } = await requireClient()
    .from('memories')
    .insert({ organization_id: orgId, user_id: userId, content: input.content.trim().slice(0, 1000), memory_type: input.type, importance: input.importance, agent_id: input.agentId ?? null });
  if (error) throw new Error(error.message);
}

export const MEMORY_FILE_MAX_BYTES = 100_000;
export const MEMORY_FILE_MAX_NOTES = 20;

/** Splits plain text into memory-sized notes (paragraph by paragraph, at most `maxLen` characters each). */
export function splitIntoNotes(text: string, maxLen = 900, maxNotes = MEMORY_FILE_MAX_NOTES): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  if (!clean) return [];
  const notes: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur) notes.push(cur);
    cur = '';
  };
  for (const paragraph of clean.split(/\n{2,}/).map((x) => x.replace(/\n/g, ' ').trim()).filter(Boolean)) {
    for (let i = 0; i < paragraph.length; i += maxLen) {
      const piece = paragraph.slice(i, i + maxLen);
      if (cur && cur.length + 1 + piece.length > maxLen) flush();
      cur = cur ? `${cur} ${piece}` : piece;
    }
  }
  flush();
  return notes.slice(0, maxNotes);
}

export async function deleteMemory(orgId: string, id: string): Promise<void> {
  if (!orgId || !id) throw new Error('memory_scope_required');
  const { data, error } = await requireClient().from('memories').delete().eq('organization_id', orgId).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length !== 1 || data[0].id !== id) throw new Error('memory_not_changed');
}

/** The memories an agent actually reads: the same rule the runner uses (company-wide or its own, most important first). */
export function memoriesReadBy<T extends { id: string; agent_id: string | null; importance: number }>(agentId: string, items: T[], limit = 12): T[] {
  return items
    .filter((m) => m.agent_id === null || m.agent_id === agentId)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}

