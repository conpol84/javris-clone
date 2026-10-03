import { describe, expect, it } from 'vitest';
import { memoriesReadBy } from './memory';

const m = (id: string, agent: string | null, importance: number) => ({ id, agent_id: agent, importance });

describe('memoriesReadBy', () => {
  it('reads company-wide and its own memories, never another agent’s', () => {
    const items = [m('a', null, 0.5), m('b', 'x', 0.9), m('c', 'y', 1), m('d', null, 0.2)];
    expect(memoriesReadBy('x', items).map((i) => i.id)).toEqual(['b', 'a', 'd']);
  });
  it('keeps only the most important ones', () => {
    const items = Array.from({ length: 20 }, (_, i) => m(String(i), null, i / 20));
    const out = memoriesReadBy('x', items, 12);
    expect(out).toHaveLength(12);
    expect(out[0].id).toBe('19');
  });
  it('does not change the original order', () => {
    const items = [m('a', null, 0.1), m('b', null, 0.9)];
    memoriesReadBy('x', [...items]);
    expect(items.map((i) => i.id)).toEqual(['a', 'b']);
  });
});
