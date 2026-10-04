// Developer preview: a fake Supabase client with sample data, so every signed-in screen can be opened and screenshotted
// without an account:  npm run preview:mock   (then open http://localhost:5200/ ).  Never used in production builds.
const day = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * day).toISOString();
const ORG = 'org-1';
const agent = (id: string, name: string, slug: string, type: string, enabled = true) => ({ id, name, slug, type, description: `${name} for Trade Athletes`, model: 'auto', enabled, autonomous: true, autonomy: 'approval', monthly_budget_usd: 50, persona: null, organization_id: ORG, agent_tools: ['think', 'memory_search', 'web_search'].map((tool_name, i) => ({ id: `${id}-t${i}`, tool_name, enabled: true, policy: 'allow' })) });
const agents = [agent('a1', 'CEO Agent', 'ceo', 'ceo'), agent('a2', 'Sales Agent', 'sales', 'sales'), agent('a3', 'Operations Agent', 'operations', 'operations'), agent('a4', 'Marketing Agent', 'marketing', 'marketing'), agent('a5', 'Research Agent', 'research', 'research'), agent('a6', 'Finance Agent', 'finance', 'finance'), agent('a7', 'Developer Agent', 'developer', 'developer'), agent('a8', 'Data Analyst', 'data-analyst-1', 'analyst'), agent('a9', 'Bookkeeper', 'bookkeeper-1', 'finance', false)];
const T = (id: string, title: string, status: string, priority: string, a: string, d: number, due: number | null = null) => ({ id, title, description: null, status, priority, assigned_agent_id: a, due_at: due == null ? null : ago(-due), created_at: ago(d), result: status === 'completed' ? { report: 'Done. Summary of findings with sources.' } : null, organization_id: ORG, kind: 'task' });
const tasks = [
  T('t1', 'Check my company and report the top three risks', 'running', 'high', 'a1', 0.1), T('t2', 'Identify and profile the top 3 competitors', 'awaiting_approval', 'normal', 'a5', 0.3),
  T('t3', 'Create a detailed feature, price and positioning matrix', 'awaiting_approval', 'normal', 'a5', 0.4), T('t4', 'Quantitative analysis: market sizing', 'awaiting_approval', 'high', 'a8', 0.5, 1),
  T('t5', 'Recommend positioning, messaging and launch channels', 'pending', 'normal', 'a4', 0.6), T('t6', 'Reconcile last month invoices', 'pending', 'low', 'a6', 1, 2),
  T('t7', 'Draft onboarding email sequence', 'completed', 'normal', 'a4', 2), T('t8', 'Weekly pipeline review', 'completed', 'normal', 'a2', 3), T('t9', 'Fix checkout bug on staging', 'failed', 'urgent', 'a7', 3),
  T('t10', 'Prepare investor update', 'blocked', 'high', 'a1', 4), T('t11', 'Summarise customer calls', 'completed', 'normal', 'a2', 5), T('t12', 'Optimise ad spend', 'completed', 'high', 'a4', 6),
];
const approvals = [
  { id: 'p1', action: 'send_email', payload: { to: 'ceo@partner.com', subject: 'Partnership proposal', body: 'Hello, we would like to propose...' }, status: 'pending', requested_at: ago(0.1), agent_id: 'a2', task_id: 't2', risk: 'medium', decision_note: null, decided_at: null, organization_id: ORG },
  { id: 'p2', action: 'publish_post', payload: { channel: 'LinkedIn', text: 'We just launched Trade Athletes…' }, status: 'pending', requested_at: ago(0.2), agent_id: 'a4', task_id: 't5', risk: 'low', decision_note: null, decided_at: null, organization_id: ORG },
  { id: 'p3', action: 'spend_budget', payload: { amount_usd: 450, reason: 'Paid report on industry TAM' }, status: 'pending', requested_at: ago(0.4), agent_id: 'a5', task_id: 't3', risk: 'high', decision_note: null, decided_at: null, organization_id: ORG },
];
const usage: unknown[] = [];
for (let d = 29; d >= 0; d--) for (let k = 0; k < 2 + ((d * 7) % 6); k++) usage.push({ id: `u${d}-${k}`, agent_id: agents[(d + k) % 8].id, input_tokens: 800 + ((d * 131 + k * 57) % 2400), output_tokens: 300 + ((d * 91 + k * 31) % 1200), cost_usd: 0.004 + ((d * 13 + k * 7) % 40) / 1000, created_at: ago(d + k / 10), organization_id: ORG, model: 'openai:gpt-5-mini' });
const mockPaid = typeof location !== 'undefined' && /mockplan=pro/.test(location.search);
const DB: Record<string, unknown[]> = {
  organization_members: [{ role: 'owner', user_id: 'u1', organization_id: ORG, organizations: { id: ORG, name: 'Trade Athletes', slug: 'trade-athletes', profile: { industry: 'Sports', onboarded: true } } }],
  organizations: [{ id: ORG, name: 'Trade Athletes', slug: 'trade-athletes', plan: 'free', profile: {} }],
  profiles: [{ id: 'u1', display_name: 'Constantinos', locale: 'en' }], agents, tasks, approvals, usage_events: usage,
  memories: [{ id: 'm1', content: 'Our ideal customer is a semi-pro athlete under 25.', memory_type: 'instruction', importance: 0.9, created_at: ago(2), agent_id: null }],
  integrations: [{ id: 'i1', kind: 'slack', name: 'Team Slack', config: {}, status: 'active', last_error: null, last_used_at: ago(1), created_at: ago(5) }, { id: 'i2', kind: 'stripe', name: 'Stripe', config: {}, status: 'active', last_error: null, last_used_at: ago(0.5), created_at: ago(6) }],
  plans: [
    { id: 'free', name: 'Free', price_month_usd: 0, price_year_usd: 0, limits: { agents: 2, shifts: 1, members: 2, memories: 25, daily_runs: 25, integrations: 2 }, features: ['ai_ceo_text', 'missions', 'inbox_approvals'], sort: 1, purchasable: false },
    { id: 'pro', name: 'Pro', price_month_usd: 29, price_year_usd: 290, limits: { agents: 25, shifts: 10, members: 10, memories: 500, daily_runs: 300, integrations: 10 }, features: ['ai_ceo_voice', 'missions', 'shifts', 'all_integrations', 'reviews', 'memory_map'], sort: 2, purchasable: true },
    { id: 'business', name: 'Business', price_month_usd: 99, price_year_usd: 990, limits: { agents: 100, shifts: 50, members: 50, memories: 5000, daily_runs: 2000, integrations: 30 }, features: ['ai_ceo_voice', 'missions', 'shifts', 'all_integrations', 'reviews', 'memory_map', 'priority_support', 'audit_export'], sort: 3, purchasable: true },
  ],
  audit_log: [{ id: 'l1', action: 'agent.hired', entity_type: 'agent', entity_id: 'a8', details: { name: 'Data Analyst' }, created_at: ago(1), actor_id: 'u1' }, { id: 'l2', action: 'agent.updated', entity_type: 'agent', entity_id: 'a2', details: { name: 'Sales Agent', changed: ['autonomy'] }, created_at: ago(2), actor_id: 'u1' }],
  conversations: [], messages: [], shifts: [], connector_devices: [], connector_jobs: [], platform_admins: [], integration_votes: [],
  // ?mockplan=pro previews a paid company with one connected own key.
  org_provider_keys: mockPaid ? [{ provider: 'openai', key_hint: '…a1b2', models: ['gpt-5-mini', 'gpt-5', 'o4-mini'], updated_at: ago(1) }] : [],
};
function builder(table: string) {
  const rows = () => DB[table] ?? [];
  const b: Record<string, unknown> = { then: (res: (v: unknown) => void) => res({ data: rows(), error: null, count: rows().length }) };
  for (const m of ['select', 'eq', 'neq', 'in', 'gte', 'lte', 'gt', 'lt', 'order', 'limit', 'is', 'not', 'or', 'range', 'match', 'filter', 'update', 'insert', 'delete', 'upsert', 'contains', 'ilike', 'like', 'textSearch']) b[m] = () => b;
  b.single = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  b.maybeSingle = b.single;
  return b;
}
const RPC: Record<string, unknown> = {
  get_plan_usage: { plan: mockPaid ? { id: 'pro', name: 'Pro', price_month_usd: 29, price_year_usd: 290, limits: { agents: 25, shifts: 10, members: 10, memories: 500, daily_runs: 300, integrations: 10 }, features: ['ai_ceo_voice', 'byo_keys'], sort: 2, purchasable: true } : { id: 'free', name: 'Free', price_month_usd: 0, price_year_usd: 0, limits: { agents: 2, shifts: 1, members: 2, memories: 25, daily_runs: 25, integrations: 2 }, features: ['ai_ceo_text'], sort: 1, purchasable: false }, status: 'active', renews_at: null, has_subscription: false, usage: { agents: 9, shifts: 1, members: 1, memories: 1, daily_runs: 8, integrations: 2 } },
    is_platform_admin: false, list_members: [{ user_id: 'u1', email: 'owner@tradeathletes.com', display_name: 'Constantinos', role: 'owner', created_at: ago(20) }],
};
const guest = typeof location !== 'undefined' && location.search.includes('guest');
const session = guest ? null : { access_token: 'preview', user: { id: 'u1', email: 'owner@tradeathletes.com' } } as { access_token: string; user: { id: string; email: string } } | null;
export const COMPANY_ENABLED = true;
export const companyClient = {
  from: (t: string) => builder(t),
  rpc: (name: string) => Promise.resolve({ data: RPC[name] ?? null, error: null }),
  functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
  channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
  removeChannel: () => Promise.resolve(),
  auth: {
    getSession: () => Promise.resolve({ data: { session }, error: null }),
    getUser: () => Promise.resolve({ data: { user: session?.user ?? null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signOut: () => Promise.resolve({ error: null }),
  },
};
export const requireClient = () => companyClient as never;
