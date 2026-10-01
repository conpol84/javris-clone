import { describe, expect, it } from 'vitest';
import { describeAudit } from './audit';
import type { AuditRow } from './types';

const who = {
  agent: (id: unknown) => (id === 'a1' ? 'Sales Agent' : 'An agent'),
  person: (id: unknown) => (id === 'u1' ? 'Ana' : id === 'u2' ? 'Ben' : 'Someone'),
};
const row = (action: string, metadata: Record<string, unknown> = {}, actor: string | null = 'u1'): AuditRow => ({
  id: 'x', action, entity: null, actor_id: actor, metadata, created_at: '2026-10-01T00:00:00Z',
});

describe('describeAudit', () => {
  it('describes approval decisions with the reviewer note', () => {
    const d = describeAudit(row('approval.approved', { action: 'send_email', note: 'ok' }), who);
    expect(d).toEqual({ group: 'approvals', tone: 'ok', text: 'Ana approved "send_email" — “ok”' });
    expect(describeAudit(row('approval.rejected', { action: 'deploy' }), who).tone).toBe('err');
  });

  it('attributes agent-originated events to the agent, not a person', () => {
    const d = describeAudit(row('approval.requested', { agent_id: 'a1', action: 'send_email' }, null), who);
    expect(d.text).toBe('Sales Agent asked for approval: send_email');
  });

  it('summarises agent setting changes', () => {
    const d = describeAudit(row('agent.updated', { name: 'Sales', changed: ['autonomy', 'budget', 'enabled'], autonomy: 'notify', budget: 50, enabled: false }), who);
    expect(d.text).toBe('Ana updated Sales: autonomy → notify, budget → $50, disabled');
    expect(describeAudit(row('agent.updated', { name: 'S', changed: ['budget'], budget: null }), who).text).toContain('no limit');
  });

  it('flags blocked tools and describes people changes', () => {
    expect(describeAudit(row('tool.updated', { tool: 'shell_exec', policy: 'block', agent_id: 'a1' }), who)).toMatchObject({ tone: 'warn', group: 'agents' });
    expect(describeAudit(row('member.role_changed', { user_id: 'u2', from: 'member', to: 'admin' }), who).text).toBe('Ana changed Ben from member to admin');
  });

  it('handles task transitions and unknown actions without throwing', () => {
    expect(describeAudit(row('task.completed', { title: 'Report' }), who)).toMatchObject({ tone: 'ok', text: 'Task “Report” completed' });
    expect(describeAudit(row('task.awaiting_approval', { title: 'X' }), who).text).toContain('awaiting approval');
    expect(describeAudit(row('something.new'), who)).toEqual({ group: 'company', tone: 'info', text: 'something.new' });
    expect(describeAudit({ ...row('agent.hired'), metadata: undefined as never }, who).text).toBe('Ana hired an agent');
  });
});
