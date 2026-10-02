import type { AgentRow, ApprovalRow, TaskRow } from './types';

export type AgentState = 'active' | 'waiting' | 'idle' | 'disabled';

/** Department accent colours shared by the orb, office and cards. */
export const AGENT_COLORS: Record<string, string> = {
  ceo: '#f59e0b',
  research: '#00f58a',
  sales: '#00d97a',
  marketing: '#f472b6',
  operations: '#60a5fa',
  finance: '#b6ff3b',
  developer: '#a78bfa',
  custom: '#94a3b8',
};

import type { TKey } from '../../i18n/locales/en';
import { AGENT_TEMPLATES } from './templates';

const FALLBACK = ['#00f58a', '#a78bfa', '#00d97a', '#f472b6', '#fbbf24', '#60a5fa', '#fb923c', '#c084fc'];

/** Known departments keep their colour; hired templates use theirs; anything else gets a stable colour. */
export function agentColor(type: string, slug = ''): string {
  if (AGENT_COLORS[type] && type !== 'custom') return AGENT_COLORS[type];
  const tpl = AGENT_TEMPLATES.find((t) => slug === t.slug || slug.startsWith(`${t.slug}-`));
  if (tpl) return tpl.color;
  let h = 0;
  for (const ch of slug || type) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FALLBACK[h % FALLBACK.length];
}

/**
 * Derive a live state per agent from real task/approval rows:
 * running task => active, pending approval or awaiting_approval task => waiting.
 */
export function deriveAgentStates(
  agents: AgentRow[],
  tasks: TaskRow[],
  approvals: ApprovalRow[],
): Record<string, AgentState> {
  const running = new Set<string>();
  const waiting = new Set<string>();
  for (const t of tasks) {
    if (!t.assigned_agent_id) continue;
    if (t.status === 'running') running.add(t.assigned_agent_id);
    if (t.status === 'awaiting_approval') waiting.add(t.assigned_agent_id);
  }
  for (const a of approvals) {
    if (a.status === 'pending' && a.agent_id) waiting.add(a.agent_id);
  }
  const out: Record<string, AgentState> = {};
  for (const agent of agents) {
    out[agent.id] = !agent.enabled
      ? 'disabled'
      : running.has(agent.id)
        ? 'active'
        : waiting.has(agent.id)
          ? 'waiting'
          : 'idle';
  }
  return out;
}

export const STATE_KEY = {
  active: 'state.active',
  waiting: 'state.waiting',
  idle: 'state.idle',
  disabled: 'state.disabled',
} as const satisfies Record<AgentState, TKey>;
