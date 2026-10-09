import type { AgentRow, TaskRow } from './types';

export type Verdict = 'promote' | 'steady' | 'coach' | 'idle';

export interface AgentReview {
  agentId: string;
  done: number;
  failed: number;
  open: number;
  approved: number;
  rejected: number;
  cost: number;
  /** 0..100, or null when there is nothing to judge yet. */
  score: number | null;
  verdict: Verdict;
}

export interface ReviewInput {
  agents: Pick<AgentRow, 'id' | 'autonomy'>[];
  tasks: Pick<TaskRow, 'assigned_agent_id' | 'status'>[];
  decisions: Record<string, { approved: number; rejected: number }>;
  /** USD spent per agent over the same period. */
  spend: Record<string, number>;
}

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * Transparent score: 40% finished-vs-failed, 30% how often people approve its proposals,
 * 20% cost per finished task against the team median, 10% volume. Missing evidence is neutral (0.7), never a penalty.
 */
export function reviewAgents({ agents, tasks, decisions, spend }: ReviewInput): AgentReview[] {
  const base = agents.map((a) => {
    const mine = tasks.filter((t) => t.assigned_agent_id === a.id);
    const done = mine.filter((t) => t.status === 'completed').length;
    const failed = mine.filter((t) => t.status === 'failed').length;
    const open = mine.filter((t) => ['pending', 'running', 'blocked', 'awaiting_approval'].includes(t.status)).length;
    const d = decisions[a.id] ?? { approved: 0, rejected: 0 };
    return { agent: a, done, failed, open, approved: d.approved, rejected: d.rejected, cost: spend[a.id] ?? 0 };
  });
  const perTask = base.filter((b) => b.done > 0 && b.cost > 0).map((b) => b.cost / b.done).sort((x, y) => x - y);
  const median = perTask.length ? perTask[Math.floor(perTask.length / 2)] : 0;
  const maxDone = Math.max(1, ...base.map((b) => b.done));

  return base.map((b) => {
    const finished = b.done + b.failed;
    const decided = b.approved + b.rejected;
    if (finished === 0 && decided === 0) {
      return { agentId: b.agent.id, done: b.done, failed: b.failed, open: b.open, approved: 0, rejected: 0, cost: b.cost, score: null, verdict: 'idle' as Verdict };
    }
    const completion = finished ? b.done / finished : 0.7;
    const approval = decided ? b.approved / decided : 0.7;
    const efficiency = b.done > 0 && b.cost > 0 && median > 0 ? clamp(1.5 - (b.cost / b.done) / median) : 0.7;
    const volume = b.done / maxDone;
    const score = Math.round(100 * (0.4 * completion + 0.3 * approval + 0.2 * efficiency + 0.1 * volume));
    let verdict: Verdict = 'steady';
    if (score >= 80 && b.done >= 5 && approval >= 0.8 && (b.agent.autonomy === 'suggest' || b.agent.autonomy === 'approval')) verdict = 'promote';
    else if (score < 50 && finished + decided >= 3) verdict = 'coach';
    return { agentId: b.agent.id, done: b.done, failed: b.failed, open: b.open, approved: b.approved, rejected: b.rejected, cost: b.cost, score, verdict };
  });
}
