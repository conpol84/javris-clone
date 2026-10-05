import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resultParts, pickFocusTask, taskBriefing } from '../../supabase/functions/_shared/task-briefing.ts';

const names = new Map([['r', 'Research Agent'], ['d', 'Data Analyst']]);
const greek = { title: 'Βρες τα 3 κύρια νέα για την αγορά των αθλητικών προϊόντων', status: 'completed', assigned_agent_id: 'r', completed_at: '2026-10-04T19:44:41Z',
  result: { summary: 'Τρία νέα: άνοδος πωλήσεων, νέα σειρά παπουτσιών, εξαγορά.', report: 'Πλήρης αναφορά με πηγές.', actions: [{ action: 'Ενημέρωσε το marketing', risk: 'low' }] } };
const rawJson = { title: 'Quantify gaps', status: 'awaiting_approval', assigned_agent_id: 'd', updated_at: '2026-10-04T19:51:02Z',
  result: { summary: '```json\n{"summary":"Three gaps found","report":"Gap 1 price, gap 2 reach","actions":[{"action":"Draft price test"}]}\n```' } };
const running = { title: 'Still working', status: 'running', assigned_agent_id: 'r', result: null };

test('unwraps a summary that was saved as raw model JSON', () => {
  const p = resultParts(rawJson.result);
  assert.equal(p.summary, 'Three gaps found');
  assert.equal(p.report, 'Gap 1 price, gap 2 reach');
  assert.deepEqual(p.actions, ['Draft price test']);
});
test('matches a Greek question to the Greek task, ignoring accents', () => {
  assert.equal(pickFocusTask([rawJson, greek], 'διάβασε μου τα νεα για την αγορα αθλητικων'), greek);
});
test('a generic "read me the report" picks the newest finished task', () => {
  assert.equal(pickFocusTask([rawJson, greek], 'diavase mou tin anafora'), rawJson);
  assert.equal(pickFocusTask([rawJson, greek], 'Read me the last report'), rawJson);
});
test('small talk does not pull a full report', () => {
  assert.equal(pickFocusTask([rawJson, greek], 'hello'), null);
});
test('briefing lists only finished work and includes the full result in focus', () => {
  const out = taskBriefing([running, rawJson, greek], names, 'what did the research about αθλητικων προϊοντων find?');
  assert.match(out, /FINISHED TASKS/);
  assert.doesNotMatch(out, /Still working/);
  assert.match(out, /by Data Analyst, done, waiting for your approval/);
  assert.match(out, /FULL RESULT of "Βρες τα 3/);
  assert.match(out, /Report: Πλήρης αναφορά με πηγές\./);
  assert.match(out, /Suggested next steps: Ενημέρωσε το marketing/);
});
test('no finished tasks is said plainly', () => {
  assert.equal(taskBriefing([running], names, 'read me the report'), 'FINISHED TASKS: none yet.');
});
test('long reports are clipped to the requested size', () => {
  const big = { ...greek, result: { summary: 's', report: 'x'.repeat(10_000) } };
  const out = taskBriefing([big], names, 'read me the report', { focusChars: 2000 });
  assert.ok(out.length < 2600, String(out.length));
});

import { extractModelJson } from '../../supabase/functions/_shared/model-json.ts';
test('a code fence inside the report does not break the result', () => {
  const text = '```json\n{"summary":"Plan ready","report":"Use this template:\\n```csv\\na,b\\n```\\nDone","actions":[]}\n```';
  const o = extractModelJson(text);
  assert.equal(o.summary, 'Plan ready');
  assert.match(o.report, /```csv/);
});
test('a reply cut off before the closing brace still gives summary and report', () => {
  const o = extractModelJson('{\n  "summary": "Need your competitor matrix",\n  "report": "Step 1: collect data.\\nStep 2: compa');
  assert.equal(o.summary, 'Need your competitor matrix');
  assert.equal(o.report, 'Step 1: collect data.\nStep 2: compa');
});
test('plain text is not mistaken for JSON', () => assert.equal(extractModelJson('All done, no JSON here.'), null));
test('the stored Data Analyst case reads cleanly', () => {
  const p = resultParts({ summary: '{\n  "summary": "I need your competitor matrix + product definition to produce TAM/SOM', report: '{"summary":"x"' });
  assert.equal(p.summary, 'I need your competitor matrix + product definition to produce TAM/SOM');
});

import { workLog, handoffFrom } from '../../supabase/functions/_shared/task-briefing.ts';
const A = '11111111-2222-3333-4444-555555555555';
const CEO = '99999999-2222-3333-4444-555555555555';
const team = [{ id: CEO, name: 'CEO' }, { id: A, name: 'Research Agent' }];

test('the work log lists the real steps and what each found', () => {
  const log = workLog({ steps: [{ action: 'web_search', input: 'αθλητικά νέα', ok: true, out: '1. Άρθρο - https://a.gr' }, { action: 'read_page', input: 'https://a.gr', ok: false }] });
  assert.match(log[1], /searched the web for "αθλητικά νέα" -> found: 1\. Άρθρο/);
  assert.match(log[2], /read the page "https:\/\/a\.gr" \(failed\)/);
  assert.deepEqual(workLog({ summary: 'old runner' }), []);
});
test('"what did you do" in Greek or Greeklish focuses the latest finished task', () => {
  assert.equal(pickFocusTask([greek], 'τι έκανες;'), greek);
  assert.equal(pickFocusTask([greek], 'ti ekanes?'), greek);
});
test('the CEO hand-over becomes a marker for a real employee only', () => {
  const out = handoffFrom('Το έκανε ο Research Agent.\nASK: Research Agent | Ποιες πηγές διάβασες;', team, CEO);
  assert.equal(out.agentId, A);
  assert.equal(out.text, `Το έκανε ο Research Agent.\n\n[[ask:${A}]] Ποιες πηγές διάβασες;`);
  const unknown = handoffFrom('Δεν ξέρω.\nASK: Κάποιος | Ερώτηση', team, CEO);
  assert.equal(unknown.agentId, null);
  assert.equal(unknown.text, 'Δεν ξέρω.');
  assert.equal(handoffFrom('Θα το δω.\nASK: CEO | Τι έγινε;', team, CEO).agentId, null);
  assert.equal(handoffFrom('Απλή απάντηση.', team, CEO).text, 'Απλή απάντηση.');
});

import { focusBriefing } from '../../supabase/functions/_shared/task-briefing.ts';
test('the focused record carries the result and the work log, or nothing', () => {
  const t = { ...greek, result: { ...greek.result, steps: [{ action: 'web_search', input: 'αγορά', ok: true, out: 'βρέθηκαν 3 άρθρα' }] } };
  const f = focusBriefing([t], names, 'τι έκανες;');
  assert.match(f, /^FULL RESULT of/);
  assert.match(f, /WORK LOG[\s\S]*searched the web for "αγορά" -> found: βρέθηκαν 3 άρθρα/);
  assert.equal(focusBriefing([t], names, 'καλημέρα'), '');
});
