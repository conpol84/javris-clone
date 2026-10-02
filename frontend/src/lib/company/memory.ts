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

export async function addMemory(orgId: string, userId: string, input: { content: string; type: MemoryType; importance: number }): Promise<void> {
  const { error } = await requireClient()
    .from('memories')
    .insert({ organization_id: orgId, user_id: userId, content: input.content.trim().slice(0, 1000), memory_type: input.type, importance: input.importance });
  if (error) throw new Error(error.message);
}

export async function deleteMemory(id: string): Promise<void> {
  const { error } = await requireClient().from('memories').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** The memories an agent actually reads: the same rule the runner uses (company-wide or its own, most important first). */
export function memoriesReadBy<T extends { id: string; agent_id: string | null; importance: number }>(agentId: string, items: T[], limit = 12): T[] {
  return items
    .filter((m) => m.agent_id === null || m.agent_id === agentId)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, limit);
}
