import { describe, expect, it } from 'vitest';
import { buildFeed, timeAgo } from './feed';
import { deriveAgentStates } from './status';
import type { AgentRow, ApprovalRow, TaskRow } from './types';

const agent = (id: string, enabled = true): AgentRow => ({
  id,
  name: `Agent ${id}`,
  slug: id,
  type: 'custom',
  description: null,
  model: 'auto',
  enabled,
  autonomous: false,
  autonomy: 'approval',
  monthly_budget_usd: null,
  agent_tools: [],
});
const task = (over: Partial<TaskRow>): TaskRow => ({
  id: 't',
  title: 'T',
  description: null,
  status: 'pending',
  priority: 'normal',
  assigned_agent_id: null,
  due_at: null,
  created_at: '2026-10-01T10:00:00Z',
  ...over,
});
const approval = (over: Partial<ApprovalRow>): ApprovalRow => ({
  id: 'a',
  action: 'send_email',
  payload: {},
  status: 'pending',
  requested_at: '2026-10-01T11:00:00Z',
  agent_id: null,
  task_id: null,
  risk: 'medium',
  decision_note: null,
  decided_at: null,
  ...over,
});

describe('deriveAgentStates', () => {
  it('maps running, waiting, idle and disabled from real rows', () => {
    const states = deriveAgentStates(
      [agent('1'), agent('2'), agent('3'), agent('4', false)],
      [task({ id: 'x', status: 'running', assigned_agent_id: '1' }), task({ id: 'y', status: 'awaiting_approval', assigned_agent_id: '2' })],
      [],
    );
    expect(states).toEqual({ '1': 'active', '2': 'waiting', '3': 'idle', '4': 'disabled' });
  });

  it('treats a pending approval as waiting but ignores decided ones', () => {
    const s = deriveAgentStates(
      [agent('1'), agent('2')],
      [],
      [approval({ agent_id: '1' }), approval({ id: 'b', agent_id: '2', status: 'approved' })],
    );
    expect(s).toEqual({ '1': 'waiting', '2': 'idle' });
  });

  it('running wins over waiting', () => {
    const s = deriveAgentStates(
      [agent('1')],
      [task({ id: 'a', status: 'running', assigned_agent_id: '1' }), task({ id: 'b', status: 'awaiting_approval', assigned_agent_id: '1' })],
      [],
    );
    expect(s['1']).toBe('active');
  });
});

describe('buildFeed', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');

  it('orders newest first and flags approvals and overdue tasks', () => {
    const feed = buildFeed(
      [
        task({ id: '1', title: 'Old overdue', status: 'pending', due_at: '2026-09-30T00:00:00Z' }),
        task({ id: '2', title: 'Done', status: 'completed', created_at: '2026-10-01T09:00:00Z' }),
      ],
      [approval({ agent_id: '1' })],
      [agent('1')],
      now,
    );
    expect(feed.map((e) => e.tag)).toEqual(['Approval', 'Completed', 'Overdue']);
    expect(feed[0].level).toBe('warn');
    expect(feed[1].level).toBe('ok');
  });

  it('does not report completed tasks as overdue', () => {
    const feed = buildFeed([task({ status: 'completed', due_at: '2020-01-01T00:00:00Z' })], [], [], now);
    expect(feed[0].tag).toBe('Completed');
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => task({ id: String(i), created_at: `2026-10-01T0${i % 10}:00:00Z` }));
    expect(buildFeed(many, [], [], now, 5)).toHaveLength(5);
  });

  it('formats relative time', () => {
    expect(timeAgo(now - 10_000, now)).toBe('now');
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5 min. ago');
    expect(timeAgo(now - 3 * 3_600_000, now)).toBe('3 hr. ago');
    expect(timeAgo(now - 2 * 86_400_000, now)).toBe('2 days ago');
  });
});
