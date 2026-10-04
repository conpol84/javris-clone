-- Bring-your-own API keys for Pro, Business and Enterprise companies.
-- The key itself is stored encrypted in Supabase Vault. This table only says which provider is connected,
-- the last characters of the key (to recognise it) and the chat models the key can use.
-- Clients can read the hints; only the provider-keys edge function (service role) can save or remove a key,
-- and only the agent edge functions (service role) can read the secret, through provider_key_for_runtime.

create table if not exists public.org_provider_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in ('openai','anthropic','google','groq','mistral','deepseek','openrouter','xai')),
  key_hint text not null check (char_length(key_hint) between 1 and 12),
  models text[] not null default '{}',
  secret_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);
alter table public.org_provider_keys enable row level security;
drop policy if exists "members read key hints" on public.org_provider_keys;
create policy "members read key hints" on public.org_provider_keys for select to authenticated using (private.is_member(organization_id));
revoke all on public.org_provider_keys from anon, authenticated;
grant select (id, organization_id, provider, key_hint, models, created_at, updated_at) on public.org_provider_keys to authenticated;

-- Usage paid by the company's own key is recorded at $0 for Firbo and marked, so analytics can show it apart.
alter table public.usage_events add column if not exists own_key boolean not null default false;

create or replace function private.plan_has_feature(org uuid, f text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select f = any(p.features) or 'everything' = any(p.features)
    from public.organizations o join public.plans p on p.id = o.plan
    where o.id = org
  ), false)
$$;
revoke all on function private.plan_has_feature(uuid, text) from public, anon, authenticated;

create or replace function public.provider_key_store(p_org uuid, p_provider text, p_key text, p_hint text, p_models text[], p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  existing uuid;
  sid uuid;
  row_id uuid;
begin
  if not private.plan_has_feature(p_org, 'byo_keys') then raise exception 'plan_limit:byo_keys'; end if;
  if p_key is null or char_length(p_key) not between 8 and 400 then raise exception 'invalid_key'; end if;
  select secret_id into existing from public.org_provider_keys where organization_id = p_org and provider = p_provider;
  if existing is not null then
    perform vault.update_secret(existing, p_key);
    update public.org_provider_keys
      set key_hint = p_hint, models = coalesce(p_models, '{}'), created_by = p_user, updated_at = now()
      where organization_id = p_org and provider = p_provider
      returning id into row_id;
  else
    sid := vault.create_secret(p_key, 'firbo_org_key_' || p_org || '_' || p_provider, 'Firbo company API key (' || p_provider || ')');
    insert into public.org_provider_keys (organization_id, provider, key_hint, models, secret_id, created_by)
      values (p_org, p_provider, p_hint, coalesce(p_models, '{}'), sid, p_user)
      returning id into row_id;
  end if;
  perform private.write_audit(p_org, 'key.saved', 'provider_key', row_id, jsonb_build_object('provider', p_provider, 'hint', p_hint, 'by', p_user));
end $$;

create or replace function public.provider_key_remove(p_org uuid, p_provider text, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
  row_id uuid;
begin
  delete from public.org_provider_keys where organization_id = p_org and provider = p_provider returning secret_id, id into sid, row_id;
  if sid is not null then
    delete from vault.secrets where id = sid;
    perform private.write_audit(p_org, 'key.removed', 'provider_key', row_id, jsonb_build_object('provider', p_provider, 'by', p_user));
  end if;
end $$;

-- Returns the key only while the company's plan includes own keys; a downgraded company silently falls back to Firbo's models.
create or replace function public.provider_key_for_runtime(p_org uuid, p_provider text)
returns text language sql stable security definer set search_path = '' as $$
  select s.decrypted_secret
  from public.org_provider_keys k
  join vault.decrypted_secrets s on s.id = k.secret_id
  where k.organization_id = p_org and k.provider = p_provider and private.plan_has_feature(p_org, 'byo_keys')
$$;

revoke all on function public.provider_key_store(uuid, text, text, text, text[], uuid) from public, anon, authenticated;
revoke all on function public.provider_key_remove(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.provider_key_for_runtime(uuid, text) from public, anon, authenticated;
grant execute on function public.provider_key_store(uuid, text, text, text, text[], uuid) to service_role;
grant execute on function public.provider_key_remove(uuid, text, uuid) to service_role;
grant execute on function public.provider_key_for_runtime(uuid, text) to service_role;

-- Enterprise ("everything") also gets the own-keys badge on the plans page.
update public.plans set features = array_append(features, 'byo_keys') where id = 'enterprise' and not ('byo_keys' = any(features));
