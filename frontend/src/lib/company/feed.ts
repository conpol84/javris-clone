import { defaultI18n } from '../../i18n/I18nProvider';
import type { I18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
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
  i18n: Pick<I18n, 't' | 'fmt'> = defaultI18n,
): FeedEvent[] {
  const { t, fmt } = i18n;
  const name = (id: string | null) => agents.find((a) => a.id === id)?.name ?? t('unassigned');
  const events: FeedEvent[] = [];

  for (const a of approvals) {
    if (a.status !== 'pending') continue;
    events.push({
      id: `ap-${a.id}`,
      level: 'warn',
      tag: t('feed.tag.approval'),
      title: t('feed.approvalTitle', { agent: name(a.agent_id), action: a.action }),
      detail: t('feed.waitingManager'),
      at: Date.parse(a.requested_at),
    });
  }

  for (const task of tasks) {
    const created = Date.parse(task.created_at);
    const due = task.due_at ? Date.parse(task.due_at) : null;
    if (OPEN.has(task.status) && due !== null && due < now) {
      events.push({
        id: `od-${task.id}`,
        level: 'warn',
        tag: t('feed.tag.overdue'),
        title: task.title,
        detail: t('feed.wasDue', { date: fmt.date(due) }),
        at: due,
      });
      continue;
    }
    const level: FeedLevel =
      task.status === 'completed' ? 'ok' : task.status === 'failed' ? 'err' : task.status === 'blocked' ? 'warn' : 'info';
    events.push({
      id: `t-${task.id}`,
      level,
      tag: t(`status.${task.status}` as TKey),
      title: task.title,
      detail: `${name(task.assigned_agent_id)} · ${t(`priority.${task.priority}` as TKey)}`,
      at: created,
    });
  }

  return events.sort((a, b) => b.at - a.at).slice(0, limit);
}

export function timeAgo(at: number, now: number = Date.now(), fmt: Pick<I18n, 'fmt'>['fmt'] = defaultI18n.fmt): string {
  return fmt.relative(at, now);
}
