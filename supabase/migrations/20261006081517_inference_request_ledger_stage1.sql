-- Stage 1 of Firbo's server-owned inference accounting ledger.
--
-- This stage moves agent-chat admission and usage persistence into one
-- database-owned boundary.  The row locks make monthly spend, hourly runs and
-- company daily runs atomic across concurrent Edge Function instances.  Other
-- inference paths deliberately remain on their existing guards until they are
-- migrated and tested separately; this migration must not be described as the
-- completed global ledger.

-- A per-company write lock is separate from the customer-facing organization
-- row, so accounting does not churn organization.updated_at or contend with
-- profile edits. Incrementing the sequence also makes SERIALIZABLE callers
-- fail safely instead of reading a pre-lock snapshot.
create table private.inference_accounting_locks (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  sequence bigint not null default 0
);
alter table private.inference_accounting_locks enable row level security;
revoke all on table private.inference_accounting_locks from public, anon, authenticated, service_role;

create table private.inference_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  agent_id uuid not null,
  source text not null check (source in ('agent-chat')),
  request_key uuid not null,
  status text not null default 'reserved'
    check (status in ('reserved','settled','settled_overrun','reconcile_required','released')),
  reserved_usd numeric(12,6) not null check (reserved_usd >= 0 and reserved_usd <= 1000),
  actual_usd numeric(12,6) check (actual_usd is null or (actual_usd >= 0 and actual_usd <= 1000)),
  model text,
  input_tokens integer check (input_tokens is null or (input_tokens >= 0 and input_tokens <= 1000000000)),
  output_tokens integer check (output_tokens is null or (output_tokens >= 0 and output_tokens <= 1000000000)),
  latency_ms integer check (latency_ms is null or (latency_ms >= 0 and latency_ms <= 3600000)),
  own_key boolean not null default false,
  reconcile_reason text check (reconcile_reason is null or length(reconcile_reason) <= 80),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (organization_id, source, request_key),
  foreign key (organization_id, agent_id)
    references public.agents (organization_id, id) on delete cascade
);

create index inference_requests_agent_time_idx
  on private.inference_requests (agent_id, created_at desc);
create index inference_requests_org_time_idx
  on private.inference_requests (organization_id, created_at desc);
create index inference_requests_open_idx
  on private.inference_requests (agent_id, created_at)
  where status in ('reserved','reconcile_required');

alter table private.inference_requests enable row level security;
revoke all on table private.inference_requests from public, anon, authenticated, service_role;

alter table public.usage_events
  add column inference_request_id uuid unique
  references private.inference_requests (id) on delete restrict;

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
  if p_source <> 'agent-chat'
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

