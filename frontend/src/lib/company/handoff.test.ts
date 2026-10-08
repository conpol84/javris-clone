import { describe, expect, it } from 'vitest';
import { handoffLink, meetingLink, parseHandoff, workSourceLink } from './handoff';

const id = '11111111-2222-3333-4444-555555555555';
describe('parseHandoff', () => {
  it('splits the reply text from the hand-over', () => {
    const out = parseHandoff(`Το έκανε ο Research Agent.\n\n[[ask:${id}]] Ποιες πηγές διάβασες;`);
    expect(out.text).toBe('Το έκανε ο Research Agent.');
    expect(out.ask).toEqual({ agentId: id, question: 'Ποιες πηγές διάβασες;' });
    expect(handoffLink(out.ask!)).toBe(`/chat?ask=${id}&q=${encodeURIComponent('Ποιες πηγές διάβασες;').replace(/%20/g, '+')}`);
  });
  it('leaves normal replies alone', () => {
    expect(parseHandoff('Γεια σου')).toEqual({ text: 'Γεια σου', ask: null, task: null, meet: null, app: null });
  });
  it('reads a task the CEO gives an employee', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    expect(parseHandoff(`Θα το αναθέσω.\n\n[[task:${id}]] Παρουσίαση: αγορά 2026\n10 διαφάνειες`)).toEqual({
      text: 'Θα το αναθέσω.', ask: null, meet: null, app: null, task: { agentId: id, title: 'Παρουσίαση: αγορά 2026', details: '10 διαφάνειες' } });
  });
  it('reads a task and a meeting in the same reply', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const out = parseHandoff(`Ναι.\n\n[[task:${id}]] Παρουσίαση: Δ΄ τρίμηνο\n10 διαφάνειες\n\n[[meet:${id}]] Τιμές`);
    expect(out.text).toBe('Ναι.');
    expect(out.task).toEqual({ agentId: id, title: 'Παρουσίαση: Δ΄ τρίμηνο', details: '10 διαφάνειες' });
    expect(out.meet).toEqual({ topic: 'Τιμές', participants: [id] });
  });
  it('reads a meeting the CEO calls and builds its link', () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const out = parseHandoff(`Ας το συζητήσουμε.\n\n[[meet:${id}]] Πλάνο Δ΄ τριμήνου`);
    expect(out.meet).toEqual({ topic: 'Πλάνο Δ΄ τριμήνου', participants: [id] });
    expect(out.text).toBe('Ας το συζητήσουμε.');
    expect(meetingLink(out.meet!)).toBe(`/missions?meet=${encodeURIComponent('Πλάνο Δ΄ τριμήνου').replace(/%20/g, '+')}&with=${id}`);
    expect(parseHandoff('Ναι.\n\n[[meet:]] Τιμές').meet).toEqual({ topic: 'Τιμές', participants: [] });
  });
  it('reads a whitelisted work-source suggestion and opens only its setup page', () => {
    const out = parseHandoff('Τα αρχεία της ομάδας θα βοηθήσουν.\n\n[[app:gdrive_read]] Θα βρίσκουμε τα εγκεκριμένα brief.');
    expect(out.text).toBe('Τα αρχεία της ομάδας θα βοηθήσουν.');
    expect(out.app).toEqual({ kind: 'gdrive_read', name: 'Google Drive · read', reason: 'Θα βρίσκουμε τα εγκεκριμένα brief.' });
    expect(workSourceLink(out.app!)).toBe('/integrations?connect=gdrive_read');
  });
  it('strips an unknown app marker without offering a connection', () => {
    const out = parseHandoff('Χρειάζεται πηγή.\n\n[[app:made_up]] Δοκίμασέ το.');
    expect(out).toEqual({ text: 'Χρειάζεται πηγή.', ask: null, task: null, meet: null, app: null });
  });
});
