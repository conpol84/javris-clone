-- Claim-bound attempt ledger for agent-runner inference.
--
-- This migration deliberately does not switch the Edge Function to the new
-- path.  It establishes and tests the database boundary first: a task claim
-- owns a bounded sequence of attempts, and only one delivery may cross the
-- durable dispatch transition for a given attempt.  Existing chat/mission
-- signatures, quotas and settlement functions remain compatible.

begin;

alter table private.inference_requests
  drop constraint inference_requests_source_check;
alter table private.inference_requests
  add constraint inference_requests_source_check
  check (source in ('agent-chat','mission-runner','agent-runner'));

-- task_id intentionally has no FK.  Accounting evidence must survive task
-- deletion and cannot cascade away an unresolved provider liability.
create table private.inference_runner_runs (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  task_id uuid not null,
  run_claim uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  agent_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (organization_id, task_id, run_claim),
  foreign key (organization_id, agent_id)
    references public.agents (organization_id, id) on delete restrict
);

create table private.inference_runner_attempts (
  request_id uuid primary key
    references private.inference_requests (id) on delete restrict,
  organization_id uuid not null,
  task_id uuid not null,
  run_claim uuid not null,
  attempt_ordinal integer not null check (attempt_ordinal between 1 and 16),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  requested_route text not null
    check (length(requested_route) between 1 and 120 and requested_route ~ '^[A-Za-z0-9][A-Za-z0-9:_./-]*$'),
  output_token_cap integer not null check (output_token_cap between 1 and 100000),
  dispatch_state text not null default 'admitted'
    check (dispatch_state in ('admitted','dispatching','reconcile_required','settled','settled_overrun','released')),
  admitted_at timestamptz not null default now(),
  dispatched_at timestamptz,
  resolved_at timestamptz,
  unique (organization_id, task_id, run_claim, attempt_ordinal),
  foreign key (organization_id, task_id, run_claim)
    references private.inference_runner_runs (organization_id, task_id, run_claim)
    on delete restrict
);

create index inference_runner_runs_agent_time_idx
  on private.inference_runner_runs (organization_id, agent_id, created_at desc);
create index inference_runner_runs_user_idx
  on private.inference_runner_runs (user_id);
create index inference_runner_attempts_open_idx
  on private.inference_runner_attempts (organization_id, admitted_at)
  where dispatch_state in ('admitted','dispatching','reconcile_required');
create index inference_runner_attempts_claim_idx
  on private.inference_runner_attempts (organization_id, task_id, run_claim, attempt_ordinal);

alter table private.inference_runner_runs enable row level security;
alter table private.inference_runner_attempts enable row level security;
revoke all on table private.inference_runner_runs from public, anon, authenticated, service_role;
revoke all on table private.inference_runner_attempts from public, anon, authenticated, service_role;

