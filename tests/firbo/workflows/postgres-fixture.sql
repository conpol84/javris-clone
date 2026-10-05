-- Disposable stock PostgreSQL fixture; mirrors the pre-migration tenancy/workflow
-- columns and policies without installing vector, cron, or contacting providers.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}'::jsonb);
create function auth.uid() returns uuid language sql stable as $$
 select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$$;
grant usage on schema auth,private to authenticated;
create table public.organizations(id uuid primary key default gen_random_uuid(),name text not null,slug text not null unique);
create table public.organization_members(organization_id uuid references public.organizations on delete cascade,
 user_id uuid references auth.users on delete cascade,role text,primary key(organization_id,user_id));
create function private.is_member(p_org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid())
$$;
create function private.has_role(p_org uuid,p_roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members m where m.organization_id=p_org and m.user_id=auth.uid() and m.role=any(p_roles))
$$;
revoke all on function private.is_member(uuid),private.has_role(uuid,text[]) from public,anon;
grant execute on function private.is_member(uuid),private.has_role(uuid,text[]) to authenticated;
alter table public.organization_members enable row level security;
create policy members_read on public.organization_members for select to authenticated using(private.is_member(organization_id));
grant select on public.organizations,public.organization_members to authenticated;
create table public.agents(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations on delete cascade,
 name text,slug text,enabled boolean not null default true,unique(organization_id,id));
alter table public.agents enable row level security;
create policy members_read on public.agents for select to authenticated using(private.is_member(organization_id));
grant select on public.agents to authenticated;
create table public.workflows(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations on delete cascade,
 name text not null,description text,enabled boolean not null default false,trigger_type text not null default 'manual' check(trigger_type in('manual','schedule','event','webhook')),
 trigger_config jsonb not null default '{}',created_by uuid references auth.users on delete set null,next_run_at timestamptz,hook_hash text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(organization_id,id));
create table public.workflow_steps(id uuid primary key default gen_random_uuid(),organization_id uuid not null,workflow_id uuid not null,
 position integer not null,agent_id uuid,action text not null,config jsonb not null default '{}',conditions jsonb not null default '{}',requires_approval boolean not null default true,
 created_at timestamptz not null default now(),unique(workflow_id,position),
 foreign key(organization_id,workflow_id) references public.workflows(organization_id,id) on delete cascade,
 foreign key(organization_id,agent_id) references public.agents(organization_id,id) on delete set null(agent_id));
create table public.workflow_runs(id uuid primary key default gen_random_uuid(),organization_id uuid not null references public.organizations on delete cascade,
 workflow_id uuid not null references public.workflows on delete cascade,status text not null default 'running' check(status in('running','completed','failed')),
 step integer not null default 0,task_id uuid,input text,trigger text not null default 'manual',started_by uuid references auth.users on delete set null,result jsonb,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),finished_at timestamptz);
do $$ declare t text; begin
 foreach t in array array['workflows','workflow_steps'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy "members read" on public.%I for select to authenticated using(private.is_member(organization_id))',t);
  execute format('create policy "managers insert" on public.%I for insert to authenticated with check(private.has_role(organization_id,array[''owner'',''admin'',''manager'']))',t);
  execute format('create policy "managers update" on public.%I for update to authenticated using(private.has_role(organization_id,array[''owner'',''admin'',''manager''])) with check(private.has_role(organization_id,array[''owner'',''admin'',''manager'']))',t);
  execute format('create policy "managers delete" on public.%I for delete to authenticated using(private.has_role(organization_id,array[''owner'',''admin'',''manager'']))',t);
 end loop;
end $$;
alter table public.workflow_runs enable row level security;
create policy "members read" on public.workflow_runs for select to authenticated using(private.is_member(organization_id));
grant select,insert,update,delete on public.workflows,public.workflow_steps to authenticated;
grant select on public.workflow_runs to authenticated;
grant usage on schema auth,private,public to service_role;
grant all on all tables in schema auth,public to service_role;
