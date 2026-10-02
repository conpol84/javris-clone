// Firbo AI agent chat: one conversational turn with an AI employee, entirely inside Supabase (no extra server).
//
// Guarantees (enforced here, not in the browser):
//  - caller must be a signed-in writer of the conversation's company and its owner (RLS read + role check)
//  - monthly budget and an hourly circuit breaker are checked BEFORE any model call
//  - the agent cannot send/publish/pay in chat; it is told to suggest a task so outward steps go through approval
//  - model keys live only in Edge Function secrets. An agent's model is "provider:model" (e.g. "openai:<model>",
//    "anthropic:claude-sonnet-5-5", "kimi:<model>", "glm:<model>", "mimo:<model>"); "auto" uses LLM_DEFAULT.
//    Each provider NAME needs NAME_API_KEY (and NAME_BASE_URL unless it has a built-in default).
//    LLM_FALLBACK="provider:model,provider:model" is tried in order when the first choice fails.
//    Optional per provider: NAME_PRICE_IN_PER_M / NAME_PRICE_OUT_PER_M (cost estimate for budgets).
//  - spend protection while signup is open: RUN_ALLOWED_EMAILS="a@x.com,@mycompany.com" limits who may run agents;
//    ORG_DAILY_RUN_LIMIT (default 100) caps runs per company per 24 h.
import { createClient } from 'npm:@supabase/supabase-js@2';

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
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  kimi: 'https://api.moonshot.ai/v1',
  glm: 'https://api.z.ai/api/paas/v4',
};

interface Target {
  provider: string;
  model: string;
  base: string;
  key: string;
}

