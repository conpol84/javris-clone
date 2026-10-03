-- Tasks, approvals, workflows, usage metering and audit log.
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  assigned_agent_id uuid,
  parent_task_id uuid references public.tasks (id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'pending'
    check (status in ('pending','running','blocked','awaiting_approval','completed','failed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  result jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, assigned_agent_id) references public.agents (organization_id, id) on delete set null (assigned_agent_id)
);
create index tasks_org_status_idx on public.tasks (organization_id, status, priority);
create index tasks_agent_idx on public.tasks (assigned_agent_id);
create index tasks_parent_idx on public.tasks (parent_task_id);
create index tasks_created_by_idx on public.tasks (created_by);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid,
  agent_id uuid,
  action text not null,                          -- e.g. send_email, github.merge
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','approved','rejected','expired')),
  requested_at timestamptz not null default now(),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  foreign key (organization_id, task_id) references public.tasks (organization_id, id) on delete cascade,
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
create index approvals_org_status_idx on public.approvals (organization_id, status);
create index approvals_task_idx on public.approvals (task_id);
create index approvals_agent_idx on public.approvals (agent_id);
create index approvals_decided_by_idx on public.approvals (decided_by);

create table public.workflows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  enabled boolean not null default false,
  trigger_type text not null default 'manual' check (trigger_type in ('manual','schedule','event','webhook')),
  trigger_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index workflows_org_idx on public.workflows (organization_id);

create table public.workflow_steps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  workflow_id uuid not null,
  position integer not null,
  agent_id uuid,
  action text not null,
  config jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '{}'::jsonb,
  requires_approval boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workflow_id, position),
  foreign key (organization_id, workflow_id) references public.workflows (organization_id, id) on delete cascade,
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
create index workflow_steps_org_idx on public.workflow_steps (organization_id);
create index workflow_steps_agent_idx on public.workflow_steps (agent_id);

create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  agent_id uuid,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric(12,6) not null default 0,
  latency_ms integer,
  created_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
create index usage_events_org_time_idx on public.usage_events (organization_id, created_at desc);
create index usage_events_user_idx on public.usage_events (user_id);
create index usage_events_agent_idx on public.usage_events (agent_id);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id uuid references auth.users (id) on delete set null,
  agent_id uuid,
  action text not null,
  entity text,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, agent_id) references public.agents (organization_id, id) on delete set null (agent_id)
);
create index audit_log_org_time_idx on public.audit_log (organization_id, created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_id);
create index audit_log_agent_idx on public.audit_log (agent_id);

create trigger tasks_updated_at before update on public.tasks for each row execute function private.set_updated_at();
create trigger workflows_updated_at before update on public.workflows for each row execute function private.set_updated_at();

-- RLS
do $$
declare t text;
begin
  -- Any non-viewer member can work with tasks.
  foreach t in array array['tasks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (private.is_member(organization_id))', t);
    execute format('create policy "writers insert" on public.%I for insert to authenticated with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'',''member'']))', t);
    execute format('create policy "writers update" on public.%I for update to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager'',''member''])) with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'',''member'']))', t);
    execute format('create policy "managers delete" on public.%I for delete to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
  end loop;
  foreach t in array array['workflows','workflow_steps'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "members read" on public.%I for select to authenticated using (private.is_member(organization_id))', t);
    execute format('create policy "managers insert" on public.%I for insert to authenticated with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
    execute format('create policy "managers update" on public.%I for update to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager''])) with check (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
    execute format('create policy "managers delete" on public.%I for delete to authenticated using (private.has_role(organization_id, array[''owner'',''admin'',''manager'']))', t);
  end loop;
end $$;

-- Approvals: members can see and request; only managers+ decide.
alter table public.approvals enable row level security;
create policy "members read approvals" on public.approvals
  for select to authenticated using (private.is_member(organization_id));
create policy "writers request approvals" on public.approvals
  for insert to authenticated
  with check (status = 'pending' and private.has_role(organization_id, array['owner','admin','manager','member']));
create policy "managers decide approvals" on public.approvals
  for update to authenticated
  using (private.has_role(organization_id, array['owner','admin','manager']))
  with check (private.has_role(organization_id, array['owner','admin','manager']));

-- Usage: admins/managers read; writes only by the backend (service role bypasses RLS).
alter table public.usage_events enable row level security;
create policy "managers read usage" on public.usage_events
  for select to authenticated using (private.has_role(organization_id, array['owner','admin','manager']));

-- Audit log: owners/admins read; immutable for clients (no write policies).
alter table public.audit_log enable row level security;
create policy "admins read audit" on public.audit_log
  for select to authenticated using (private.has_role(organization_id, array['owner','admin']));

revoke all on all tables in schema public from anon;
