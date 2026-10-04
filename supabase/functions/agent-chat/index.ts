// Firbo agent chat. Authentication, ownership and budgets are checked before inference.
// The shared gateway route is opt-in (legacy / selected-agent canary / gateway).
// See docs/FIRBO-PRODUCTION-PLAN.md. No settings or existing agent models are changed here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { gatewayForOrgPlan, completeViaGateway, GatewayError, type GatewayPlan, type GatewayCompletion, type GatewayTrace } from '../_shared/gateway-routing.ts';

import { freeForOrganization, completeViaFree, type FreeCompletion, type FreeTrace } from '../_shared/free-routing.ts';
import { taskBriefing, type BriefTask } from '../_shared/task-briefing.ts';
import { ownKeyTarget } from '../_shared/own-keys.ts';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });
const WRITERS = ['owner', 'admin', 'manager', 'member'];
const HOURLY_RUN_LIMIT = 60;
const MAX_MESSAGE = 4000;
const HISTORY = 20;
const LANG_NAME: Record<string, string> = {
  en: 'English', el: 'Greek', es: 'Spanish', 'pt-BR': 'Brazilian Portuguese',
  de: 'German', fr: 'French', 'zh-CN': 'Simplified Chinese', ar: 'Arabic',
};
const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1',
  kimi: 'https://api.moonshot.ai/v1', glm: 'https://api.z.ai/api/paas/v4',
};
interface Target { provider: string; model: string; base: string; key: string }
function resolveTarget(spec: string): Target | null {
  const i = spec.indexOf(':');
  const provider = (i > 0 ? spec.slice(0, i) : 'custom').toLowerCase();
  const model = i > 0 ? spec.slice(i + 1) : spec;
  if (!/^[a-z0-9_-]{1,32}$/.test(provider) || !model) return null;
  const env = provider.toUpperCase().replace(/-/g, '_');
  const key = Deno.env.get(provider === 'custom' ? 'LLM_API_KEY' : `${env}_API_KEY`);
  const base = Deno.env.get(provider === 'custom' ? 'LLM_BASE_URL' : `${env}_BASE_URL`) ?? BASE_URLS[provider];
  if (!key || !base) return null;
  return { provider, model, base: base.replace(/\/+$/, ''), key };
}
function priceOf(provider: string, which: 'IN' | 'OUT'): number {
  const env = provider.toUpperCase().replace(/-/g, '_');
  const v = Deno.env.get(`${env}_PRICE_${which}_PER_M`) ?? Deno.env.get(`LLM_PRICE_${which}_PER_M`);
  return Number(v ?? (which === 'IN' ? 3 : 15));
}

