import { requireClient } from './client';
import type {
  AgentRow,
  ApprovalRow,
  AuditRow,
  Autonomy,
  MemberRow,
  Membership,
  OrgCounts,
  OrgProfile,
  Role,
  TaskPriority,
  TaskRow,
  TaskStatus,
  ToolPolicy,
} from './types';
import type { AgentTemplate } from './templates';
import { slugify } from './types';

function fail<T>(error: { message: string } | null, data: T | null): T {
  if (error) throw new Error(error.message);
  return data as T;
}

export async function loadMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await requireClient()
    .from('organization_members')
    .select('role, organizations(id, name, slug, profile)')
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
    .select('id, name, slug, type, description, model, enabled, autonomous, autonomy, monthly_budget_usd, agent_tools(id, tool_name, enabled, policy)')
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
  dueAt?: string | null;
}): Promise<void> {
  const { error } = await requireClient().from('tasks').insert({
    organization_id: input.orgId,
    created_by: input.userId,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    priority: input.priority,
    assigned_agent_id: input.agentId,
    due_at: input.dueAt || null,
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
    .select('id, action, payload, status, requested_at, agent_id, task_id, risk, decision_note, decided_at')
    .eq('organization_id', orgId)
    .eq('status', 'pending')
    .order('requested_at', { ascending: false });
  return fail(error, data) as unknown as ApprovalRow[];
}

export async function decideApproval(
  id: string,
  userId: string,
  status: 'approved' | 'rejected',
  note?: string,
): Promise<void> {
  const { error } = await requireClient()
    .from('approvals')
    .update({ status, decided_by: userId, decided_at: new Date().toISOString(), decision_note: note?.trim() || null })
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

// ------------------------------------------------------------- agents & policy
export async function updateAgent(
  agentId: string,
  patch: Partial<{ enabled: boolean; autonomy: Autonomy; monthly_budget_usd: number | null; model: string; system_prompt: string }>,
): Promise<void> {
  const { error } = await requireClient().from('agents').update(patch).eq('id', agentId);
  fail(error, null);
}

export async function updateTool(
  toolId: string,
  patch: Partial<{ enabled: boolean; policy: ToolPolicy }>,
): Promise<void> {
  const { error } = await requireClient().from('agent_tools').update(patch).eq('id', toolId);
  fail(error, null);
}

export async function hireAgent(orgId: string, tpl: AgentTemplate): Promise<string> {
  const { data, error } = await requireClient().rpc('hire_agent', {
    p_org: orgId,
    p_name: tpl.name,
    p_slug: tpl.slug,
    p_type: 'custom',
    p_description: tpl.tagline,
    p_prompt: tpl.prompt,
    p_tools: tpl.tools.map((t) => ({ tool: t.tool, policy: t.policy ?? 'allow' })),
  });
  return fail(error, data as string | null);
}

/** Decision history per agent, used to suggest when an agent has earned more autonomy. */
export async function loadDecisionStats(orgId: string): Promise<Record<string, { approved: number; rejected: number }>> {
  const { data, error } = await requireClient()
    .from('approvals')
    .select('agent_id, status')
    .eq('organization_id', orgId)
    .in('status', ['approved', 'rejected'])
    .limit(2000);
  const out: Record<string, { approved: number; rejected: number }> = {};
  for (const r of fail(error, data) as unknown as { agent_id: string | null; status: 'approved' | 'rejected' }[]) {
    if (!r.agent_id) continue;
    const e = (out[r.agent_id] ??= { approved: 0, rejected: 0 });
    e[r.status] += 1;
  }
  return out;
}

/** Spend per agent since the start of the current month (managers and above). */
export async function loadMonthlySpend(orgId: string): Promise<Record<string, number>> {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const { data, error } = await requireClient()
    .from('usage_events')
    .select('agent_id, cost_usd')
    .eq('organization_id', orgId)
    .gte('created_at', start.toISOString())
    .limit(10000);
  const out: Record<string, number> = {};
  for (const r of fail(error, data) as unknown as { agent_id: string | null; cost_usd: number | string }[]) {
    if (r.agent_id) out[r.agent_id] = (out[r.agent_id] ?? 0) + Number(r.cost_usd);
  }
  return out;
}

// ------------------------------------------------------------------ approvals
export async function listApprovalHistory(orgId: string, limit = 50): Promise<ApprovalRow[]> {
  const { data, error } = await requireClient()
    .from('approvals')
    .select('id, action, payload, status, requested_at, agent_id, task_id, risk, decision_note, decided_at')
    .eq('organization_id', orgId)
    .neq('status', 'pending')
    .order('decided_at', { ascending: false, nullsFirst: false })
    .limit(limit);
  return fail(error, data) as unknown as ApprovalRow[];
}

// ---------------------------------------------------------------------- audit
export async function listAudit(orgId: string, limit = 200): Promise<AuditRow[]> {
  const { data, error } = await requireClient()
    .from('audit_log')
    .select('id, action, entity, actor_id, metadata, created_at')
    .eq('organization_id', orgId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return fail(error, data) as unknown as AuditRow[];
}

// --------------------------------------------------------------------- people
export async function listMembers(orgId: string): Promise<MemberRow[]> {
  const { data, error } = await requireClient().rpc('list_members', { p_org: orgId });
  return fail(error, data) as unknown as MemberRow[];
}

const MEMBER_ERRORS: Record<string, string> = {
  no_account: 'No Firbo AI account uses that email yet. Ask them to sign up first, then add them.',
  already_member: 'That person is already in this company.',
  'not allowed': 'Only owners and admins can do that.',
};

export async function addMemberByEmail(orgId: string, email: string, role: Role): Promise<void> {
  const { error } = await requireClient().rpc('add_member_by_email', { p_org: orgId, p_email: email, p_role: role });
  if (error) throw new Error(MEMBER_ERRORS[error.message] ?? error.message);
}

export async function setMemberRole(orgId: string, userId: string, role: Role): Promise<void> {
  const { error } = await requireClient()
    .from('organization_members')
    .update({ role })
    .eq('organization_id', orgId)
    .eq('user_id', userId);
  fail(error, null);
}

export async function removeMember(orgId: string, userId: string): Promise<void> {
  const { error } = await requireClient()
    .from('organization_members')
    .delete()
    .eq('organization_id', orgId)
    .eq('user_id', userId);
  fail(error, null);
}

// ----------------------------------------------------------------- onboarding
export async function saveOrgProfile(orgId: string, profile: OrgProfile): Promise<void> {
  const { error } = await requireClient().from('organizations').update({ profile }).eq('id', orgId);
  fail(error, null);
}

/** Company context becomes real, searchable memory that every agent can retrieve. */
export async function seedCompanyMemory(orgId: string, userId: string, profile: OrgProfile, companyName: string): Promise<void> {
  const rows = [
    profile.summary && { content: `${companyName}: ${profile.summary}`, memory_type: 'company', importance: 0.95 },
    profile.industry && { content: `${companyName} operates in: ${profile.industry}.`, memory_type: 'company', importance: 0.8 },
    profile.website && { content: `${companyName} website: ${profile.website}`, memory_type: 'company', importance: 0.6 },
    profile.goal && { content: `Primary goal right now: ${profile.goal}.`, memory_type: 'project', importance: 0.9 },
  ].filter(Boolean) as { content: string; memory_type: string; importance: number }[];
  if (rows.length === 0) return;
  const { error } = await requireClient()
    .from('memories')
    .insert(rows.map((r) => ({ ...r, organization_id: orgId, user_id: userId })));
  fail(error, null);
}

export async function setAllAutonomy(orgId: string, autonomy: Autonomy): Promise<void> {
  const { error } = await requireClient().from('agents').update({ autonomy }).eq('organization_id', orgId);
  fail(error, null);
}
