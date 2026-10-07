// Firbo AI platform admin overview: every company, user and cost at a glance.
// Only users listed in public.platform_admins may call it (checked here, with the service role).
import { createClient } from 'npm:@supabase/supabase-js@2';

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: who } = await userClient.auth.getUser();
  const user = who?.user;
  if (!user) return json(401, { error: 'unauthorized' });

  const admin = createClient(url, service);
  const { data: isAdmin } = await admin.from('platform_admins').select('user_id').eq('user_id', user.id).maybeSingle();
  if (!isAdmin) return json(403, { error: 'forbidden' });

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [orgs, members, agents, openTasks, usage, users] = await Promise.all([
    admin.from('organizations').select('id, name, slug, status, created_at').order('created_at', { ascending: false }).limit(500),
    admin.from('organization_members').select('organization_id').limit(50000),
    admin.from('agents').select('organization_id').eq('enabled', true).limit(50000),
    admin.from('tasks').select('organization_id').in('status', ['pending', 'running', 'blocked', 'awaiting_approval']).limit(50000),
    admin.from('usage_events').select('organization_id, input_tokens, output_tokens, cost_usd').gte('created_at', since).limit(50000),
    admin.auth.admin.listUsers({ page: 1, perPage: 200 }),
  ]);

  const tally = (rows: { organization_id: string }[] | null) => {
    const m = new Map<string, number>();
    for (const r of rows ?? []) m.set(r.organization_id, (m.get(r.organization_id) ?? 0) + 1);
    return m;
  };
  const memberN = tally(members.data as any);
  const agentN = tally(agents.data as any);
  const taskN = tally(openTasks.data as any);
  const cost = new Map<string, { cost: number; tokens: number; runs: number }>();
  for (const r of (usage.data ?? []) as any[]) {
    const e = cost.get(r.organization_id) ?? { cost: 0, tokens: 0, runs: 0 };
    e.cost += Number(r.cost_usd ?? 0);
    e.tokens += Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0);
    e.runs += 1;
    cost.set(r.organization_id, e);
  }

  const companies = ((orgs.data ?? []) as any[]).map((o) => ({
    id: o.id,
    name: o.name,
    status: o.status,
    created_at: o.created_at,
    members: memberN.get(o.id) ?? 0,
    agents: agentN.get(o.id) ?? 0,
    open_tasks: taskN.get(o.id) ?? 0,
    cost30d: Math.round((cost.get(o.id)?.cost ?? 0) * 1e4) / 1e4,
    tokens30d: cost.get(o.id)?.tokens ?? 0,
    runs30d: cost.get(o.id)?.runs ?? 0,
  }));
  const people = ((users.data?.users ?? []) as any[]).map((u) => ({
    id: u.id,
    email: u.email ?? '',
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at ?? null,
  }));
  const totals = {
    companies: companies.length,
    users: users.data?.total ?? people.length,
    agents: companies.reduce((n, c) => n + c.agents, 0),
    open_tasks: companies.reduce((n, c) => n + c.open_tasks, 0),
    cost30d: Math.round(companies.reduce((n, c) => n + c.cost30d, 0) * 1e4) / 1e4,
    tokens30d: companies.reduce((n, c) => n + c.tokens30d, 0),
    runs30d: companies.reduce((n, c) => n + c.runs30d, 0),
  };
  return json(200, { totals, companies, users: people });
});
