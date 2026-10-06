/** mission-runner "meet": the CEO's meeting with mocked database and model transport (no real spend or SQL). */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MEET = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CEO = { id: '11111111-1111-4111-8111-111111111111', slug: 'ceo', name: 'CEO', type: 'ceo', description: 'Runs the company', system_prompt: '', model: 'auto', monthly_budget_usd: 50 };
const SALES = { id: '22222222-2222-4222-8222-222222222222', slug: 'sales', name: 'Sales Agent', type: 'sales', description: 'Leads, outreach and customer pricing', system_prompt: 'You sell.', model: 'auto', monthly_budget_usd: 50 };
const RESEARCH = { id: '33333333-3333-4333-8333-333333333333', slug: 'research', name: 'Research Agent', type: 'research', description: 'Market research and competitors', system_prompt: 'You research.', model: 'auto', monthly_budget_usd: 50 };
const SUPPORT = { id: '44444444-4444-4444-8444-444444444444', slug: 'support', name: 'Support Agent', type: 'support', description: 'Customer support tickets', system_prompt: '', model: 'auto', monthly_budget_usd: 50 };

const root = new URL('../../', import.meta.url);
const temp = await mkdtemp(join(tmpdir(), 'firbo-meeting-'));
const originalFetch = globalThis.fetch, originalDeno = globalThis.Deno;
let state, handler, mod;
globalThis.__meetClient = () => client();
globalThis.Deno = { env: { get: (k) => state.env[k] }, serve: (h) => { handler = h; } };
{
  const source = await readFile(new URL('supabase/functions/mission-runner/index.ts', root), 'utf8');
  const code = source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';", 'const createClient = (...a: any[]) => (globalThis as any).__meetClient(...a);')
    .replace(/'\.\.\/_shared\/([a-z-]+\.ts)'/g, (_m, f) => JSON.stringify(new URL(`supabase/functions/_shared/${f}`, root).href));
  const path = join(temp, 'mission-runner.ts'); await writeFile(path, code); mod = await import(pathToFileURL(path).href);
}
after(async () => { globalThis.fetch = originalFetch; globalThis.Deno = originalDeno; delete globalThis.__meetClient; await rm(temp, { recursive: true, force: true }); });

function client() {
  const from = (table) => {
    const q = { table, op: 'select', filters: [], payload: null };
    const run = () => {
      if (q.op !== 'select') {
        state.writes.push({ table, op: q.op, payload: q.payload, filters: q.filters });
        if (table === 'tasks' && q.op === 'update' && q.payload.status === 'running') return { data: state.claimLost ? null : { id: MEET }, error: null };
        if (table === 'tasks' && q.op === 'insert') return { data: q.payload.map((r, i) => ({ id: `act-${i}`, title: r.title, assigned_agent_id: r.assigned_agent_id })), error: null };
        return { data: null, error: null };
      }
      if (table === 'tasks' && q.filters.some(([k, v]) => k === 'id' && v === MEET)) return { data: state.meeting, error: null };
      if (table === 'tasks') return { data: state.recent, error: null };
      if (table === 'organization_members') return { data: { role: 'owner' }, error: null };
      if (table === 'agents') return { data: [CEO, SALES, RESEARCH, SUPPORT], error: null };
      if (table === 'organizations') return { data: { plan: 'pro', name: 'Trade Athletes', profile: { goal: 'Grow online sales' } }, error: null };
      if (table === 'usage_events') return { data: [], count: 0, error: null };
      return { data: null, error: null };
    };
    const chain = new Proxy({}, { get: (_t, prop) => {
      if (prop === 'then') return (ok, bad) => Promise.resolve(run()).then(ok, bad);
      if (prop === 'maybeSingle' || prop === 'single') return () => Promise.resolve(run());
      if (prop === 'update' || prop === 'insert') return (payload) => { q.op = prop; q.payload = payload; return chain; };
      if (prop === 'eq' || prop === 'in' || prop === 'gte') return (k, v) => { q.filters.push([k, v]); return chain; };
      return () => chain;
    } });
    return chain;
  };
  return { auth: { getUser: async () => ({ data: { user: { id: 'owner', email: 'owner@example.test' } } }) }, from, rpc: async () => ({ data: null, error: null }) };
}

