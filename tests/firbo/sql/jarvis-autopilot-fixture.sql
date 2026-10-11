-- Minimal PostgreSQL fixture for FIRBO JARVIS admission policies. No real
-- Supabase, credentials, customer identifiers, providers or network.
create extension if not exists pgcrypto;
create schema auth;
create schema private;
create role authenticated;
create role anon;
create role service_role bypassrls;
grant usage on schema public,auth,private to authenticated,service_role;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.organizations(id uuid primary key,name text,plan text,plan_status text,status text);
create table public.organization_members(organization_id uuid,user_id uuid,role text,primary key(organization_id,user_id));
create table public.agents(id uuid primary key,organization_id uuid,type text,slug text,enabled boolean,autonomy text);
create table public.conversations(id uuid primary key,organization_id uuid,user_id uuid,agent_id uuid,status text);
create table public.messages(id uuid primary key,organization_id uuid,conversation_id uuid,role text,content text);
create table public.tasks(
 id uuid primary key,organization_id uuid,created_by uuid,assigned_agent_id uuid,
 title text,description text,priority text,status text,metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),run_claim uuid,
 updated_at timestamptz default now(),result jsonb
);
create function private.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now();return new;end $$;
create function private.is_member(org uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members
  where organization_id=org and user_id=(select auth.uid()))
$$;
create function private.has_role(org uuid,roles text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.organization_members
  where organization_id=org and user_id=(select auth.uid()) and role=any(roles))
$$;
grant execute on function auth.uid(),private.is_member(uuid),private.has_role(uuid,text[]) to authenticated;
alter table public.messages enable row level security;
create policy test_messages_base on public.messages for insert to authenticated with check(true);
grant select,insert,update on public.messages to authenticated;
grant select on public.organizations,public.organization_members,public.agents,public.conversations,public.tasks to authenticated;
grant insert,update on public.tasks to authenticated;
grant all on all tables in schema public,auth to service_role;
grant execute on all functions in schema auth,private to service_role;
insert into auth.users values
 ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.organizations values ('33333333-3333-4333-8333-333333333333','Test company','business','active','active');
insert into public.organization_members values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','owner'),
 ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','admin');
insert into public.agents values
 ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','ceo','ceo',true,'approval'),
 ('55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','research','research',true,'auto');
insert into public.conversations values
 ('66666666-6666-4666-8666-666666666666','33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',
 '44444444-4444-4444-8444-444444444444','active');
insert into public.messages values
 ('77777777-7777-4777-8777-777777777777','33333333-3333-4333-8333-333333333333','66666666-6666-4666-8666-666666666666',
 'assistant',E'I will delegate:\n[[task:55555555-5555-4555-8555-555555555555]] Compare sector trends\nReturn public sources.');