create or replace function public.firbo_settle_inference(
  p_request uuid,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cost_usd numeric,
  p_latency_ms integer,
  p_own_key boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.inference_requests%rowtype;
  v_status text;
begin
  if p_request is null
     or p_model is null or length(p_model) < 1 or length(p_model) > 240
     or p_input_tokens is null or p_input_tokens < 0 or p_input_tokens > 1000000000
     or p_output_tokens is null or p_output_tokens < 0 or p_output_tokens > 1000000000
     or p_cost_usd is null or p_cost_usd < 0 or p_cost_usd > 1000 or p_cost_usd <> round(p_cost_usd, 6)
     or p_latency_ms is null or p_latency_ms < 0 or p_latency_ms > 3600000 then
    raise exception using errcode = '22023', message = 'invalid_inference_settlement';
  end if;

  select * into v_request
    from private.inference_requests
    where id = p_request;
  if not found then
    raise exception using errcode = 'P0002', message = 'inference_request_not_found';
  end if;
  -- Use the same organization -> agent -> request lock order as admission.
  -- Otherwise settlement could move a reservation into usage_events between
  -- admission's two aggregate reads and make both amounts temporarily vanish.
  update private.inference_accounting_locks
    set sequence = sequence + 1
    where organization_id = v_request.organization_id;
  perform 1 from public.agents
    where id = v_request.agent_id and organization_id = v_request.organization_id
    for update;
  select * into v_request
    from private.inference_requests
    where id = p_request
    for update;
  if v_request.status in ('settled','settled_overrun') then
    return jsonb_build_object('ok', true, 'duplicate', true, 'request_id', v_request.id, 'status', v_request.status);
  end if;
  if v_request.status = 'released' then
    raise exception using errcode = '22023', message = 'inference_request_released';
  end if;

  v_status := case when p_cost_usd > v_request.reserved_usd then 'settled_overrun' else 'settled' end;
  insert into public.usage_events
    (organization_id, user_id, agent_id, model, input_tokens, output_tokens,
     cost_usd, latency_ms, own_key, inference_request_id)
  values
    (v_request.organization_id, v_request.user_id, v_request.agent_id, p_model,
     p_input_tokens, p_output_tokens, p_cost_usd, p_latency_ms,
     coalesce(p_own_key, false), v_request.id)
  on conflict (inference_request_id) do nothing;

  update private.inference_requests
    set status = v_status,
        actual_usd = p_cost_usd,
        model = p_model,
        input_tokens = p_input_tokens,
        output_tokens = p_output_tokens,
        latency_ms = p_latency_ms,
        own_key = coalesce(p_own_key, false),
        reconcile_reason = case when v_status = 'settled_overrun' then 'actual_cost_exceeded_reservation' else null end,
        resolved_at = now()
    where id = v_request.id;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', v_request.id,
    'status', v_status,
    'reserved_usd', v_request.reserved_usd,
    'actual_usd', p_cost_usd
  );
end;
$$;

create or replace function public.firbo_mark_inference_ambiguous(
  p_request uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.inference_requests%rowtype;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'provider_result_unknown'), 80);
begin
  select * into v_request
    from private.inference_requests
    where id = p_request;
  if not found then
    raise exception using errcode = 'P0002', message = 'inference_request_not_found';
  end if;
  update private.inference_accounting_locks
    set sequence = sequence + 1
    where organization_id = v_request.organization_id;
  perform 1 from public.agents
    where id = v_request.agent_id and organization_id = v_request.organization_id
    for update;
  select * into v_request
    from private.inference_requests
    where id = p_request
    for update;
  if v_request.status = 'reserved' then
    update private.inference_requests
      set status = 'reconcile_required', reconcile_reason = v_reason
      where id = p_request;
    v_request.status := 'reconcile_required';
  end if;
  return jsonb_build_object('ok', true, 'request_id', p_request, 'status', v_request.status);
end;
$$;

create or replace function public.firbo_release_inference(
  p_request uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.inference_requests%rowtype;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'released_before_provider'), 80);
begin
  select * into v_request
    from private.inference_requests
    where id = p_request;
  if not found then
    raise exception using errcode = 'P0002', message = 'inference_request_not_found';
  end if;
  update private.inference_accounting_locks
    set sequence = sequence + 1
    where organization_id = v_request.organization_id;
  perform 1 from public.agents
    where id = v_request.agent_id and organization_id = v_request.organization_id
    for update;
  select * into v_request
    from private.inference_requests
    where id = p_request
    for update;
  if v_request.status = 'reserved' then
    update private.inference_requests
      set status = 'released', reconcile_reason = v_reason, resolved_at = now()
      where id = p_request;
    v_request.status := 'released';
  end if;
  return jsonb_build_object('ok', true, 'request_id', p_request, 'status', v_request.status);
end;
$$;

revoke all on function public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)
  from public, anon, authenticated;
revoke all on function public.firbo_settle_inference(uuid,text,integer,integer,numeric,integer,boolean)
  from public, anon, authenticated;
revoke all on function public.firbo_mark_inference_ambiguous(uuid,text)
  from public, anon, authenticated;
revoke all on function public.firbo_release_inference(uuid,text)
  from public, anon, authenticated;
grant execute on function public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)
  to service_role;
grant execute on function public.firbo_settle_inference(uuid,text,integer,integer,numeric,integer,boolean)
  to service_role;
grant execute on function public.firbo_mark_inference_ambiguous(uuid,text)
  to service_role;
grant execute on function public.firbo_release_inference(uuid,text)
  to service_role;