create function public.firbo_reserve_runner_inference(
  p_org uuid,
  p_user uuid,
  p_agent uuid,
  p_task uuid,
  p_claim uuid,
  p_attempt_ordinal integer,
  p_request_key uuid,
  p_payload_sha256 text,
  p_route text,
  p_output_token_cap integer,
  p_reserved_usd numeric,
  p_hourly_attempt_limit integer,
  p_daily_run_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request private.inference_requests%rowtype;
  v_attempt private.inference_runner_attempts%rowtype;
  v_task public.tasks%rowtype;
  v_budget numeric;
  v_spent numeric := 0;
  v_reserved numeric := 0;
  v_hourly integer := 0;
  v_daily integer := 0;
  v_next_ordinal integer := 1;
  v_request_id uuid;
  v_new_run boolean := false;
begin
  if p_org is null or p_user is null or p_agent is null or p_task is null or p_claim is null
     or p_request_key is null
     or p_attempt_ordinal is null or p_attempt_ordinal not between 1 and 16
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$'
     or p_route is null or length(p_route) not between 1 and 120
     or p_route !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]*$'
     or p_output_token_cap is null or p_output_token_cap not between 1 and 100000
     or p_reserved_usd is null or p_reserved_usd < 0 or p_reserved_usd > 1000
     or p_reserved_usd <> round(p_reserved_usd, 6)
     or p_hourly_attempt_limit is null or p_hourly_attempt_limit < 0 or p_hourly_attempt_limit > 100000
     or p_daily_run_limit is null or p_daily_run_limit < 0 or p_daily_run_limit > 100000 then
    raise exception using errcode = '22023', message = 'invalid_runner_reservation';
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

  -- Global order: company accounting lock, agent, then task.  No network call
  -- or publication transaction is held across this boundary.
  insert into private.inference_accounting_locks (organization_id)
    values (p_org) on conflict (organization_id) do nothing;
  update private.inference_accounting_locks
    set sequence = sequence + 1
    where organization_id = p_org;

  select monthly_budget_usd into v_budget
    from public.agents
    where id = p_agent and organization_id = p_org and enabled = true
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'agent_not_available';
  end if;

  select * into v_task from public.tasks
    where id = p_task and organization_id = p_org
    for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'task_not_found';
  end if;
  if v_task.status <> 'running' or v_task.run_claim is distinct from p_claim
     or v_task.assigned_agent_id is distinct from p_agent
     or v_task.result->>'reconcile_required' = 'true' then
    raise exception using errcode = '40001', message = 'runner_claim_not_current';
  end if;

  select * into v_request from private.inference_requests
    where organization_id = p_org and source = 'agent-runner' and request_key = p_request_key;
  if found then
    select * into v_attempt from private.inference_runner_attempts
      where request_id = v_request.id;
    if not found then
      raise exception using errcode = '23514', message = 'runner_attempt_integrity';
    end if;
    if v_request.user_id is distinct from p_user or v_request.agent_id <> p_agent
       or v_attempt.organization_id <> p_org or v_attempt.task_id <> p_task
       or v_attempt.run_claim <> p_claim or v_attempt.attempt_ordinal <> p_attempt_ordinal
       or v_attempt.payload_sha256 <> p_payload_sha256
       or v_attempt.requested_route <> p_route
       or v_attempt.output_token_cap <> p_output_token_cap
       or v_request.reserved_usd <> p_reserved_usd then
      raise exception using errcode = '22023', message = 'request_key_conflict';
    end if;
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'request_id', v_request.id,
      'status', v_request.status,
      'dispatch_state', v_attempt.dispatch_state,
      'dispatch_allowed', false,
      'attempt_ordinal', v_attempt.attempt_ordinal
    );
  end if;

  select * into v_attempt from private.inference_runner_attempts
    where organization_id = p_org and task_id = p_task and run_claim = p_claim
      and attempt_ordinal = p_attempt_ordinal;
  if found then
    raise exception using errcode = '22023', message = 'attempt_ordinal_conflict';
  end if;

  if exists(
    select 1 from private.inference_runner_attempts
    where organization_id = p_org and task_id = p_task and run_claim = p_claim
      and dispatch_state in ('admitted','dispatching','reconcile_required')
  ) then
    raise exception using errcode = '23514', message = 'runner_attempt_unresolved';
  end if;

  select coalesce(max(attempt_ordinal), 0) + 1 into v_next_ordinal
    from private.inference_runner_attempts
    where organization_id = p_org and task_id = p_task and run_claim = p_claim;
  if p_attempt_ordinal <> v_next_ordinal then
    raise exception using errcode = '22023', message = 'runner_attempt_out_of_sequence';
  end if;

  if not exists(
    select 1 from private.inference_runner_runs
    where organization_id = p_org and task_id = p_task and run_claim = p_claim
  ) then
    v_new_run := true;
    select
      (select count(*) from private.inference_runner_runs
        where organization_id = p_org and created_at >= now() - interval '24 hours')
      +
      (select count(*) from private.inference_requests
        where organization_id = p_org and source in ('agent-chat','mission-runner')
          and created_at >= now() - interval '24 hours' and status <> 'released')
      +
      (select count(*) from public.usage_events
        where organization_id = p_org and inference_request_id is null
          and created_at >= now() - interval '24 hours')
      into v_daily;
    if v_daily >= p_daily_run_limit then
      return jsonb_build_object('ok', false, 'reason', 'plan_limit', 'daily', v_daily, 'limit', p_daily_run_limit);
    end if;
  end if;

  select
    (select count(*) from private.inference_requests
      where agent_id = p_agent and created_at >= now() - interval '1 hour'
        and status <> 'released')
    +
    (select count(*) from public.usage_events
      where agent_id = p_agent and inference_request_id is null
        and created_at >= now() - interval '1 hour')
    into v_hourly;
  if v_hourly >= p_hourly_attempt_limit then
    return jsonb_build_object('ok', false, 'reason', 'rate_limited', 'hourly', v_hourly, 'limit', p_hourly_attempt_limit);
  end if;

  if p_reserved_usd > 0 and v_budget is not null then
    select coalesce(sum(cost_usd), 0) into v_spent
      from public.usage_events
      where agent_id = p_agent
        and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
    select coalesce(sum(reserved_usd), 0) into v_reserved
      from private.inference_requests
      where agent_id = p_agent and status in ('reserved','reconcile_required');
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

  if v_new_run then
    insert into private.inference_runner_runs
      (organization_id, task_id, run_claim, user_id, agent_id)
    values (p_org, p_task, p_claim, p_user, p_agent);
  end if;

  insert into private.inference_requests
    (organization_id, user_id, agent_id, source, request_key, reserved_usd)
  values (p_org, p_user, p_agent, 'agent-runner', p_request_key, p_reserved_usd)
  returning id into v_request_id;

  insert into private.inference_runner_attempts
    (request_id, organization_id, task_id, run_claim, attempt_ordinal,
     payload_sha256, requested_route, output_token_cap)
  values
    (v_request_id, p_org, p_task, p_claim, p_attempt_ordinal,
     p_payload_sha256, p_route, p_output_token_cap);

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', v_request_id,
    'status', 'reserved',
    'dispatch_state', 'admitted',
    'dispatch_allowed', false,
    'attempt_ordinal', p_attempt_ordinal,
    'logical_run_new', v_new_run,
    'spent', v_spent,
    'reserved', v_reserved,
    'budget', v_budget
  );
