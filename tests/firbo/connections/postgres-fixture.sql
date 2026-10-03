-- Disposable CI database only: deliberately minimal existing application schema.
create role anon; create role authenticated; create role service_role bypassrls;
create schema auth;create table auth.users(id uuid primary key);
create table public.organizations(id uuid primary key);
create table public.organization_members(organization_id uuid,user_id uuid,role text);
create table public.integrations(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations(id),kind text constraint integrations_kind_check check(kind in('legacy_future_app','gmail')),name text,config jsonb,status text,created_by uuid,last_used_at timestamptz);
create table public.integration_secrets(integration_id uuid primary key references public.integrations(id) on delete cascade,secret text);
alter table public.integration_secrets enable row level security;revoke all on public.integration_secrets from public,anon,authenticated;
create function public.plan_limit(p_org uuid,p_key text)returns integer language sql as $$ select 2 $$;
grant usage on schema public,auth to service_role;
grant all on all tables in schema public,auth to service_role;
insert into auth.users values('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.organizations values('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
insert into public.organization_members values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','owner');
