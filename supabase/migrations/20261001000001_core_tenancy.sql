-- Core multi-tenancy: organizations, profiles, memberships, RLS helpers.
create extension if not exists vector with schema extensions;

-- Helper schema is NOT exposed through the Data API.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  logo_url text,
  plan text not null default 'free',
  status text not null default 'active' check (status in ('active','suspended','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  avatar_url text,
  timezone text not null default 'UTC',
  default_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_default_org_idx on public.profiles (default_organization_id);

create table public.organization_members (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','manager','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index organization_members_user_idx on public.organization_members (user_id);

create trigger organizations_updated_at before update on public.organizations
  for each row execute function private.set_updated_at();
create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();

-- RLS helpers (SECURITY DEFINER avoids policy recursion on organization_members).
create or replace function private.is_member(org uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid())
  )
$$;

create or replace function private.has_role(org uuid, roles text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = org and m.user_id = (select auth.uid()) and m.role = any (roles)
  )
$$;

create or replace function private.shares_org(other uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.organization_members a
    join public.organization_members b on a.organization_id = b.organization_id
    where a.user_id = (select auth.uid()) and b.user_id = other
  )
$$;

revoke all on function private.is_member(uuid), private.has_role(uuid, text[]), private.shares_org(uuid) from public, anon;
grant execute on function private.is_member(uuid), private.has_role(uuid, text[]), private.shares_org(uuid) to authenticated;

-- Create a profile for every new auth user.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function private.handle_new_user();

-- Organizations are created through this RPC so the creator becomes owner atomically.
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  org_id uuid;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into org_id;
  insert into public.organization_members (organization_id, user_id, role) values (org_id, uid, 'owner');
  update public.profiles set default_organization_id = coalesce(default_organization_id, org_id) where id = uid;
  return org_id;
end $$;
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- RLS
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;

create policy "members read organization" on public.organizations
  for select to authenticated using (private.is_member(id));
create policy "admins update organization" on public.organizations
  for update to authenticated
  using (private.has_role(id, array['owner','admin']))
  with check (private.has_role(id, array['owner','admin']));
create policy "owners delete organization" on public.organizations
  for delete to authenticated using (private.has_role(id, array['owner']));

create policy "read own or co-member profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()) or private.shares_org(id));
create policy "insert own profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and (default_organization_id is null or private.is_member(default_organization_id))
  );

create policy "members read memberships" on public.organization_members
  for select to authenticated using (private.is_member(organization_id));
create policy "admins add members" on public.organization_members
  for insert to authenticated
  with check (
    private.has_role(organization_id, array['owner','admin'])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']))
  );
create policy "admins change roles" on public.organization_members
  for update to authenticated
  using (
    private.has_role(organization_id, array['owner','admin'])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']))
  )
  with check (
    private.has_role(organization_id, array['owner','admin'])
    and (role <> 'owner' or private.has_role(organization_id, array['owner']))
  );
create policy "admins remove members or self leave" on public.organization_members
  for delete to authenticated
  using (
    (private.has_role(organization_id, array['owner','admin'])
      and (role <> 'owner' or private.has_role(organization_id, array['owner'])))
    or (user_id = (select auth.uid()) and role <> 'owner')
  );

-- Never expose new tables to the anonymous role.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
revoke all on all tables in schema public from anon;
