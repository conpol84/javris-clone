import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDeliverable, needsPolish, slidesIn, deliverableInstructions, requestedSlideCount } from '../../supabase/functions/_shared/deliverables.ts';

test('the work product is recognised from the task, in several languages', () => {
  assert.equal(detectDeliverable('Φτιάξε παρουσίαση για τους επενδυτές'), 'presentation');
  assert.equal(detectDeliverable('Prepare a pitch deck for Q4'), 'presentation');
  assert.equal(detectDeliverable('Ανάλυση', 'θέλω 10 διαφάνειες'), 'presentation');
  assert.equal(detectDeliverable('Γράψε email στον προμηθευτή'), 'memo');
  assert.equal(detectDeliverable('Draft a letter to customers'), 'memo');
  assert.equal(detectDeliverable('Έρευνα ανταγωνισμού στην Αθήνα'), 'report');
  assert.equal(detectDeliverable('Πρωινή ενημέρωση'), 'report');
  // A description mentioning an email does not turn a research task into a message.
  assert.equal(detectDeliverable('Market research', 'send me the result by email'), 'report');
});

test('slides are split on --- lines and must have a title', () => {
  const deck = '# One\n- a\n---\n# Two\n- b\n\n---\n\nno title here\n---\n# Three';
  assert.deepEqual(slidesIn(deck).map(s => s.split('\n')[0]), ['# One', '# Two', '# Three']);
});

test('a short or unstructured draft gets the quality pass, a real one does not', () => {
  assert.equal(needsPolish('report', 'Βρέθηκαν 2 αρχεία.'), true);
  const full = ['## Executive summary', 'x'.repeat(700), '## Findings', 'y'.repeat(700), '## Recommendations', 'z'.repeat(600)].join('\n');
  assert.equal(needsPolish('report', full), false);
  assert.equal(needsPolish('presentation', '# A\n---\n# B'), true);
  assert.equal(needsPolish('presentation', Array.from({ length: 8 }, (_, i) => `# Slide ${i}\n- point`).join('\n---\n')), false);
  assert.equal(needsPolish('memo', 'Subject: Hi\n\n' + 'Dear partner, '.repeat(30)), false);
});

test('each deliverable carries its own standard', () => {
  assert.match(deliverableInstructions('report'), /Executive summary/);
  assert.match(deliverableInstructions('presentation'), /---/);
  assert.match(deliverableInstructions('memo'), /Subject/);
});

test('the title decides: an analysis that will become slides later is still a report', () => {
  assert.equal(detectDeliverable('Ανάλυση ανταγωνισμού: εφαρμογές player trading', 'Το αποτέλεσμα θα γίνει μετά παρουσίαση για τη διοίκηση.'), 'report');
  assert.equal(detectDeliverable('Q4 για τη διοίκηση', 'Φτιάξε παρουσίαση 10 διαφανειών'), 'presentation');
  assert.equal(detectDeliverable('Παρουσίαση: ανάλυση αγοράς'), 'presentation');
});

test('an explicit slide count becomes an exact generation and polish contract', () => {
  assert.equal(requestedSlideCount('Presentation: Q4 — 10 slides'), 10);
  assert.equal(requestedSlideCount('Παρουσίαση', 'Φτιάξε 12 διαφάνειες για τη διοίκηση'), 12);
  assert.equal(requestedSlideCount('Deck', 'presentation with 8 slides'), 8);
  assert.equal(requestedSlideCount('Presentation', 'make it concise'), null);
  assert.equal(requestedSlideCount('Presentation', '100 slides'), null);
  assert.match(deliverableInstructions('presentation', 10), /exactly 10 slides/);
  const eight = Array.from({ length: 8 }, (_, i) => `# Slide ${i + 1}\n- point`).join('\n---\n');
  const ten = Array.from({ length: 10 }, (_, i) => `# Slide ${i + 1}\n- point`).join('\n---\n');
  assert.equal(needsPolish('presentation', eight, 10), true);
  assert.equal(needsPolish('presentation', ten, 10), false);
});
