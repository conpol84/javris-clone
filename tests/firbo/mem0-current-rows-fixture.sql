\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key);

create table public.organizations (id uuid primary key);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id),
  user_id uuid not null references auth.users(id),
  role text not null,
  primary key (organization_id, user_id)
);
create table public.agents (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  enabled boolean not null default true,
  unique (organization_id, id)
);
create table public.memories (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  agent_id uuid,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  updated_at timestamptz not null default statement_timestamp(),
  foreign key (organization_id, agent_id) references public.agents(organization_id, id)
);

alter table public.organization_members enable row level security;
alter table public.agents enable row level security;
alter table public.memories enable row level security;

grant usage on schema public to anon, authenticated, service_role;
grant select on public.organization_members, public.agents, public.memories to service_role;

insert into auth.users(id) values
  ('00000000-0000-0000-0000-000000000101'),
  ('00000000-0000-0000-0000-000000000102');
insert into public.organizations(id) values
  ('00000000-0000-0000-0000-000000000201'),
  ('00000000-0000-0000-0000-000000000202');
insert into public.organization_members(organization_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'owner'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000102', 'owner');
insert into public.agents(id, organization_id, enabled) values
  ('00000000-0000-0000-0000-000000000301', '00000000-0000-0000-0000-000000000201', true),
  ('00000000-0000-0000-0000-000000000302', '00000000-0000-0000-0000-000000000201', true),
  ('00000000-0000-0000-0000-000000000303', '00000000-0000-0000-0000-000000000202', true),
  ('00000000-0000-0000-0000-000000000304', '00000000-0000-0000-0000-000000000201', false);
insert into public.memories(id, organization_id, agent_id, content, metadata, expires_at, updated_at) values
  ('00000000-0000-0000-0000-000000000401', '00000000-0000-0000-0000-000000000201', null, 'company-current', '{}', null, '2026-10-07T23:00:00Z'),
  ('00000000-0000-0000-0000-000000000402', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000301', 'agent-current', '{}', null, '2026-10-07T23:00:01Z'),
  ('00000000-0000-0000-0000-000000000403', '00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000302', 'other-agent', '{}', null, '2026-10-07T23:00:02Z'),
  ('00000000-0000-0000-0000-000000000404', '00000000-0000-0000-0000-000000000201', null, 'expired', '{}', '2020-01-01T00:00:00Z', '2026-10-07T23:00:03Z'),
  ('00000000-0000-0000-0000-000000000405', '00000000-0000-0000-0000-000000000201', null, 'deleted', '{"deleted_at":"2026-10-07T23:00:00Z"}', null, '2026-10-07T23:00:04Z'),
  ('00000000-0000-0000-0000-000000000406', '00000000-0000-0000-0000-000000000202', null, 'foreign-company', '{}', null, '2026-10-07T23:00:05Z');
