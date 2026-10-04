import { defaultI18n } from '../../i18n/I18nProvider';
import type { I18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { safeAutonomy, type AuditRow } from './types';

export type AuditGroup = 'approvals' | 'agents' | 'tasks' | 'people' | 'company';
export type AuditTone = 'info' | 'ok' | 'warn' | 'err';

export interface AuditLookup {
  agent: (id: unknown) => string;
  person: (id: unknown) => string;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v ? v : fallback);

/** Turn a raw audit row into a human sentence. Unknown actions degrade to the raw action name. */
export function describeAudit(
  row: AuditRow,
  who: AuditLookup,
  i18n: Pick<I18n, 't' | 'fmt'> = defaultI18n,
): { text: string; tone: AuditTone; group: AuditGroup } {
  const { t, fmt } = i18n;
  const m = row.metadata ?? {};
  const actor = row.actor_id ? who.person(row.actor_id) : t('audit.actor.agent');
  const action = str(m.action, t('audit.action.fallback'));
  const agentName = str(m.name, t('audit.agent.fallback'));
  const roleOf = (r: unknown, fb = 'member') => t(`role.${str(r, fb)}` as TKey);
  switch (row.action) {
    case 'approval.requested':
      return { group: 'approvals', tone: 'warn', text: t('audit.approval.requested', { agent: who.agent(m.agent_id), action }) };
    case 'approval.approved':
    case 'approval.rejected': {
      const approved = row.action === 'approval.approved';
      const base = approved ? 'audit.approval.approved' : 'audit.approval.rejected';
      return {
        group: 'approvals',
        tone: approved ? 'ok' : 'err',
        text: m.note ? t(`${base}Note` as TKey, { actor, action, note: str(m.note) }) : t(base as TKey, { actor, action }),
      };
    }
    case 'approval.expired':
      return { group: 'approvals', tone: 'info', text: t('audit.approval.expired', { action }) };
    case 'agent.hired':
      return { group: 'agents', tone: 'ok', text: t('audit.agent.hired', { actor, name: agentName }) };
    case 'agent.removed':
      return { group: 'agents', tone: 'warn', text: t('audit.agent.removed', { actor, name: agentName }) };
    case 'agent.updated': {
      const changed = Array.isArray(m.changed) ? (m.changed as string[]) : [];
      const detail = changed
        .map((c) =>
          c === 'enabled'
            ? t(m.enabled ? 'audit.change.enabled' : 'audit.change.disabled')
            : c === 'autonomy'
              ? t('audit.change.autonomy', { value: t(`autonomy.${safeAutonomy(str(m.autonomy))}.short` as TKey) })
              : c === 'budget'
                ? t('audit.change.budget', { value: m.budget == null ? t('audit.change.noLimit') : fmt.currency(Number(m.budget)) })
                : c === 'model' || c === 'prompt'
                  ? t(`audit.change.${c}` as TKey)
                  : c,
        )
        .join(', ');
      return { group: 'agents', tone: 'info', text: t('audit.agent.updated', { actor, name: agentName, detail: detail || t('audit.change.settings') }) };
    }
    case 'tool.updated':
      return {
        group: 'agents',
        tone: m.policy === 'block' ? 'warn' : 'info',
        text: t('audit.tool.updated', {
          actor,
          tool: str(m.tool, t('audit.tool.fallback')),
          policy: m.enabled === false ? t('audit.tool.disabled') : t(`policy.${str(m.policy, 'allow')}` as TKey),
          agent: who.agent(m.agent_id),
        }),
      };
    case 'task.created':
      return { group: 'tasks', tone: 'info', text: t('audit.task.created', { actor, title: str(m.title, t('audit.task.untitled')) }) };
    case 'org.created':
      return { group: 'company', tone: 'ok', text: m.name ? t('audit.org.createdNamed', { actor, name: str(m.name) }) : t('audit.org.created', { actor }) };
    case 'member.added':
      return { group: 'people', tone: 'ok', text: t('audit.member.added', { actor, person: who.person(m.user_id), role: roleOf(m.role) }) };
    case 'member.removed':
      return { group: 'people', tone: 'warn', text: t('audit.member.removed', { actor, person: who.person(m.user_id), role: roleOf(m.role) }) };
    case 'member.role_changed':
      return { group: 'people', tone: 'info', text: t('audit.member.roleChanged', { actor, person: who.person(m.user_id), from: roleOf(m.from), to: roleOf(m.to) }) };
    default:
      if (row.action.startsWith('task.')) {
        const status = row.action.slice(5);
        const key = `audit.taskstate.${status}` as TKey;
        return {
          group: 'tasks',
          tone: status === 'completed' ? 'ok' : status === 'failed' ? 'err' : 'info',
          text: t('audit.task.status', { title: str(m.title, t('audit.task.untitled')), status: i18n.t(key) === key ? status.replace('_', ' ') : t(key) }),
        };
      }
      return { group: 'company', tone: 'info', text: row.action };
  }
}
