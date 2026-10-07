-- Extend the existing private ledger to mission/meeting model calls.
-- No old ledger migration is replayed and the agent-chat contract is unchanged.
alter table private.inference_requests drop constraint inference_requests_source_check;
alter table private.inference_requests add constraint inference_requests_source_check
  check (source in ('agent-chat','mission-runner'));

create or replace function public.firbo_reserve_inference(
  p_org uuid,
  p_user uuid,
  p_agent uuid,
  p_source text,
  p_request_key uuid,
  p_reserved_usd numeric,
  p_hourly_limit integer,
  p_daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing private.inference_requests%rowtype;
  v_budget numeric;
  v_spent numeric := 0;
  v_reserved numeric := 0;
  v_hourly integer := 0;
  v_daily integer := 0;
  v_id uuid;
begin
  if p_source is null or p_source not in ('agent-chat','mission-runner')
     or p_user is null
     or p_request_key is null
     or p_reserved_usd is null or p_reserved_usd < 0 or p_reserved_usd > 1000
     or p_reserved_usd <> round(p_reserved_usd, 6)
     or p_hourly_limit is null or p_hourly_limit < 1 or p_hourly_limit > 100000
     or p_daily_limit is null or p_daily_limit < 1 or p_daily_limit > 100000 then
    raise exception using errcode = '22023', message = 'invalid_inference_reservation';
  end if;

  perform 1 from public.organizations where id = p_org;
  if not found then
    raise exception using errcode = 'P0002', message = 'organization_not_found';
  end if;
  perform 1 from public.organization_members
    where organization_id = p_org and user_id = p_user
      and role in ('owner','admin','manager','member');
  if not found then
    raise exception using errcode = '42501', message = 'inference_actor_not_authorized';
  end if;
  -- One private organization lock serializes the global daily counter. Every
  -- caller takes it before the agent lock, so different agents cannot deadlock.
  insert into private.inference_accounting_locks (organization_id)
    values (p_org) on conflict (organization_id) do nothing;
  update private.inference_accounting_locks
    set sequence = sequence + 1
    where organization_id = p_org;

  select * into v_existing
    from private.inference_requests
    where organization_id = p_org and source = p_source and request_key = p_request_key;
  if found then
    if v_existing.agent_id <> p_agent or v_existing.user_id is distinct from p_user then
      raise exception using errcode = '22023', message = 'request_key_conflict';
    end if;
    return jsonb_build_object(
      'ok', v_existing.status = 'reserved',
      'duplicate', true,
      'request_id', v_existing.id,
      'status', v_existing.status,
      'reason', case when v_existing.status = 'reserved' then null else 'request_already_resolved' end
    );
  end if;

  select monthly_budget_usd into v_budget
    from public.agents
    where id = p_agent and organization_id = p_org and enabled = true
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'agent_not_available';
  end if;

  select
    (select count(*) from private.inference_requests
      where agent_id = p_agent
        and created_at >= now() - interval '1 hour'
        and status <> 'released')
    +
    (select count(*) from public.usage_events
      where agent_id = p_agent
        and inference_request_id is null
        and created_at >= now() - interval '1 hour')
    into v_hourly;
  if v_hourly >= p_hourly_limit then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'hourly', v_hourly, 'limit', p_hourly_limit);
  end if;

  select
    (select count(*) from private.inference_requests
      where organization_id = p_org
        and created_at >= now() - interval '24 hours'
        and status <> 'released')
    +
    (select count(*) from public.usage_events
      where organization_id = p_org
        and inference_request_id is null
        and created_at >= now() - interval '24 hours')
    into v_daily;
  if v_daily >= p_daily_limit then
    return jsonb_build_object('ok', false, 'reason', 'plan_limit', 'daily', v_daily, 'limit', p_daily_limit);
  end if;

  if p_reserved_usd > 0 and v_budget is not null then
    select coalesce(sum(cost_usd), 0) into v_spent
      from public.usage_events
      where agent_id = p_agent and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    select coalesce(sum(reserved_usd), 0) into v_reserved
      from private.inference_requests
      where agent_id = p_agent
        and status in ('reserved','reconcile_required')
        and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    if v_spent + v_reserved + p_reserved_usd > v_budget then
      return jsonb_build_object(
        'ok', false,
        'reason', 'budget_exceeded',
        'spent', v_spent,
        'reserved', v_reserved,
        'requested', p_reserved_usd,
        'budget', v_budget
      );
    end if;
  end if;

  insert into private.inference_requests
    (organization_id, user_id, agent_id, source, request_key, reserved_usd)
  values
    (p_org, p_user, p_agent, p_source, p_request_key, p_reserved_usd)
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', v_id,
    'status', 'reserved',
    'spent', v_spent,
    'reserved', v_reserved,
    'budget', v_budget
  );
end;
$$;

revoke all on function public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer) from public, anon, authenticated;
grant execute on function public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer) to service_role;
