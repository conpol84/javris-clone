import { describe, expect, it } from 'vitest';
import { memoriesReadBy, splitIntoNotes } from './memory';

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
