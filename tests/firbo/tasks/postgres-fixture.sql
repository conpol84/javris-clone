-- Connector compatibility fixture for stock PostgreSQL CI only. The common
-- loader supplies actual tenancy/tasks/approvals/audit/workflow tables + RLS.
-- This models the existing connector's read-only client boundary and the
-- execution-receipt migration's ON DELETE SET NULL references. It does not
-- claim to rebuild the full live connector schema, device tokens or pairing.
create table public.connector_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  paired boolean not null default false,
  capabilities jsonb not null default '{"job_kinds":[]}'::jsonb,
  created_at timestamptz not null default now()
);
create table public.connector_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  device_id uuid not null references public.connector_devices(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  approval_id uuid references public.approvals(id) on delete set null,
  kind text not null check (kind in ('list','read','write','exec','browser_open')),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','running','done','error','cancelled')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  result jsonb,
  report_sha256 text,
  receipt jsonb
);
alter table public.connector_devices enable row level security;
alter table public.connector_jobs enable row level security;
create policy "admins read devices" on public.connector_devices for select to authenticated
  using (private.has_role(organization_id,array['owner','admin']));
create policy "admins read jobs" on public.connector_jobs for select to authenticated
  using (private.has_role(organization_id,array['owner','admin']));
grant select,insert,update,delete on public.connector_devices,public.connector_jobs to authenticated,service_role;
