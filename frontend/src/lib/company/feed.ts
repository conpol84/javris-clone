import type { AgentRow, ApprovalRow, TaskRow } from './types';

export type FeedLevel = 'info' | 'ok' | 'warn' | 'err';

export interface FeedEvent {
  id: string;
  level: FeedLevel;
  tag: string;
  title: string;
  detail: string;
  at: number;
}

const OPEN = new Set(['pending', 'running', 'blocked', 'awaiting_approval']);

/** Build a "live intelligence" feed from real tasks and approvals (newest first). */
export function buildFeed(
  tasks: TaskRow[],
  approvals: ApprovalRow[],
  agents: AgentRow[],
  now: number = Date.now(),
  limit = 8,
): FeedEvent[] {
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? 'Unassigned';
  const events: FeedEvent[] = [];

  for (const a of approvals) {
    if (a.status !== 'pending') continue;
    events.push({
      id: `ap-${a.id}`,
      level: 'warn',
      tag: 'APPROVAL',
      title: `${name(a.agent_id)} needs approval: ${a.action}`,
      detail: 'Waiting for a manager',
      at: Date.parse(a.requested_at),
    });
  }

  for (const t of tasks) {
    const created = Date.parse(t.created_at);
    const due = t.due_at ? Date.parse(t.due_at) : null;
    if (OPEN.has(t.status) && due !== null && due < now) {
      events.push({
        id: `od-${t.id}`,
        level: 'warn',
        tag: 'OVERDUE',
        title: t.title,
        detail: `Was due ${new Date(due).toLocaleDateString()}`,
        at: due,
      });
      continue;
    }
    const level: FeedLevel =
      t.status === 'completed' ? 'ok' : t.status === 'failed' ? 'err' : t.status === 'blocked' ? 'warn' : 'info';
    events.push({
      id: `t-${t.id}`,
      level,
      tag: t.status.replace('_', ' ').toUpperCase(),
      title: t.title,
      detail: `${name(t.assigned_agent_id)} · ${t.priority}`,
      at: created,
    });
  }

  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function timeAgo(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}
