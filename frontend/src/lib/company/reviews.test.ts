import { describe, expect, it } from 'vitest';
import { reviewAgents } from './reviews';

const mk = (id: string, status: string) => ({ assigned_agent_id: id, status }) as never;

describe('reviewAgents', () => {
  it('marks agents with no evidence as idle with no score', () => {
    const r = reviewAgents({ agents: [{ id: 'a', autonomy: 'approval' }], tasks: [], decisions: {}, spend: {} });
    expect(r[0]).toMatchObject({ score: null, verdict: 'idle' });
  });
  it('recommends promotion for a reliable, approved agent', () => {
    const tasks = Array.from({ length: 6 }, () => mk('a', 'completed'));
    const r = reviewAgents({ agents: [{ id: 'a', autonomy: 'approval' }], tasks, decisions: { a: { approved: 9, rejected: 0 } }, spend: { a: 0.3 } });
    expect(r[0].verdict).toBe('promote');
    expect(r[0].score).toBeGreaterThanOrEqual(80);
  });
  it('never promotes an agent that already runs on auto', () => {
    const tasks = Array.from({ length: 6 }, () => mk('a', 'completed'));
    const r = reviewAgents({ agents: [{ id: 'a', autonomy: 'auto' }], tasks, decisions: { a: { approved: 9, rejected: 0 } }, spend: {} });
    expect(r[0].verdict).toBe('steady');
  });
  it('flags an agent that keeps failing and being rejected for coaching', () => {
    const tasks = [mk('a', 'failed'), mk('a', 'failed'), mk('a', 'completed')];
    const r = reviewAgents({ agents: [{ id: 'a', autonomy: 'approval' }], tasks, decisions: { a: { approved: 0, rejected: 3 } }, spend: {} });
    expect(r[0].verdict).toBe('coach');
  });
});
