-- Candidate schema, generated into a versioned migration by Supabase CLI in CI.
-- Not applied to production. Existing integration kinds and RLS are retained.
begin;
create table public.firbo_connection_states (
 id uuid primary key default gen_random_uuid(), state_hash text not null unique check(state_hash ~ '^[a-f0-9]{64}$'),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in('youtube','tiktok','salesforce','quickbooks')),
 name text not null check(length(name) between 1 and 80), return_origin text not null,
 verifier text, status text not null check(status in('pending','exchanging','completed','failed')),
 expires_at timestamptz not null, integration_id uuid references public.integrations(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.firbo_connection_states enable row level security;
revoke all on public.firbo_connection_states from public,anon,authenticated;
grant all on public.firbo_connection_states to service_role;
create index firbo_connection_states_expiry on public.firbo_connection_states(expires_at);
create index firbo_connection_states_user on public.firbo_connection_states(user_id);
create index firbo_connection_states_org on public.firbo_connection_states(organization_id);
create index firbo_connection_states_connection on public.firbo_connection_states(integration_id);
alter table public.integration_secrets add column refresh_lease_id uuid, add column refresh_lease_until timestamptz;
-- Extend the CURRENT database constraint instead of replacing newer legacy kinds.
do $$ declare expression text; begin
 select pg_get_expr(conbin,conrelid) into expression from pg_constraint where conrelid='public.integrations'::regclass and conname='integrations_kind_check';
 if expression is null then raise exception 'Expected integrations kind constraint is missing; reconcile schema first';end if;
 alter table public.integrations drop constraint integrations_kind_check;
 execute format('alter table public.integrations add constraint integrations_kind_check check ((%s) OR kind = ANY(ARRAY[''youtube'',''tiktok'',''salesforce'',''quickbooks'',''homeassistant_devices'',''traccar'']::text[]))',expression);
end $$;
-- Security INVOKER + service-role-only execute: user supplied JWTs cannot call it.
create function public.firbo_save_connection(p_org uuid,p_user uuid,p_kind text,p_name text,p_config jsonb,p_secret text,p_state_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare new_id uuid; cap integer; state public.firbo_connection_states%rowtype;begin
 if p_kind not in('youtube','tiktok','salesforce','quickbooks','homeassistant_devices','traccar') then raise exception 'bad_kind';end if;
 if not exists(select 1 from public.organization_members where organization_id=p_org and user_id=p_user and role in('owner','admin','manager')) then raise exception 'forbidden';end if;
 if length(p_secret)<10 or length(p_secret)>100000 or length(p_name) not between 1 and 80 then raise exception 'bad_request';end if;
 -- Serialize connections per company, including rechecks after provider consent.
 perform 1 from public.organizations where id=p_org for update;
 if p_state_hash is not null then
  select * into state from public.firbo_connection_states where state_hash=p_state_hash for update;
  if not found or state.organization_id<>p_org or state.user_id<>p_user or state.kind<>p_kind or state.status<>'exchanging' or state.expires_at<=now() then raise exception 'bad_state';end if;
 elsif p_kind not in('homeassistant_devices','traccar') then raise exception 'state_required';end if;
 select public.plan_limit(p_org,'integrations') into cap;
 if cap is null then raise exception 'plan_unavailable';end if;
 if (select count(*) from public.integrations where organization_id=p_org)>=cap then raise exception 'plan_limit';end if;
 insert into public.integrations(organization_id,kind,name,config,status,created_by,last_used_at) values(p_org,p_kind,p_name,p_config,'active',p_user,now()) returning id into new_id;
 insert into public.integration_secrets(integration_id,secret) values(new_id,p_secret);
 if p_state_hash is not null then update public.firbo_connection_states set status='completed',verifier=null,integration_id=new_id where state_hash=p_state_hash;end if;
 return new_id;
end $$;
revoke all on function public.firbo_save_connection(uuid,uuid,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.firbo_save_connection(uuid,uuid,text,text,jsonb,text,text) to service_role;
create function public.firbo_acquire_connection_refresh(p_id uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 update public.integration_secrets set refresh_lease_id=p_lease,refresh_lease_until=now()+interval '30 seconds'
 where integration_id=p_id and (refresh_lease_until is null or refresh_lease_until<now());
 return found;
end $$;
revoke all on function public.firbo_acquire_connection_refresh(uuid,uuid) from public,anon,authenticated;
grant execute on function public.firbo_acquire_connection_refresh(uuid,uuid) to service_role;
commit;