end;
$$;

create function public.firbo_begin_runner_dispatch(
  p_request uuid,
  p_task uuid,
  p_claim uuid,
  p_payload_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.inference_runner_attempts%rowtype;
  v_request private.inference_requests%rowtype;
  v_task public.tasks%rowtype;
begin
  if p_request is null or p_task is null or p_claim is null
     or p_payload_sha256 is null or p_payload_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'invalid_runner_dispatch';
  end if;

  select * into v_attempt from private.inference_runner_attempts
    where request_id = p_request;
  if not found then
    raise exception using errcode = 'P0002', message = 'runner_attempt_not_found';
  end if;

  -- The task lock serializes dispatch with cancellation/publication.  The
  -- attempt lock then selects one winner among duplicate Edge deliveries.
  select * into v_task from public.tasks
    where id = v_attempt.task_id and organization_id = v_attempt.organization_id
    for update;
  if not found or v_attempt.task_id <> p_task or v_attempt.run_claim <> p_claim
     or v_attempt.payload_sha256 <> p_payload_sha256
     or v_task.status <> 'running' or v_task.run_claim is distinct from p_claim
     or v_task.assigned_agent_id is distinct from (
       select agent_id from private.inference_runner_runs
       where organization_id = v_attempt.organization_id
         and task_id = v_attempt.task_id and run_claim = v_attempt.run_claim
     )
     or v_task.result->>'reconcile_required' = 'true' then
    raise exception using errcode = '40001', message = 'runner_claim_not_current';
  end if;

  select * into v_request from private.inference_requests
    where id = p_request;
  if not found or v_request.source <> 'agent-runner' then
    raise exception using errcode = '23514', message = 'runner_attempt_integrity';
  end if;
  perform 1 from public.organization_members
    where organization_id = v_attempt.organization_id and user_id = v_request.user_id
      and role in ('owner','admin','manager','member');
  if not found then
    raise exception using errcode = '42501', message = 'inference_actor_not_authorized';
  end if;
  perform 1 from public.agents
    where id = v_request.agent_id and organization_id = v_attempt.organization_id and enabled = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'agent_not_available';
  end if;

  select * into v_attempt from private.inference_runner_attempts
    where request_id = p_request for update;
  if v_attempt.dispatch_state <> 'admitted' then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'request_id', p_request,
      'dispatch_allowed', false,
      'dispatch_state', v_attempt.dispatch_state
    );
  end if;

  update private.inference_runner_attempts
    set dispatch_state = 'dispatching', dispatched_at = now()
    where request_id = p_request;
  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'request_id', p_request,
    'dispatch_allowed', true,
    'dispatch_state', 'dispatching'
  );
