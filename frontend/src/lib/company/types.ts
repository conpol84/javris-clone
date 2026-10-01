export type Role = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';

export interface OrgProfile {
  onboarded?: boolean;
  goal?: string;
  industry?: string;
  website?: string;
  summary?: string;
}

export interface Membership {
  role: Role;
  organization: { id: string; name: string; slug: string; profile: OrgProfile };
}

export type Autonomy = 'suggest' | 'approval' | 'notify' | 'auto';
export type ToolPolicy = 'allow' | 'approval' | 'block';

export interface AgentToolRow {
  id: string;
  tool_name: string;
  enabled: boolean;
  policy: ToolPolicy;
}

export interface AgentRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  description: string | null;
  model: string;
  enabled: boolean;
  autonomous: boolean;
  autonomy: Autonomy;
  monthly_budget_usd: number | null;
  agent_tools: AgentToolRow[];
}

export type TaskStatus =
  | 'pending'
  | 'running'
  | 'blocked'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

/** What the agent runner stores on a finished task. */
export interface TaskResult {
  ai_generated?: boolean;
  summary?: string;
  report?: string;
  actions?: { action: string; risk: string; payload: Record<string, unknown> }[];
  queued?: number;
  dropped?: string[];
  error?: string;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assigned_agent_id: string | null;
  due_at: string | null;
  created_at: string;
  result?: TaskResult | null;
}

export interface ApprovalRow {
  id: string;
  action: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  requested_at: string;
  agent_id: string | null;
  task_id: string | null;
  risk: 'low' | 'medium' | 'high';
  decision_note: string | null;
  decided_at: string | null;
}

export interface AuditRow {
  id: string;
  action: string;
  entity: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface MemberRow {
  user_id: string;
  role: Role;
  joined_at: string;
  full_name: string | null;
  email: string | null;
}

export interface OrgCounts {
  memories: number;
  knowledgeSources: number;
  workflows: number;
  tokens30d: number;
  cost30d: number;
}

export const MANAGER_ROLES: Role[] = ['owner', 'admin', 'manager'];
export const WRITER_ROLES: Role[] = ['owner', 'admin', 'manager', 'member'];
export const OPEN_TASK_STATUSES: TaskStatus[] = [
  'pending',
  'running',
  'blocked',
  'awaiting_approval',
];

export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : 'company';
}
