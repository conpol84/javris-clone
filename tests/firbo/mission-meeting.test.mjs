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
      if (table === 'tasks' && q.filters.some(([k]) => k === 'parent_task_id')) {
        assert.ok(q.filters.some(([k,v])=>k==='organization_id'&&v===ORG),'mission children must belong to the verified organization');
      }
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
  return { auth: { getUser: async () => ({ data: { user: { id: 'owner', email: 'owner@example.test' } } }) }, from, rpc: async (fn, args) => {
    state.rpcs.push({fn,args});
    if (fn === 'plan_limit') return {data:state.planCap ?? 100,error:state.planError ? {message:'unavailable'} : null};
    if (fn === 'firbo_reserve_inference') {
      if (state.reserveError) return {data:null,error:{message:'unavailable'}};
      if (state.deniedAgent === args.p_agent || state.denial) return {data:{ok:false,reason:state.denial ?? 'budget_exceeded'},error:null};
      const id = crypto.randomUUID();state.reservations.set(id,args);
      return {data:{ok:true,duplicate:false,request_id:id,status:'reserved'},error:null};
    }
    if (fn === 'firbo_settle_inference') {
      if (state.settleError) return {data:null,error:{message:'lost response'}};
      const r=state.reservations.get(args.p_request);assert.ok(r,'settlement must own a reservation');
      state.writes.push({table:'usage_events',op:'rpc',payload:{agent_id:r.p_agent,cost_usd:args.p_cost_usd,own_key:args.p_own_key,inference_request_id:args.p_request}});
      return {data:{ok:true,status:'settled'},error:null};
    }
    if (fn === 'firbo_mark_inference_ambiguous') return {data:{ok:true,status:'reconcile_required'},error:null};
    if (fn === 'provider_key_for_runtime') return {data:state.ownKey ?? null,error:null};
    return {data:null,error:null};
  } };

}

