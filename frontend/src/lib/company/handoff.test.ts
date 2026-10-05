import { describe, expect, it } from 'vitest';
import { handoffLink, parseHandoff } from './handoff';

const id = '11111111-2222-3333-4444-555555555555';
describe('parseHandoff', () => {
  it('splits the reply text from the hand-over', () => {
    const out = parseHandoff(`Το έκανε ο Research Agent.\n\n[[ask:${id}]] Ποιες πηγές διάβασες;`);
    expect(out.text).toBe('Το έκανε ο Research Agent.');
    expect(out.ask).toEqual({ agentId: id, question: 'Ποιες πηγές διάβασες;' });
    expect(handoffLink(out.ask!)).toBe(`/chat?ask=${id}&q=${encodeURIComponent('Ποιες πηγές διάβασες;').replace(/%20/g, '+')}`);
  });
  it('leaves normal replies alone', () => {
    expect(parseHandoff('Γεια σου')).toEqual({ text: 'Γεια σου', ask: null });
  });
});
