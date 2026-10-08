-- Disposable database only; load the real integrations migration after this fixture.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create schema private;
create table auth.users (id uuid primary key);
create table public.organizations (id uuid primary key, integration_cap integer not null default 2);
create table public.organization_members (organization_id uuid, user_id uuid, role text);
create function private.has_role(uuid, text[]) returns boolean language sql as $$ select false $$;
create function public.plan_limit(p_org uuid, p_key text) returns integer language sql as $$
  select integration_cap from public.organizations where id = p_org
$$;
insert into auth.users values
 ('22222222-2222-4222-8222-222222222222'),
 ('44444444-4444-4444-8444-444444444444');
insert into public.organizations (id) values ('11111111-1111-4111-8111-111111111111');
insert into public.organization_members values
 ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'manager'),
 ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444', 'viewer');