function setup(o = {}) {
  state = {
    env: { SUPABASE_URL: 'https://db.example.test', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service', LLM_DEFAULT: 'openai:test-model', OPENAI_API_KEY: 'k' },
    meeting: { id: MEET, organization_id: ORG, title: 'Q4 online sales plan', description: 'Agree the three priorities for the e-shop', status: o.status ?? 'pending', kind: 'mission', metadata: o.metadata ?? { meeting: true, participants: [SALES.id, RESEARCH.id] } },
    recent: [{ title: 'Competitor prices', result: { summary: 'Rivals cut prices 10%' }, assigned_agent_id: RESEARCH.id }],
    writes: [], calls: [], rpcs: [], reservations: new Map(), claimLost: o.claimLost, ...o,
  };
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    state.calls.push(body);
    const sys = body.messages[0].content;
    const content = /Break the mission/.test(sys) ? JSON.stringify({steps:[{title:'Research the market',description:'Give the owner a report',agent:'research'}]}) : /Combine your team/.test(sys) ? JSON.stringify({summary:'Finished',report:'Combined employee work'}) : /chaired this meeting/.test(sys)
      ? JSON.stringify({ summary: 'Three priorities agreed.', report: '## Attendees\nCEO, Sales Agent, Research Agent\n## Decisions\n1. Match rival prices on top 20 items', decisions: ['Match rival prices on top 20 items'],
        actions: [{ title: 'Price list for top 20 items', description: 'Compare and propose prices', agent: 'research', priority: 'high' }, { title: 'Email offer to past buyers', description: 'Draft the email', agent: 'sales', priority: 'weird' }] })
      : o.silent ? '' : `As ${/Sales Agent/.test(sys) ? 'Sales' : 'Research'}: my view.`;
    if (!content || (o.firstProviderFails && state.calls.length === 1)) return new Response('{}', { status: 500 });
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
  assert.ok(state.writes.filter(w => w.table === 'usage_events').every(w => w.op === 'rpc'), 'no non-atomic usage insert');
  assert.deepEqual(state.rpcs.filter(r=>r.fn==='firbo_reserve_inference').map(r=>r.args.p_agent).sort(),[CEO.id,SALES.id,RESEARCH.id].sort());
  assert.ok(state.rpcs.filter(r=>r.fn==='firbo_reserve_inference').every(r=>r.args.p_source==='mission-runner'));
  assert.equal(done.accounting.requests.length,3);
  assert.equal(done.reconcile_required,false);
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


test('meet: admission outage or a exhausted daily plan makes no provider call', async () => {
  for (const options of [{reserveError:true},{planError:true},{planCap:0},{planCap:'bad'},{denial:'plan_limit'}]) {
    setup(options);const res=await call({action:'meet'});
    assert.equal(res.status,options.planCap===0||options.denial?429:503);
    assert.equal(state.calls.length,0);
  }
});

test('meet: each speaker has independent admission and a denial prevents the CEO call', async () => {
  setup({deniedAgent:SALES.id});const res=await call({action:'meet'});
  assert.equal(res.status,402);assert.equal(state.calls.length,1);
  assert.ok(!state.calls.some(c=>/chaired this meeting/.test(c.messages[0].content)));
  assert.equal(state.writes.filter(w=>w.table==='usage_events').length,1);
});

test('meet: lost usage settlement stops without fallback and retains ambiguous reservations', async () => {
  setup({settleError:true});state.env.LLM_FALLBACK='openai:backup';
  const res=await call({action:'meet'});const body=await res.json();
  assert.equal(res.status,503);assert.equal(body.retry_safe,false);
  assert.equal(state.calls.length,2,'one call for each of the two parallel speakers, no retry');
  assert.equal(state.rpcs.filter(r=>r.fn==='firbo_mark_inference_ambiguous').length,2);
  assert.equal(state.writes.filter(w=>w.table==='usage_events').length,0);
});

test('plan and synthesis reserve and settle the CEO call before publishing tasks/reports', async () => {
  for(const action of ['plan','synthesize']) {
    setup({status:action==='plan'?'pending':'running'});
    state.recent=action==='synthesize'?[{id:'55555555-5555-4555-8555-555555555555',organization_id:ORG,parent_task_id:MEET,
      title:'Completed market research',status:'completed',assigned_agent_id:RESEARCH.id,result:{report:'Observed competitor prices.'}}]:[];
    const res=await call({action});assert.equal(res.status,200);
    assert.equal(state.calls.length,1);assert.equal(state.reservations.size,1);
    assert.equal(state.writes.filter(w=>w.table==='usage_events'&&w.op==='rpc').length,1);
    assert.equal(state.rpcs.find(r=>r.fn==='firbo_reserve_inference').args.p_agent,CEO.id);
  }
});

test('an earlier ambiguous mission cannot be repeated automatically', async () => {
  setup();state.meeting.result={reconcile_required:true};
  const res=await call({action:'meet'});assert.equal(res.status,409);
  assert.equal(state.calls.length,0);assert.equal(state.reservations.size,0);
});

test('plan: fallback keeps the earlier provider reservation and exposes review instead of erasing it', async () => {
  setup({firstProviderFails:true});state.env.LLM_FALLBACK='openai:backup';
  const res=await call({action:'plan'});const body=await res.json();
  assert.equal(res.status,200);assert.equal(state.calls.length,2);assert.equal(state.reservations.size,2);
  assert.equal(state.writes.filter(w=>w.table==='usage_events').length,1);
  assert.equal(body.accounting.status,'reconcile_required');
  assert.ok(state.writes.some(w=>w.payload?.result?.reconcile_required===true));
});

test('mission estimates use the actual OpenAI completion-token cap before calling a model', async () => {
  setup();await call({action:'plan'});
  const r=state.rpcs.find(r=>r.fn==='firbo_reserve_inference').args;
  assert.ok(r.p_reserved_usd>=8000*15/1000000);
  assert.equal(state.calls[0].max_completion_tokens,8000);
  assert.equal(r.p_daily_limit,100);assert.equal(r.p_hourly_limit,30);
});


test('mission own-key calls reserve zero Firbo cost but still consume rate quota', async () => {
  setup({ownKey:'test-own-key'});state.env.LLM_FALLBACK='openai:backup';
  const oldModel=CEO.model;CEO.model='openai:test-model';
  try {
    const res=await call({action:'plan'});assert.equal(res.status,200);
    assert.equal(state.calls.length,1);assert.equal(state.reservations.size,1);
    assert.equal(state.rpcs.find(r=>r.fn==='firbo_reserve_inference').args.p_reserved_usd,0);
    const usage=state.writes.find(w=>w.table==='usage_events').payload;
    assert.equal(usage.cost_usd,0);assert.equal(usage.own_key,true);
  } finally {CEO.model=oldModel;}
});

test('the daily cap follows the company plan: no fixed default of 100 runs a day', async () => {
  const src = await readFile(new URL('supabase/functions/mission-runner/index.ts', root), 'utf8');
  assert.match(src, /Deno\.env\.get\('ORG_DAILY_RUN_LIMIT'\) \?\? Infinity\), 100000\)/);
  assert.doesNotMatch(src, /ORG_DAILY_RUN_LIMIT'\) \?\? 100\)/);
});
