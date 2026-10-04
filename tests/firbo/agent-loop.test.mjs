import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentLoop, parseToolRequest, loopInstructions } from '../../supabase/functions/_shared/agent-loop.ts';

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
  assert.equal(n, 3); assert.equal(out.text, 'just text');
});
