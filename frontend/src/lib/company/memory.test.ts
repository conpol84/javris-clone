import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteMemory, memoriesReadBy, splitIntoNotes } from './memory';

const database = vi.hoisted(() => ({ from: vi.fn(), remove: vi.fn(), eq: vi.fn(), select: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => ({ from: database.from }) }));

describe('scoped memory deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const query = { delete: database.remove, eq: database.eq, select: database.select };
    database.from.mockReturnValue(query); database.remove.mockReturnValue(query); database.eq.mockReturnValue(query);
    database.select.mockResolvedValue({ data: [{ id: 'memory-a' }], error: null });
  });
  it('requires both company and memory ID before any database request', async () => {
    await expect(deleteMemory('', 'memory-a')).rejects.toThrow('memory_scope_required');
    await expect(deleteMemory('org-a', '')).rejects.toThrow('memory_scope_required');
    expect(database.from).not.toHaveBeenCalled();
  });
  it('adds the company predicate and requires exactly the deleted row read-back', async () => {
    await deleteMemory('org-a', 'memory-a');
    expect(database.from).toHaveBeenCalledExactlyOnceWith('memories');
    expect(database.eq.mock.calls).toEqual([['organization_id', 'org-a'], ['id', 'memory-a']]);
    expect(database.select).toHaveBeenCalledExactlyOnceWith('id');
  });
  it.each([null, [], [{ id: 'another-memory' }], [{ id: 'memory-a' }, { id: 'memory-a' }]].map(data => ({ data })))('does not report a zero/foreign/ambiguous result as deleted: $data', async ({ data }) => {
    database.select.mockResolvedValue({ data, error: null });
    await expect(deleteMemory('org-a', 'memory-a')).rejects.toThrow('memory_not_changed');
  });
  it('retains database permission failure', async () => {
    database.select.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    await expect(deleteMemory('org-a', 'memory-a')).rejects.toThrow('permission denied');
  });
});

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

describe('splitIntoNotes (files uploaded to memory)', () => {
  it('returns nothing for empty text', () => {
    expect(splitIntoNotes('   \n\n  ')).toEqual([]);
  });
  it('keeps short paragraphs together up to the limit', () => {
    const notes = splitIntoNotes('First idea.\n\nSecond idea.\n\nThird idea.', 900);
    expect(notes).toEqual(['First idea. Second idea. Third idea.']);
  });
  it('starts a new note when the limit would be exceeded', () => {
    const a = 'a'.repeat(600);
    const b = 'b'.repeat(600);
    expect(splitIntoNotes(`${a}\n\n${b}`, 900)).toEqual([a, b]);
  });
  it('splits an overlong paragraph and never exceeds the limit', () => {
    const notes = splitIntoNotes('x'.repeat(2500), 900);
    expect(notes.length).toBe(3);
    expect(notes.every((n) => n.length <= 900)).toBe(true);
  });
  it('caps the number of notes', () => {
    const text = Array.from({ length: 60 }, (_, i) => `${'n'.repeat(800)} ${i}`).join('\n\n');
    expect(splitIntoNotes(text, 900, 20)).toHaveLength(20);
  });
  it('normalises Windows line endings', () => {
    expect(splitIntoNotes('one\r\n\r\ntwo')).toEqual(['one two']);
  });
});