/** "provider:model" -> a configured endpoint, or null when its secrets are missing. */
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
  try {
    body = await req.json();
  } catch {
    return json(400, { error: 'bad_request' });
  }
  const text = typeof body.message === 'string' ? body.message.trim() : '';
  if (!body.conversation_id || typeof body.conversation_id !== 'string' || !text) return json(400, { error: 'bad_request' });
  if (text.length > MAX_MESSAGE) return json(413, { error: 'too_long' });
  const lang = body.lang && body.lang in LANG_NAME ? body.lang : 'en';

  // RLS-scoped read: you only see your own conversations (admins see all of the company's).
  const { data: convo } = await userClient
    .from('conversations')
    .select('id, organization_id, user_id, agent_id, title, status')
    .eq('id', body.conversation_id)
    .maybeSingle();
  if (!convo) return json(404, { error: 'not_found' });
  if (convo.user_id !== user.id) return json(403, { error: 'forbidden' });
  if (convo.status !== 'active') return json(409, { error: 'not_runnable' });
  const { data: member } = await userClient
    .from('organization_members')
    .select('role')
    .eq('organization_id', convo.organization_id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!member || !WRITERS.includes(member.role)) return json(403, { error: 'forbidden' });
  const allowed = (Deno.env.get('RUN_ALLOWED_EMAILS') ?? '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const email = (user.email ?? '').toLowerCase();
  if (allowed.length > 0 && !allowed.includes(email) && !allowed.includes(`@${email.split('@')[1] ?? ''}`)) {
    return json(403, { error: 'forbidden' });
  }
  if (!convo.agent_id) return json(422, { error: 'no_agent' });

  const admin = createClient(url, service);
  const { data: agent } = await admin
    .from('agents')
    .select('id, name, system_prompt, model, temperature, enabled, monthly_budget_usd')
    .eq('id', convo.agent_id)
    .eq('organization_id', convo.organization_id)
    .maybeSingle();
  if (!agent) return json(404, { error: 'no_agent' });
  if (!agent.enabled) return json(409, { error: 'agent_disabled' });

  const primary = agent.model && agent.model !== 'auto' ? agent.model : Deno.env.get('LLM_DEFAULT') ?? (Deno.env.get('LLM_BASE_URL') ? `custom:${Deno.env.get('LLM_MODEL') ?? 'auto'}` : '');
  const specs = [primary, ...(Deno.env.get('LLM_FALLBACK') ?? '').split(',').map((x) => x.trim())].filter(Boolean);
  const targets = specs.map(resolveTarget).filter((t): t is Target => t !== null);
  if (targets.length === 0) return json(503, { error: 'not_configured' });

  // ---- cost guards, before any model call
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const { data: spendRows } = await admin.from('usage_events').select('cost_usd').eq('agent_id', agent.id).gte('created_at', monthStart.toISOString());
  const spent = (spendRows ?? []).reduce((s: number, r: any) => s + Number(r.cost_usd ?? 0), 0);
  if (agent.monthly_budget_usd != null && spent >= Number(agent.monthly_budget_usd)) {
    return json(402, { error: 'budget_exceeded', spent, budget: Number(agent.monthly_budget_usd) });
  }
  const { count: lastHour } = await admin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('agent_id', agent.id)
    .gte('created_at', new Date(Date.now() - 3_600_000).toISOString());
  if ((lastHour ?? 0) >= HOURLY_RUN_LIMIT) return json(429, { error: 'rate_limited' });
  const { count: orgDay } = await admin
    .from('usage_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', convo.organization_id)
    .gte('created_at', new Date(Date.now() - 86_400_000).toISOString());
  if ((orgDay ?? 0) >= Number(Deno.env.get('ORG_DAILY_RUN_LIMIT') ?? 100)) return json(429, { error: 'rate_limited' });

  const { data: history } = await admin
    .from('messages')
    .select('role, content')
    .eq('conversation_id', convo.id)
    .in('role', ['user', 'assistant'])
    .order('created_at', { ascending: false })
    .limit(HISTORY);
  const past = (history ?? []).reverse().map((m: any) => ({ role: m.role, content: String(m.content).slice(0, MAX_MESSAGE) }));

  // Keep the user's message even if the model fails, so nothing they wrote is lost.
  const { data: userRow } = await admin
    .from('messages')
    .insert({ organization_id: convo.organization_id, conversation_id: convo.id, role: 'user', content: text })
    .select('id, role, content, created_at')
    .single();

  const { data: org } = await admin.from('organizations').select('name, profile').eq('id', convo.organization_id).maybeSingle();
  const profile = (org?.profile ?? {}) as Record<string, string>;
  // Live company snapshot so the CEO answers from real data instead of generic talk.
  let snapshot = '';
  if (body.voice === true) {
    const [{ data: tk }, { data: ap }, { data: ag }] = await Promise.all([
      admin.from('tasks').select('title, status, priority, result, completed_at, assigned_agent_id').eq('organization_id', convo.organization_id).eq('kind', 'task').order('updated_at', { ascending: false }).limit(12),
      admin.from('approvals').select('action, risk, agent_id').eq('organization_id', convo.organization_id).eq('status', 'pending').limit(8),
      admin.from('agents').select('id, name, enabled').eq('organization_id', convo.organization_id).limit(40),
    ]);
    const names = new Map((ag ?? []).map((x: any) => [x.id, x.name]));
    const clip = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').slice(0, n);
    const { data: spendMonth } = await admin.from('usage_events').select('cost_usd').eq('organization_id', convo.organization_id).gte('created_at', monthStart.toISOString());
    const monthCost = (spendMonth ?? []).reduce((sum: number, r: any) => sum + Number(r.cost_usd ?? 0), 0);
    snapshot = [
      `LIVE COMPANY DATA (use it; never invent numbers):`,
      `Team: ${(ag ?? []).map((x: any) => `${x.name}${x.enabled ? '' : ' (paused)'}`).join(', ') || 'none'}.`,
      `Spend this month: $${monthCost.toFixed(2)}.`,
      `Pending approvals (${(ap ?? []).length}): ${(ap ?? []).map((x: any) => `${clip(x.action, 60)} [${names.get(x.agent_id) ?? 'agent'}, risk ${x.risk ?? 'n/a'}]`).join('; ') || 'none'}.`,
      `Recent tasks: ${(tk ?? []).map((x: any) => `"${clip(x.title, 60)}" ${x.status}${x.assigned_agent_id ? ` by ${names.get(x.assigned_agent_id) ?? 'agent'}` : ' (unassigned)'}${x.result ? ` -> ${clip(x.result, 140)}` : ''}`).join(' | ') || 'none'}.`,
    ].join('\n');
  }
  const system = [
    agent.system_prompt || `You are ${agent.name}, an AI employee.`,
    `Company: ${org?.name ?? ''}. ${profile.goal ? `Current goal: ${profile.goal}.` : ''} ${profile.summary ? `About the company: ${profile.summary}` : ''} ${profile.industry ? `Industry: ${profile.industry}.` : ''}`,
    'You are chatting with a teammate. Be direct, concrete and concise; use markdown when it helps. If you are unsure, say so instead of inventing facts.',
    'You cannot send, publish, pay or change anything yourself. If the teammate wants work delivered or an outward step taken, suggest creating a task for you so it goes through approval.',
    `Reply in ${LANG_NAME[lang]} unless the teammate writes in another language.`,
    ...(body.voice === true ? [snapshot, 'This is a spoken conversation with the founder. Answer the exact question first, in one to three short natural sentences, no markdown, lists, links or emoji. Be specific: name people, tasks and numbers from the live data. Never repeat what you already said earlier in this conversation or re-greet; if asked the same thing again, add new detail or a decision. Give at most one concrete recommendation, only when useful. If the data does not contain the answer, say so briefly and say how you would find out.'] : []),
  ].join('\n\n');

  const t0 = Date.now();
  let completion: any = null;
  let used: Target | null = null;
  let lastError = 'model_error';
  for (const target of targets) {
    try {
      const openai = target.provider === 'openai';
      const res = await fetch(`${target.base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${target.key}` },
        body: JSON.stringify({
          model: target.model,
          ...(openai ? { max_completion_tokens: 8000 } : { max_tokens: 1800, temperature: Number(agent.temperature ?? 0.5) }),
          messages: [{ role: 'system', content: system }, ...past, { role: 'user', content: text }],
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`${target.provider}_http_${res.status}`);
      completion = await res.json();
      if (!completion?.choices?.[0]?.message?.content) throw new Error(`${target.provider}_empty`);
      used = target;
      break;
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'model_error';
    }
  }
  if (!completion || !used) {
    console.error('agent-chat model error', lastError);
    return json(502, { error: 'model_error', user_message: userRow });
  }
  const model = `${used.provider}:${used.model}`;
  const latency = Date.now() - t0;
  const reply: string = String(completion.choices[0].message.content);
  const inTok = Number(completion?.usage?.prompt_tokens ?? 0);
  const outTok = Number(completion?.usage?.completion_tokens ?? 0);
  const cost = Math.round(((inTok * priceOf(used.provider, 'IN') + outTok * priceOf(used.provider, 'OUT')) / 1e6) * 1e6) / 1e6;

  const { data: botRow } = await admin
    .from('messages')
    .insert({ organization_id: convo.organization_id, conversation_id: convo.id, role: 'assistant', content: reply, model, input_tokens: inTok, output_tokens: outTok, latency_ms: latency })
    .select('id, role, content, created_at, model')
    .single();
  await admin.from('usage_events').insert({
    organization_id: convo.organization_id, user_id: user.id, agent_id: agent.id, model,
    input_tokens: inTok, output_tokens: outTok, cost_usd: cost, latency_ms: latency,
  });
  await admin
    .from('conversations')
    .update({ updated_at: new Date().toISOString(), ...(convo.title ? {} : { title: text.slice(0, 60) }) })
    .eq('id', convo.id);

  return json(200, { user_message: userRow, message: botRow });
});