end;
$$;

-- Keep the attempt state inseparable from the existing settlement ledger.
-- In particular, direct use of the legacy release RPC cannot release a runner
-- reservation after dispatch has begun.
create function private.sync_runner_attempt_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt private.inference_runner_attempts%rowtype;
  v_next text;
begin
  if old.source <> 'agent-runner' or new.status is not distinct from old.status then
    return new;
  end if;
  select * into v_attempt from private.inference_runner_attempts
    where request_id = new.id for update;
  if not found then
    raise exception using errcode = '23514', message = 'runner_attempt_integrity';
  end if;

  if new.status = 'released' then
    if v_attempt.dispatch_state <> 'admitted' then
      raise exception using errcode = '23514', message = 'runner_release_after_dispatch';
    end if;
    v_next := 'released';
  elsif new.status = 'reconcile_required' then
    if v_attempt.dispatch_state not in ('dispatching','reconcile_required') then
      raise exception using errcode = '23514', message = 'runner_reconcile_without_dispatch';
    end if;
    v_next := 'reconcile_required';
  elsif new.status in ('settled','settled_overrun') then
    if v_attempt.dispatch_state not in ('dispatching','reconcile_required',new.status) then
      raise exception using errcode = '23514', message = 'runner_settlement_without_dispatch';
    end if;
    v_next := new.status;
  else
    raise exception using errcode = '23514', message = 'runner_attempt_bad_transition';
  end if;

  update private.inference_runner_attempts
    set dispatch_state = v_next,
        resolved_at = case when v_next in ('settled','settled_overrun','released') then now() else null end
    where request_id = new.id;
  return new;
end;
$$;

create trigger inference_runner_attempt_state_sync
  after update of status on private.inference_requests
  for each row execute function private.sync_runner_attempt_state();

-- A claim cannot be published, cancelled, recovered or deleted while an
-- admitted/dispatched attempt is unresolved.  This trigger takes the task
-- lock before reading attempts, the same order as dispatch and publication;
-- it never reaches back to the company/agent accounting locks.
create function private.guard_task_runner_attempts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task uuid;
  v_org uuid;
  v_claim uuid := old.run_claim;
  v_leaving boolean;
begin
  if tg_op = 'DELETE' then
    v_task := old.id;
    v_org := old.organization_id;
    v_leaving := true;
  else
    v_task := new.id;
    v_org := new.organization_id;
    v_leaving := new.status <> 'running' or new.run_claim is distinct from old.run_claim;
  end if;
  if old.status = 'running' and v_claim is not null and v_leaving
     and exists(
       select 1 from private.inference_runner_attempts
       where organization_id = v_org and task_id = v_task and run_claim = v_claim
         and dispatch_state in ('admitted','dispatching','reconcile_required')
     ) then
    raise exception using errcode = '23514', message = 'task_active_inference';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tasks_runner_attempt_update_guard
  before update of status,run_claim on public.tasks
  for each row execute function private.guard_task_runner_attempts();
create trigger tasks_runner_attempt_delete_guard
  before delete on public.tasks
  for each row execute function private.guard_task_runner_attempts();

revoke all on function public.firbo_reserve_runner_inference(
  uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,integer,numeric,integer,integer
) from public, anon, authenticated;
revoke all on function public.firbo_begin_runner_dispatch(uuid,uuid,uuid,text)
  from public, anon, authenticated;
revoke all on function private.sync_runner_attempt_state()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_task_runner_attempts()
  from public, anon, authenticated, service_role;
grant execute on function public.firbo_reserve_runner_inference(
  uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,integer,numeric,integer,integer
) to service_role;
grant execute on function public.firbo_begin_runner_dispatch(uuid,uuid,uuid,text)
  to service_role;

commit;