function setup(o = {}) {
  state = {
    env: { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', LLM_DEFAULT: 'openai:test-model', OPENAI_API_KEY: 'k' },
    meeting: { id: MEET, organization_id: ORG, title: 'Q4 online sales plan', description: 'Agree the three priorities for the e-shop', status: o.status ?? 'pending', kind: 'mission', metadata: o.metadata ?? { meeting: true, participants: [SALES.id, RESEARCH.id] } },
    recent: [{ title: 'Competitor prices', result: { summary: 'Rivals cut prices 10%' }, assigned_agent_id: RESEARCH.id }],
    writes: [], calls: [], claimLost: o.claimLost,
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    state.calls.push(body);
    const sys = body.messages[0].content;
    const content = /chaired this meeting/.test(sys)
      ? JSON.stringify({ summary: 'Three priorities agreed.', report: '## Attendees\nCEO, Sales Agent, Research Agent\n## Decisions\n1. Match rival prices on top 20 items', decisions: ['Match rival prices on top 20 items'],
        actions: [{ title: 'Price list for top 20 items', description: 'Compare and propose prices', agent: 'research', priority: 'high' }, { title: 'Email offer to past buyers', description: 'Draft the email', agent: 'sales', priority: 'weird' }] })
      : o.silent ? '' : `As ${/Sales Agent/.test(sys) ? 'Sales' : 'Research'}: my view.`;
    if (!content) return new Response('{}', { status: 500 });
    return Response.json({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
  };
}
const call = (body) => handler(new Request('https://fn.example.test/mission-runner', { method: 'POST', headers: { authorization: 'Bearer user' }, body: JSON.stringify({ mission_id: MEET, lang: 'el', ...body }) }));

test('meet: invited employees speak, the CEO writes minutes and the action items become tasks', async () => {
  setup();
  const res = await call({ action: 'meet' });
  assert.equal(res.status, 200);
  const turns = state.calls.filter((c) => !/chaired this meeting/.test(c.messages[0].content));
  assert.equal(turns.length, 2, 'one turn per invited employee');
  assert.ok(turns.some((c) => /Competitor prices: Rivals cut prices 10%/.test(c.messages[1].content)), 'an employee sees its own recent work');
  assert.ok(turns.every((c) => /Speak in Greek/.test(c.messages[0].content)));
  const minutes = state.calls.find((c) => /chaired this meeting/.test(c.messages[0].content));
  assert.match(minutes.messages[1].content, /### Sales Agent\nAs Sales: my view\./);
  const inserted = state.writes.find((w) => w.table === 'tasks' && w.op === 'insert').payload;
  assert.deepEqual(inserted.map((r) => [r.title, r.assigned_agent_id, r.priority, r.parent_task_id, r.status]), [
    ['Price list for top 20 items', RESEARCH.id, 'high', MEET, 'pending'], ['Email offer to past buyers', SALES.id, 'normal', MEET, 'pending']]);
  const done = state.writes.find((w) => w.table === 'tasks' && w.op === 'update' && w.payload.status === 'completed').payload.result;
  assert.equal(done.format, 'meeting');
  assert.deepEqual(done.decisions, ['Match rival prices on top 20 items']);
  assert.equal(done.transcript.length, 2);
  assert.equal(state.writes.filter((w) => w.table === 'usage_events').length, 3, 'every model call is accounted to its speaker');
});

test('meet: only a meeting can be run as one, a running meeting is not run twice, and silence fails honestly', async () => {
  setup({ metadata: {} });
  assert.equal((await call({ action: 'meet' })).status, 400);
  setup({ claimLost: true });
  assert.equal((await call({ action: 'meet' })).status, 409);
  setup({ silent: true });
  assert.equal((await call({ action: 'meet' })).status, 502);
  assert.ok(state.writes.some((w) => w.table === 'tasks' && w.payload?.status === 'failed'));
});

test('pickParticipants: invited first, otherwise the roles that match the topic, never more than five', () => {
  const pool = [SALES, RESEARCH, SUPPORT];
  assert.deepEqual(mod.pickParticipants(pool, [SUPPORT.id], 'anything').map((a) => a.slug), ['support']);
  assert.equal(mod.pickParticipants(pool, [], 'competitors research for market prices')[0].slug, 'research');
  assert.ok(mod.pickParticipants(Array.from({ length: 9 }, (_, i) => ({ ...SALES, id: `x${i}` })), [], 'x').length <= 5);
});
