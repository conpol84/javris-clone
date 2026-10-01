import type { AgentRow, ApprovalRow, TaskRow } from './types';

export type AgentState = 'active' | 'waiting' | 'idle' | 'disabled';

/** Department accent colours shared by the orb, office and cards. */
export const AGENT_COLORS: Record<string, string> = {
  ceo: '#f59e0b',
  research: '#22d3ee',
  sales: '#34d399',
  marketing: '#f472b6',
  operations: '#60a5fa',
  finance: '#a3e635',
  developer: '#a78bfa',
  custom: '#94a3b8',
};

export const agentColor = (type: string): string => AGENT_COLORS[type] ?? AGENT_COLORS.custom;

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

export const STATE_LABEL: Record<AgentState, string> = {
  active: 'Active',
  waiting: 'Awaiting approval',
  idle: 'Standby',
  disabled: 'Disabled',
};
