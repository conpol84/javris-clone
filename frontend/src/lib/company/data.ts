import { requireClient } from './client';
import type {
  AgentRow,
  ApprovalRow,
  Membership,
  OrgCounts,
  TaskPriority,
  TaskRow,
  TaskStatus,
} from './types';
import { slugify } from './types';

function fail<T>(error: { message: string } | null, data: T | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await requireClient()
    .from('organization_members')
    .select('role, organizations(id, name, slug)')
    .eq('user_id', userId);
  const rows = fail(error, data) as unknown as {
    role: Membership['role'];
    organizations: Membership['organization'] | Membership['organization'][] | null;
  }[];
  return rows.flatMap((r) => {
    const org = Array.isArray(r.organizations) ? r.organizations[0] : r.organizations;
    return org ? [{ role: r.role, organization: org }] : [];
  });
}

export async function createOrganization(name: string): Promise<string> {
  const suffix = Math.random().toString(36).slice(2, 6);
  const { data, error } = await requireClient().rpc('create_organization', {
    p_name: name.trim(),
    p_slug: `${slugify(name)}-${suffix}`,
  });
  return fail(error, data as string | null);
}

export async function listAgents(orgId: string): Promise<AgentRow[]> {
  const { data, error } = await requireClient()
    .from('agents')
    .select('id, name, slug, type, description, model, enabled, autonomous, agent_tools(tool_name, enabled)')
    .eq('organization_id', orgId)
    .order('created_at');
  return fail(error, data) as unknown as AgentRow[];
}

export async function setAgentEnabled(agentId: string, enabled: boolean): Promise<void> {
  const { error } = await requireClient().from('agents').update({ enabled }).eq('id', agentId);
  fail(error, null);
}

export async function listTasks(orgId: string): Promise<TaskRow[]> {
  const { data, error } = await requireClient()
    .from('tasks')
    .select('id, title, description, status, priority, assigned_agent_id, due_at, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(100);
  return fail(error, data) as unknown as TaskRow[];
}

export async function createTask(input: {
  orgId: string;
  userId: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  agentId: string | null;
}): Promise<void> {
  const { error } = await requireClient().from('tasks').insert({
    organization_id: input.orgId,
    created_by: input.userId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    priority: input.priority,
    assigned_agent_id: input.agentId,
  });
  fail(error, null);
}

export async function setTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
  const patch: Record<string, unknown> = { status };
  if (status === 'running') patch.started_at = new Date().toISOString();
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    patch.completed_at = new Date().toISOString();
  }
  const { error } = await requireClient().from('tasks').update(patch).eq('id', taskId);
  fail(error, null);
}

export async function listPendingApprovals(orgId: string): Promise<ApprovalRow[]> {
  const { data, error } = await requireClient()
    .from('approvals')
    .select('id, action, payload, status, requested_at, agent_id, task_id')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  return fail(error, data) as unknown as ApprovalRow[];
}

export async function decideApproval(
  id: string,
  userId: string,
  status: 'approved' | 'rejected',
): Promise<void> {
  const { error } = await requireClient()
    .from('approvals')
    .update({ status, decided_by: userId, decided_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending');
  fail(error, null);
}

async function countRows(table: string, orgId: string): Promise<number> {
  const { count, error } = await requireClient()
    .from(table)
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', orgId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function loadCounts(orgId: string, canSeeUsage: boolean): Promise<OrgCounts> {
  const [memories, knowledgeSources, workflows] = await Promise.all([
    countRows('memories', orgId),
    countRows('knowledge_sources', orgId),
    countRows('workflows', orgId),
  ]);
  let tokens30d = 0;
  let cost30d = 0;
  if (canSeeUsage) {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { data, error } = await requireClient()
      .from('usage_events')
      .select('input_tokens, output_tokens, cost_usd')
      .eq('organization_id', orgId)
      .gte('created_at', since)
      .limit(10000);
    for (const r of fail(error, data) as unknown as {
      input_tokens: number;
      output_tokens: number;
      cost_usd: number | string;
    }[]) {
      tokens30d += r.input_tokens + r.output_tokens;
      cost30d += Number(r.cost_usd);
    }
  }
  return { memories, knowledgeSources, workflows, tokens30d, cost30d };
}
