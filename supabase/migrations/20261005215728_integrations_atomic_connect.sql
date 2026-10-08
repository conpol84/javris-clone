-- Legacy token and OAuth connections must not publish an active row without credentials.
-- Keep the service-only boundary; authenticated clients cannot supply an arbitrary actor.
begin;
create function public.firbo_save_legacy_integration(
  p_org uuid, p_user uuid, p_kind text, p_name text, p_config jsonb, p_secret text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.integrations%rowtype;
  cap integer;
begin
  if p_kind is null or p_kind in ('youtube', 'tiktok', 'salesforce', 'quickbooks', 'homeassistant_devices', 'traccar') then
    raise exception 'bad_kind';
  end if;
  if p_name is null or char_length(p_name) not between 1 and 80
     or p_config is null or jsonb_typeof(p_config) <> 'object'
     or p_secret is null or char_length(p_secret) not between 2 and 100000
     or jsonb_typeof(p_secret::jsonb) <> 'object' or p_secret::jsonb = '{}'::jsonb then
    raise exception 'bad_request';
  end if;
  -- Serialize the final quota check, and recheck the member after provider verification.
  perform 1 from public.organizations where id = p_org for update;
  if not found then raise exception 'forbidden'; end if;
  perform 1 from public.organization_members
   where organization_id = p_org and user_id = p_user and role in ('owner', 'admin', 'manager') for share;
  if not found then raise exception 'forbidden'; end if;
  select public.plan_limit(p_org, 'integrations') into cap;
  if cap is null then raise exception 'plan_unavailable'; end if;
  if (select count(*) from public.integrations where organization_id = p_org) >= cap then
    raise exception 'plan_limit';
  end if;
  insert into public.integrations (organization_id, kind, name, config, status, created_by, last_used_at)
    values (p_org, p_kind, p_name, p_config, 'active', p_user, now()) returning * into saved;
  insert into public.integration_secrets (integration_id, secret) values (saved.id, p_secret);
  return jsonb_build_object(
    'id', saved.id, 'kind', saved.kind, 'name', saved.name, 'config', saved.config,
    'status', saved.status, 'last_error', saved.last_error, 'last_used_at', saved.last_used_at,
    'created_at', saved.created_at
  );
end $$;
revoke all on function public.firbo_save_legacy_integration(uuid, uuid, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.firbo_save_legacy_integration(uuid, uuid, text, text, jsonb, text) to service_role;
commit;
