import { describe, expect, it } from 'vitest';
import { ownerVisibleMemory } from '../../../../supabase/functions/_shared/memory-visibility';

describe('SG-MEM-01 fail-closed CEO memory isolation', () => {
  const rows = [
    { id: 'private-a', user_id: 'user-a', metadata: {} },
    { id: 'private-b', user_id: 'user-b', metadata: {} },
    { id: 'legacy-null', user_id: null, metadata: {} },
    { id: 'forged-company', user_id: 'user-b', metadata: { visibility: 'company' } },
    { id: 'forged-null', user_id: null, metadata: { visibility: 'company' } },
    { id: 'agent-global', user_id: null, metadata: { agent_id: null } },
  ];
  it('returns only memories owned by the authenticated user', () => {
    expect(ownerVisibleMemory(rows, 'user-a').map(r => r.id)).toEqual(['private-a']);
    expect(ownerVisibleMemory(rows, 'user-b').map(r => r.id)).toEqual(['private-b', 'forged-company']);
  });
  it('treats NULL owner and forged company visibility as unauthorized', () => {
    expect(ownerVisibleMemory(rows, 'user-a').some(r => r.id.includes('null') || r.id === 'forged-company')).toBe(false);
  });
  it('rejects missing authentication rather than accepting ownerless records', () => {
    expect(ownerVisibleMemory(rows, '')).toEqual([]);
  });
  it('does not mutate source records', () => {
    const before = JSON.stringify(rows);
    ownerVisibleMemory(rows, 'user-a');
    expect(JSON.stringify(rows)).toBe(before);
  });
});
