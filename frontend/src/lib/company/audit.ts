import type { AuditRow } from './types';

export type AuditGroup = 'approvals' | 'agents' | 'tasks' | 'people' | 'company';
export type AuditTone = 'info' | 'ok' | 'warn' | 'err';

export interface AuditLookup {
  agent: (id: unknown) => string;
  person: (id: unknown) => string;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' && v ? v : fallback);

/** Turn a raw audit row into a human sentence. Unknown actions degrade to the raw action name. */
export function describeAudit(row: AuditRow, who: AuditLookup): { text: string; tone: AuditTone; group: AuditGroup } {
  const m = row.metadata ?? {};
  const actor = row.actor_id ? who.person(row.actor_id) : 'An agent';
  switch (row.action) {
    case 'approval.requested':
      return { group: 'approvals', tone: 'warn', text: `${who.agent(m.agent_id)} asked for approval: ${str(m.action, 'an action')}` };
    case 'approval.approved':
      return { group: 'approvals', tone: 'ok', text: `${actor} approved "${str(m.action, 'an action')}"${m.note ? ` — “${str(m.note)}”` : ''}` };
    case 'approval.rejected':
      return { group: 'approvals', tone: 'err', text: `${actor} rejected "${str(m.action, 'an action')}"${m.note ? ` — “${str(m.note)}”` : ''}` };
    case 'approval.expired':
      return { group: 'approvals', tone: 'info', text: `Approval for "${str(m.action, 'an action')}" expired` };
    case 'agent.hired':
      return { group: 'agents', tone: 'ok', text: `${actor} hired ${str(m.name, 'an agent')}` };
    case 'agent.removed':
      return { group: 'agents', tone: 'warn', text: `${actor} removed ${str(m.name, 'an agent')}` };
    case 'agent.updated': {
      const changed = Array.isArray(m.changed) ? (m.changed as string[]) : [];
      const detail = changed
        .map((c) =>
          c === 'enabled' ? (m.enabled ? 'enabled' : 'disabled') : c === 'autonomy' ? `autonomy → ${str(m.autonomy)}` : c === 'budget' ? `budget → ${m.budget == null ? 'no limit' : `$${m.budget}`}` : c,
        )
        .join(', ');
      return { group: 'agents', tone: 'info', text: `${actor} updated ${str(m.name, 'an agent')}: ${detail || 'settings'}` };
    }
    case 'tool.updated':
      return {
        group: 'agents',
        tone: m.policy === 'block' ? 'warn' : 'info',
        text: `${actor} set ${str(m.tool, 'a tool')} to ${m.enabled === false ? 'disabled' : str(m.policy, 'allow')} for ${who.agent(m.agent_id)}`,
      };
    case 'task.created':
      return { group: 'tasks', tone: 'info', text: `${actor} created task “${str(m.title, 'Untitled')}”` };
    case 'org.created':
      return { group: 'company', tone: 'ok', text: `${actor} created the company${m.name ? ` “${str(m.name)}”` : ''}` };
    case 'member.added':
      return { group: 'people', tone: 'ok', text: `${actor} added ${who.person(m.user_id)} as ${str(m.role, 'member')}` };
    case 'member.removed':
      return { group: 'people', tone: 'warn', text: `${actor} removed ${who.person(m.user_id)} (${str(m.role, 'member')})` };
    case 'member.role_changed':
      return { group: 'people', tone: 'info', text: `${actor} changed ${who.person(m.user_id)} from ${str(m.from)} to ${str(m.to)}` };
    default:
      if (row.action.startsWith('task.')) {
        const status = row.action.slice(5).replace('_', ' ');
        return {
          group: 'tasks',
          tone: status === 'completed' ? 'ok' : status === 'failed' ? 'err' : 'info',
          text: `Task “${str(m.title, 'Untitled')}” ${status}`,
        };
      }
      return { group: 'company', tone: 'info', text: row.action };
  }
}