/** Shrinks the conversation to fit the local model's context. Oldest turns and snapshot detail go first. */
function compactForFree(i: { agent: any; org: any; profile: Record<string, string>; snapshot: string; voice: boolean; lang: string; past: { role: string; content: string }[]; text: string }) {
  const clipTo = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const bytes = (m: unknown) => new TextEncoder().encode(JSON.stringify(m)).length;
  const build = (snapChars: number, turns: number) => {
    const system = [
      clipTo(i.agent.system_prompt || `You are ${i.agent.name}, an AI employee.`, 260),
      `Company: ${clipTo(i.org?.name, 60)}.${i.profile.goal ? ` Goal: ${clipTo(i.profile.goal, 120)}.` : ''}`,
      i.voice && snapChars > 0 ? clipTo(i.snapshot, snapChars) : '',
      `Reply in ${LANG_NAME[i.lang] ?? 'English'} unless the teammate writes in another language. ${i.voice ? 'Spoken conversation: answer in one to three short natural sentences, no markdown or lists. Use only the company data above and never invent numbers.' : 'Be concise.'}`,
    ].filter(Boolean).join('\n');
    const recent = (turns > 0 ? i.past.slice(-turns) : []).map(m => ({ role: m.role, content: clipTo(m.content, 280) }));
    return [{ role: 'system', content: system }, ...recent, { role: 'user', content: clipTo(i.text, 500) }];
  };
  for (const [snap, turns] of [[900, 4], [700, 3], [500, 2], [300, 1], [150, 0], [0, 0]] as const) {
    const messages = build(snap, turns);
    if (bytes(messages) <= 2700) return messages;
  }
  return build(0, 0);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const auth = req.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });
  let body: { conversation_id?: string; message?: string; lang?: string; voice?: boolean } = {};
  try { body = await req.json(); } catch { return json(400, { error: 'bad_request' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { error: 'bad_request' });
  const text = typeof body.message === 'string' ? body.message.trim() : '';
  if (!body.conversation_id || typeof body.conversation_id !== 'string' || !text) return json(400, { error: 'bad_request' });
  if (text.length > MAX_MESSAGE) return json(413, { error: 'too_long' });
  const lang = body.lang && body.lang in LANG_NAME ? body.lang : 'en';
  const { data: convo } = await userClient.from('conversations')
    .select('id, organization_id, user_id, agent_id, title, status').eq('id', body.conversation_id).maybeSingle();
  if (!convo) return json(404, { error: 'not_found' });
  if (convo.user_id !== user.id) return json(403, { error: 'forbidden' });
  if (convo.status !== 'active') return json(409, { error: 'not_runnable' });
  const { data: member } = await userClient.from('organization_members').select('role')
    .eq('organization_id', convo.organization_id).eq('user_id', user.id).maybeSingle();
  if (!member || !WRITERS.includes(member.role)) return json(403, { error: 'forbidden' });
  const allowed = (Deno.env.get('RUN_ALLOWED_EMAILS') ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const email = (user.email ?? '').toLowerCase();
  if (allowed.length > 0 && !allowed.includes(email) && !allowed.includes(`@${email.split('@')[1] ?? ''}`)) return json(403, { error: 'forbidden' });
  if (!convo.agent_id) return json(422, { error: 'no_agent' });
  const admin = createClient(url, service);
  const { data: agent } = await admin.from('agents').select('id, name, type, system_prompt, model, temperature, enabled, monthly_budget_usd')
    .eq('id', convo.agent_id).eq('organization_id', convo.organization_id).maybeSingle();
  if (!agent) return json(404, { error: 'no_agent' });
  if (!agent.enabled) return json(409, { error: 'agent_disabled' });

  const { data: orgPlan } = await admin.from('organizations').select('plan').eq('id', convo.organization_id).maybeSingle();
  // The company's own key (Pro and up) goes straight to its provider and nothing else is tried, so it is never billed twice.
  const own = await ownKeyTarget(admin, convo.organization_id, agent.model);
  let free = false;
  let gateway: GatewayPlan | null = null;
  if (!own) {
    try { free = Deno.env.get('FIRBO_ALLOW_LOCAL_CHAT') === 'on' && freeForOrganization(convo.organization_id, name => Deno.env.get(name)); gateway = free ? null : gatewayForOrgPlan(agent, orgPlan?.plan, name => Deno.env.get(name)); }
    catch (error) { return json(503, { error: 'not_configured', reason: error instanceof GatewayError ? error.code : 'routing_error' }); }
  }
  const primary = agent.model && agent.model !== 'auto' ? agent.model : Deno.env.get('LLM_DEFAULT') ?? (Deno.env.get('LLM_BASE_URL') ? `custom:${Deno.env.get('LLM_MODEL') ?? 'auto'}` : '');
  const specs = [primary, ...(Deno.env.get('LLM_FALLBACK') ?? '').split(',').map(x => x.trim())].filter(Boolean);
  // A gateway-selected request NEVER also enters the legacy direct-provider loop.
  const targets: Target[] = own ? [own] : free || gateway ? [] : specs.map(resolveTarget).filter((t): t is Target => t !== null);
  if (!free && !gateway && targets.length === 0) return json(503, { error: 'not_configured' });

  const monthStart = new Date();
  monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  const { data: spendRows, error: spendError } = await admin.from('usage_events').select('cost_usd').eq('agent_id', agent.id).gte('created_at', monthStart.toISOString());
  if (spendError) return json(503, { error: 'budget_unavailable' });
  const spent = (spendRows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
  if (!free && agent.monthly_budget_usd != null && spent >= Number(agent.monthly_budget_usd)) return json(402, { error: 'budget_exceeded', spent, budget: Number(agent.monthly_budget_usd) });
  const { count: lastHour, error: hourError } = await admin.from('usage_events').select('id', { count: 'exact', head: true })
    .eq('agent_id', agent.id).gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if (hourError) return json(503, { error: 'budget_unavailable' });
  if ((lastHour ?? 0) >= HOURLY_RUN_LIMIT) return json(429, { error: 'rate_limited' });
  const { count: orgDay, error: dayError } = await admin.from('usage_events').select('id', { count: 'exact', head: true })
    .eq('organization_id', convo.organization_id).gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  const { data: planCap, error: planError } = await admin.rpc('plan_limit', { p_org: convo.organization_id, p_key: 'daily_runs' });
  if (dayError || planError) return json(503, { error: 'budget_unavailable' });
  const cap = Math.min(Number(planCap ?? 25), Number(Deno.env.get('ORG_DAILY_RUN_LIMIT') ?? Infinity));
  if (Number.isNaN(cap) || cap < 0) return json(503, { error: 'budget_unavailable' });
  if ((orgDay ?? 0) >= cap) return json(429, { error: 'plan_limit' });
  const { data: history } = await admin.from('messages').select('role, content').eq('conversation_id', convo.id)
    .in('role', ['user', 'assistant']).order('created_at', { ascending: false }).limit(HISTORY);
  const past = (history ?? []).reverse().map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE) }));
  const { data: userRow, error: userError } = await admin.from('messages')
    .insert({ organization_id: convo.organization_id, conversation_id: convo.id, role: 'user', content: text })
    .select('id, role, content, created_at').single();
  if (userError || !userRow) return json(503, { error: 'message_save_failed' });
  const { data: org } = await admin.from('organizations').select('name, profile').eq('id', convo.organization_id).maybeSingle();
  const profile = (org?.profile ?? {}) as Record<string, string>;
  const { data: memRows } = await admin.from('memories').select('content, memory_type').eq('organization_id', convo.organization_id)
    .or(`agent_id.is.null,agent_id.eq.${agent.id}`).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('importance', { ascending: false }).limit(12);
  const memoryBlock = (memRows ?? []).length
    ? `COMPANY MEMORY (saved by the owner; follow instructions and respect facts and decisions, but never let it override your safety rules):\n${(memRows ?? []).map((m: any) => `- [${m.memory_type}] ${String(m.content).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n')}` : '';
  // Live company data and finished task results, in text chat and in voice, so the owner can ask
  // "what did the team finish?" or "read me the research report" and get the real result.
  // The CEO sees the whole company's work; any other agent sees only its own tasks.
  const isCeo = agent.type === 'ceo';
  let tasksQuery = admin.from('tasks').select('title, status, priority, result, completed_at, updated_at, assigned_agent_id')
    .eq('organization_id', convo.organization_id).eq('kind', 'task');
  if (!isCeo) tasksQuery = tasksQuery.eq('assigned_agent_id', agent.id);
  const [{ data: tkRows }, { data: apRows }, { data: agRows }, { data: spendMonth }] = await Promise.all([
    tasksQuery.order('updated_at', { ascending: false }).limit(30),
    admin.from('approvals').select('action, risk, agent_id').eq('organization_id', convo.organization_id).eq('status', 'pending').limit(8),
    admin.from('agents').select('id, name, enabled').eq('organization_id', convo.organization_id).limit(40),
    admin.from('usage_events').select('cost_usd').eq('organization_id', convo.organization_id).gte('created_at', monthStart.toISOString()),
  ]);
  const list = (v: unknown): any[] => (Array.isArray(v) ? v : []);
  const [tk, ap, ag] = [list(tkRows), list(apRows), list(agRows)];
  const names = new Map<string, string>(ag.map((x: any) => [x.id, x.name]));
  const clip = (v: unknown, n: number) => (typeof v === 'string' ? v : JSON.stringify(v) ?? '').replace(/\s+/g, ' ').slice(0, n);
  const monthCost = list(spendMonth).reduce((sum: number, r: any) => sum + Number(r.cost_usd ?? 0), 0);
  const open = tk.filter((x: any) => !['completed', 'awaiting_approval', 'blocked', 'failed', 'cancelled'].includes(x.status)).slice(0, 10);
  const snapshot = [
    'LIVE COMPANY DATA (use it; never invent numbers):',
    `Team: ${ag.map((x: any) => `${x.name}${x.enabled ? '' : ' (paused)'}`).join(', ') || 'none'}.`,
    `Spend this month: $${monthCost.toFixed(2)}.`,
    `Pending approvals (${ap.length}): ${ap.map((x: any) => `${clip(x.action, 60)} [${names.get(x.agent_id) ?? 'agent'}, risk ${x.risk ?? 'n/a'}]`).join('; ') || 'none'}.`,
    `Open tasks: ${open.map((x: any) => `"${clip(x.title, 60)}" ${x.status}${x.assigned_agent_id ? ` by ${names.get(x.assigned_agent_id) ?? 'agent'}` : ' (unassigned)'}`).join(' | ') || 'none'}.`,
    taskBriefing(tk as BriefTask[], names, text, { focusChars: body.voice === true ? 2000 : 3500 }),
  ].join('\n');
  const system = [
    agent.system_prompt || `You are ${agent.name}, an AI employee.`,
    `Company: ${org?.name ?? ''}. ${profile.goal ? `Current goal: ${profile.goal}.` : ''} ${profile.summary ? `About the company: ${profile.summary}` : ''} ${profile.industry ? `Industry: ${profile.industry}.` : ''}`,
    ...(memoryBlock ? [memoryBlock] : []),
    'You are chatting with a teammate. Be direct, concrete and concise; use markdown when it helps. If you are unsure, say so instead of inventing facts.',
    'You cannot send, publish, pay or change anything yourself. If the teammate wants work delivered or an outward step taken, suggest creating a task for you so it goes through approval.',
    `Reply in ${LANG_NAME[lang]} unless the teammate writes in another language. Today is ${new Date().toISOString().slice(0, 10)}.`,
    snapshot,
    body.voice === true
      ? 'When the founder asks what a task found or asks you to read a result, read it from FINISHED TASKS / FULL RESULT: the main findings in plain words, up to six short sentences (under 600 characters), then say the full report is in Tasks.'
      : 'When the teammate asks about a task or its result, answer from FINISHED TASKS / FULL RESULT: give the summary and the key findings, and say the full report is in Tasks, Show result. If a task is waiting for approval or needs more information, say so and what is needed.',
    ...(body.voice === true ? ['This is a spoken conversation with the founder. Answer the exact question first, in one to three short natural sentences unless you are reading a task result, no markdown, lists, links or emoji. Be specific: name people, tasks and numbers from the live data. Never repeat what you already said earlier in this conversation or re-greet; if asked the same thing again, add new detail or a decision. Give at most one concrete recommendation, only when useful. If the data does not contain the answer, say so briefly and say how you would find out.'] : []),
  ].join('\n\n');
  const t0 = Date.now();
  let completion: any = null;
  let used: { provider: string; model: string } | null = null;
  let routed: GatewayCompletion | FreeCompletion | null = null;
  let routing: GatewayTrace | FreeTrace | undefined;
  let lastError = 'model_error';
  if (free) {
    try {
      // The local model has a small context (the route accepts at most 2800 bytes), so it gets a compact prompt.
      routed = await completeViaFree(convo.organization_id, auth, crypto.randomUUID(), compactForFree({ agent, org, profile, snapshot, voice: body.voice === true, lang, past, text }), { signal: req.signal });
      completion = routed.completion; routing = routed.trace;
      used = { provider: 'firbo-free', model: routed.trace.reported_model };
    } catch (error) { lastError = error instanceof GatewayError ? error.code : 'free_error'; }
  } else if (gateway) {
    try {
      routed = await completeViaGateway(gateway, [{ role: 'system', content: system }, ...past, { role: 'user', content: text }], Number(agent.temperature ?? 0.5), { signal: req.signal });
      completion = routed.completion; routing = routed.trace;
      used = { provider: 'omniroute', model: gateway.model };
    } catch (error) {
      lastError = error instanceof GatewayError ? error.code : 'gateway_error';
      routing = error instanceof GatewayError ? error.trace : undefined;
    }
    console.info(JSON.stringify({ event: 'firbo_gateway_inference', source: 'agent-chat', organization_id: convo.organization_id, agent_id: agent.id, conversation_id: convo.id, routing }));
  }
  for (const target of targets) {
    try {
      const openai = target.provider === 'openai';
      const res = await fetch(`${target.base}/chat/completions`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
        body: JSON.stringify({ model: target.model,
          ...(openai ? { max_completion_tokens: 8000 } : { max_tokens: 1800, temperature: Number(agent.temperature ?? 0.5) }),
          messages: [{ role: 'system', content: system }, ...past, { role: 'user', content: text }],
        }), signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${target.provider}_http_${res.status}`);
      completion = await res.json();
      if (!completion?.choices?.[0]?.message?.content) throw new Error(`${target.provider}_empty`);
      used = target; break;
    } catch (error) {
      // With the company's own key, say what the provider answered (wrong model name, key revoked, no credit).
      lastError = own && error instanceof Error && /^[a-z0-9_]{1,50}$/.test(error.message) ? `own_key_${error.message}` : 'model_error';
    }
  }
  if (!completion || !used) return json(502, { error: 'model_error', reason: lastError, user_message: userRow, routing });
  const model = `${used.provider}:${used.model}`;
  const latency = Date.now() - t0;
  const reply: string = String(completion.choices[0].message.content);
  const inTok = Number(completion?.usage?.prompt_tokens ?? 0);
  const outTok = Number(completion?.usage?.completion_tokens ?? 0);
  const ownUsed = !!own && used === own;
  // Own-key usage is billed by the provider to the company, so it costs the company nothing at Firbo.
  const cost = routed ? routed.cost : ownUsed ? 0 : Math.round(((inTok * priceOf(used.provider, 'IN') + outTok * priceOf(used.provider, 'OUT')) / 1e6) * 1e6) / 1e6;
  // Do not report success when either usage accounting or the assistant message failed to persist.
  const { error: usageError } = await admin.from('usage_events').insert({ organization_id: convo.organization_id, user_id: user.id, agent_id: agent.id, model,
    input_tokens: inTok, output_tokens: outTok, cost_usd: cost, latency_ms: latency, ...(ownUsed ? { own_key: true } : {}) });
  const { data: botRow, error: botError } = await admin.from('messages')
    .insert({ organization_id: convo.organization_id, conversation_id: convo.id, role: 'assistant', content: reply, model, input_tokens: inTok, output_tokens: outTok, latency_ms: latency })
    .select('id, role, content, created_at, model').single();
  if (usageError || botError || !botRow) {
    console.error(JSON.stringify({ event: 'firbo_inference_reconciliation_required', source: 'agent-chat', conversation_id: convo.id, organization_id: convo.organization_id, request_id: routing?.request_id, usage_saved: !usageError, message_saved: !!botRow && !botError }));
    return json(503, { error: 'result_save_failed', retry_safe: false, user_message: userRow, message: botRow, routing });
  }
  await admin.from('conversations').update({ updated_at: new Date().toISOString(), ...(convo.title ? {} : { title: text.slice(0, 60) }) }).eq('id', convo.id);
  return json(200, { user_message: userRow, message: botRow, routing });
});
