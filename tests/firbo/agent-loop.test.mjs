import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop, parseToolRequest, loopInstructions, isFinalAnswer } from '../../supabase/functions/_shared/agent-loop.ts';

const final = JSON.stringify({ summary: 'Done', report: 'Found it at https://a.example', actions: [] });

test('search, read, then answer with every result fed back', async () => {
  const replies = ['{"action":"web_search","input":"sports market news"}', '```json\n{"action":"read_page","input":"https://a.example"}\n```', final];
  const seen = [];
  const out = await runAgentLoop({
    call: async (messages) => { seen.push(messages); return replies.shift(); },
    system: 'S', user: 'U',
    tools: { web_search: async (q) => `1. A - https://a.example (${q})`, read_page: async (u) => `page text of ${u}` },
  });
  assert.equal(out.text, final);
  assert.equal(out.calls, 3);
  assert.deepEqual(out.steps.map(s => s.action), ['web_search', 'read_page']);
  const lastMsgs = seen[2];
  assert.match(lastMsgs.at(-1).content, /page text of https:\/\/a\.example/);
  assert.match(lastMsgs.at(-3).content, /RESULT of web_search/);
  assert.match(seen[0][0].content, /web_search/);
});
test('a direct final answer is one call', async () => {
  const out = await runAgentLoop({ call: async () => final, system: 'S', user: 'U', tools: { web_search: async () => 'x' } });
  assert.equal(out.calls, 1); assert.equal(out.steps.length, 0);
});
test('stops at the step limit and asks for the final answer', async () => {
  let n = 0; let lastMessages;
  const out = await runAgentLoop({ call: async (m) => { n++; lastMessages = m; return '{"action":"web_search","input":"again"}'; }, system: 'S', user: 'U', tools: { web_search: async () => 'r' }, maxSteps: 2 });
  assert.equal(n, 4); assert.equal(out.steps.length, 2);
  assert.ok(lastMessages.some(m => /No more tools/.test(m.content)));
  assert.match(lastMessages.at(-1).content, /cannot use more tools/);
});
test('stops asking for tools when the time budget is used up', async () => {
  let t = 0;
  const out = await runAgentLoop({ call: async () => { t += 30_000; return '{"action":"web_search","input":"x"}'; }, system: 'S', user: 'U', tools: { web_search: async () => 'r' }, budgetMs: 60_000, now: () => t });
  assert.ok(out.calls <= 4, String(out.calls));
});
test('a tool that is not allowed is not run, and a failing tool does not stop the work', async () => {
  assert.equal(parseToolRequest('{"action":"shell","input":"rm -rf /"}', ['web_search']), null);
  assert.equal(parseToolRequest('{"action":"web_search","input":"q","summary":"x","report":"y"}', ['web_search']), null);
  const replies = ['{"action":"web_search","input":"q"}', final];
  const out = await runAgentLoop({ call: async () => replies.shift(), system: 'S', user: 'U', tools: { web_search: async () => { throw new Error('down'); } } });
  assert.equal(out.steps[0].ok, false); assert.equal(out.text, final);
});
test('no tools means no tool instructions', () => assert.equal(loopInstructions([], 5), ''));
test('a tool request with a stray closing brace is still understood', () => {
  assert.deepEqual(parseToolRequest('{"action": "web_search", "input": "sports news"} }', ['web_search']), { action: 'web_search', input: 'sports news' });
  assert.deepEqual(parseToolRequest('Sure! {"action":"read_page","input":"https://a.example/{x}"} thanks', ['read_page']), { action: 'read_page', input: 'https://a.example/{x}' });
});
test('when it must answer but still asks for a tool, it is asked once more for the final answer', async () => {
  const replies = ['{"action":"web_search","input":"a"}', '{"action":"web_search","input":"b"}', final];
  const out = await runAgentLoop({ call: async () => replies.shift(), system: 'S', user: 'U', tools: { web_search: async () => 'r' }, maxSteps: 1 });
  assert.equal(out.text, final); assert.equal(out.calls, 3);
});
test('native tool syntax from some free models is understood', () => {
  const t = "<|tool_call_start|>[web_search(input='latest sports trends 2026'), web_search(input='x')]<|tool_call_end|>";
  assert.deepEqual(parseToolRequest(t, ['web_search']), { action: 'web_search', input: 'latest sports trends 2026' });
  assert.deepEqual(parseToolRequest('read_page("https://a.example/x")', ['read_page']), { action: 'read_page', input: 'https://a.example/x' });
  assert.equal(parseToolRequest('I will use web_search later.', ['web_search']), null);
  assert.equal(parseToolRequest(final, ['web_search']), null);
});
test('thoughts instead of an answer are asked again; <think> blocks are ignored', async () => {
  const replies = ['The user wants me to research... Let me start with web', '<think>plan</think>{"action":"web_search","input":"q"}', final];
  const out = await runAgentLoop({ call: async () => replies.shift(), system: 'S', user: 'U', tools: { web_search: async () => 'r' } });
  assert.equal(out.text, final); assert.equal(out.calls, 3); assert.equal(out.steps.length, 1);
});
test('a plain-text answer is accepted after two nudges', async () => {
  let n = 0;
  const out = await runAgentLoop({ call: async () => { n++; return 'just text'; }, system: 'S', user: 'U', tools: { web_search: async () => 'r' } });
  assert.equal(n, 4); assert.equal(out.text, 'just text');
});
test('out of time with thoughts instead of the answer: one repair request returns the final object', async () => {
  let clock = 0;
  const replies = ['{"action":"web_search","input":"q"}', 'I should now write the report but first let me think about', final];
  const seen = [];
  const out = await runAgentLoop({
    call: async (messages) => { seen.push(messages.at(-1).content); clock += 40_000; return replies.shift(); },
    system: 'S', user: 'U', tools: { web_search: async () => 'r' }, budgetMs: 70_000, now: () => clock,
  });
  assert.equal(out.text, final); assert.equal(out.calls, 3);
  assert.match(seen.at(-1), /^DRAFT:\nI should now write the report/);
  assert.match(loopInstructions(['web_search'], 5), /instead of inventing/);
});
test('a final answer written after the model thought aloud (and mentioned a tool call) is still found', () => {
  const text = 'Let me think. Earlier I sent {"action":"web_search","input":"q"} and got news.\nNow the answer:\n' + final;
  assert.equal(isFinalAnswer(text), true);
  assert.equal(parseToolRequest(text, ['web_search']), null);
});
test('a report cut off by the provider is completed with continuation requests and a half link is removed', async () => {
  const { finishCutOff, trimDanglingLink } = await import('../../supabase/functions/_shared/agent-loop.ts');
  const cut = '{"summary":"Τρία νέα","report":"### Νέα\\n1. **Α**: κείμενο [Πηγή](https://a.gr/x)\\n2. **Β**: μισό κείμ';
  const parts = ['ενο [Πηγή](https://b.gr/y)\n3. **Γ**: τέλος [Πηγή](https://c.gr/', '\nEND'];
  const seen = [];
  const out = await finishCutOff(async (m) => { seen.push(m); return parts.shift(); }, cut, { instructions: 'Write in Greek.' });
  const o = JSON.parse(out.text);
  assert.equal(out.calls, 2);
  assert.equal(o.summary, 'Τρία νέα');
  assert.match(o.report, /2\. \*\*Β\*\*: μισό κείμενο \[Πηγή\]\(https:\/\/b\.gr\/y\)/);
  assert.match(o.report, /3\. \*\*Γ\*\*: τέλος$/);
  assert.match(seen[0][0].content, /Continue it exactly.*Write in Greek\./);
  const whole = JSON.stringify({ summary: 's', report: 'r', actions: [] });
  assert.deepEqual(await finishCutOff(async () => { throw new Error('no call'); }, whole), { text: whole, calls: 0 });
  assert.equal(trimDanglingLink('done [see](https://x.y/a'), 'done');
});
