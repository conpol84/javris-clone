-- Bind every inline AI-employee computer job to the exact model run and the
-- exact device policy/capabilities that authorised it.  The parent task keeps
-- its own lifecycle: an inline job receipt must never complete that task.
begin;

alter table public.connector_jobs
  add column if not exists agent_run_claim uuid,
  add column if not exists agent_policy_snapshot jsonb,
  add column if not exists agent_capabilities_snapshot jsonb;

-- Jobs created before this protocol have no capability token.  Do not guess
-- about an already-running OS effect: an operator must reconcile it before
-- this migration can proceed. Queued legacy work is safe to withdraw.
do $$ begin
  if exists(select 1 from public.connector_jobs where origin = 'agent' and status = 'running'
    and (agent_run_claim is null or agent_policy_snapshot is null or agent_capabilities_snapshot is null)) then
    raise exception 'agent_job_migration_running' using errcode = '55000';
  end if;
end $$;
update public.connector_jobs
set status = 'cancelled', finished_at = now(),
    error = coalesce(error, 'authorization_context_missing')
where origin = 'agent' and status = 'queued'
  and (agent_run_claim is null or agent_policy_snapshot is null or agent_capabilities_snapshot is null);

alter table public.connector_jobs drop constraint if exists connector_jobs_agent_context_check;
alter table public.connector_jobs add constraint connector_jobs_agent_context_check check (
  (origin <> 'agent' and agent_run_claim is null and agent_policy_snapshot is null and agent_capabilities_snapshot is null)
  or (origin = 'agent' and (
    status in ('done','error','cancelled')
    or (agent_task_id is not null and agent_id is not null and agent_run_claim is not null
      and agent_policy_snapshot is not null and jsonb_typeof(agent_policy_snapshot) = 'object'
      and pg_column_size(agent_policy_snapshot) < 8000
      and agent_capabilities_snapshot is not null and jsonb_typeof(agent_capabilities_snapshot) = 'object'
      and pg_column_size(agent_capabilities_snapshot) < 16000
      and task_id is null and approval_id is null)
  ))
);

create or replace function private.agent_policy_within_hours(p_policy jsonb)
returns boolean language plpgsql stable security invoker set search_path = '' as $$
declare h jsonb; from_hour integer; to_hour integer; local_hour integer; zone text;
begin
  h := p_policy->'hours';
  if h is null or h = 'null'::jsonb then return true; end if;
  if jsonb_typeof(h) <> 'object' then return false; end if;
  begin
    from_hour := (h->>'from')::integer;
    to_hour := (h->>'to')::integer;
    zone := h->>'tz';
    if from_hour not between 0 and 24 or to_hour not between 0 and 24
      or from_hour = to_hour or zone is null then return false; end if;
    local_hour := extract(hour from timezone(zone, statement_timestamp()))::integer;
  exception when others then
    return false;
  end;
  return case when from_hour < to_hour
    then local_hour >= from_hour and local_hour < to_hour
    else local_hour >= from_hour or local_hour < to_hour end;
end $$;
revoke all on function private.agent_policy_within_hours(jsonb) from public, anon, authenticated;

create or replace function private.guard_agent_computer_job()
returns trigger language plpgsql security definer set search_path = '' as $$
declare t public.tasks%rowtype; d public.connector_devices%rowtype;
  agent_enabled boolean; agent_autonomy text; tool_enabled boolean; tool_policy text;
begin
  if new.origin <> 'agent' or new.status not in ('queued','running') then return new; end if;
  if new.agent_task_id is null or new.agent_id is null or new.agent_run_claim is null
    or new.agent_policy_snapshot is null or new.agent_capabilities_snapshot is null
    or new.task_id is not null or new.approval_id is not null then
    raise exception 'agent_job_not_authorized' using errcode = '23514';
  end if;

  select * into t from public.tasks where id = new.agent_task_id for update;
  select * into d from public.connector_devices where id = new.device_id for update;
  select enabled, autonomy into agent_enabled, agent_autonomy from public.agents
    where id = new.agent_id and organization_id = new.organization_id;
  select enabled, policy into tool_enabled, tool_policy from public.agent_tools
    where agent_id = new.agent_id and organization_id = new.organization_id and tool_name = 'computer_use';

  if t.id is null or d.id is null or agent_enabled is distinct from true
    or tool_enabled is distinct from true or tool_policy is distinct from 'allow'
    or agent_autonomy = 'suggest'
    or t.organization_id <> new.organization_id or t.assigned_agent_id is distinct from new.agent_id
    or t.status <> 'running' or t.run_claim is distinct from new.agent_run_claim
    or t.result->>'reconcile_required' = 'true'
    or d.organization_id <> new.organization_id or d.paired is distinct from true or d.revoked_at is not null
    or d.agent_policy is distinct from new.agent_policy_snapshot
    or coalesce(d.capabilities,'{}'::jsonb) is distinct from new.agent_capabilities_snapshot
    or d.agent_policy->>'enabled' is distinct from 'true'
    or not private.agent_policy_within_hours(d.agent_policy)
    or not (coalesce(d.capabilities->'job_kinds','[]'::jsonb) ? new.kind) then
    raise exception 'agent_job_not_authorized' using errcode = '23514';
  end if;
  -- Make the dependency visible to transactions whose snapshot began while
  -- waiting on this task lock.  At repeatable-read/serializable isolation the
  -- concurrent publisher then retries instead of missing the newly queued job.
  update public.tasks set updated_at = statement_timestamp() where id = t.id;
  return new;
end $$;
revoke all on function private.guard_agent_computer_job() from public, anon, authenticated;
drop trigger if exists connector_jobs_agent_run_guard on public.connector_jobs;
create trigger connector_jobs_agent_run_guard
  before insert or update of status,device_id,kind,params,origin,agent_task_id,agent_id,agent_run_claim,agent_policy_snapshot,agent_capabilities_snapshot
  on public.connector_jobs for each row execute function private.guard_agent_computer_job();

-- Any transition that would make a task non-running must wait for its inline
-- jobs.  Cancellation may withdraw queued work, but a running computer effect
-- must be reconciled before the parent changes state or is removed.
create or replace function private.guard_task_agent_jobs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare parent uuid := case when tg_op = 'DELETE' then old.id else new.id end;
begin
  if tg_op = 'DELETE' then
    if exists(select 1 from public.connector_jobs where agent_task_id = parent and status = 'running') then
      raise exception 'task_in_progress' using errcode = '23514';
    end if;
    update public.connector_jobs set status = 'cancelled', finished_at = now(),
      error = coalesce(error,'task_deleted')
      where agent_task_id = parent and status = 'queued';
    return old;
  end if;
  if new.status is distinct from old.status and new.status <> 'running' then
    if new.status = 'cancelled' then
      if exists(select 1 from public.connector_jobs where agent_task_id = parent and status = 'running') then
        raise exception 'task_in_progress' using errcode = '23514';
      end if;
      update public.connector_jobs set status = 'cancelled', finished_at = now(),
        error = coalesce(error,'task_cancelled')
        where agent_task_id = parent and status = 'queued';
    elsif exists(select 1 from public.connector_jobs where agent_task_id = parent and status in ('queued','running')) then
      raise exception 'task_active_jobs' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_task_agent_jobs() from public, anon, authenticated;
drop trigger if exists tasks_agent_job_delete_guard on public.tasks;
create trigger tasks_agent_job_delete_guard before delete on public.tasks
  for each row execute function private.guard_task_agent_jobs();
drop trigger if exists tasks_agent_job_update_guard on public.tasks;
create trigger tasks_agent_job_update_guard before update of status on public.tasks
  for each row execute function private.guard_task_agent_jobs();

-- One server-owned claim boundary for the device.  Agent jobs are rechecked by
-- the trigger in the same transaction; stale authorisation is cancelled and is
-- never returned to the computer.  Owner/approved jobs keep their old behavior.
create or replace function public.connector_claim_next_job(
  p_org uuid, p_device uuid, p_min_created timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.connector_devices%rowtype; j public.connector_jobs%rowtype;
begin
  select * into d from public.connector_devices
    where id = p_device and organization_id = p_org for update;
  if not found or d.paired is distinct from true or d.revoked_at is not null then
    raise exception 'device_not_ready' using errcode = 'P0002';
  end if;
  loop
    select * into j from public.connector_jobs
      where organization_id = p_org and device_id = p_device and status = 'queued'
        and created_at >= p_min_created
      order by created_at,id for update skip locked limit 1;
    if not found then return null; end if;
    begin
      update public.connector_jobs set status = 'running'
        where id = j.id and status = 'queued' returning * into j;
      if found then
        return jsonb_build_object('id',j.id,'kind',j.kind,'params',j.params);
      end if;
    exception when check_violation then
      if sqlerrm <> 'agent_job_not_authorized' then raise; end if;
      update public.connector_jobs set status = 'cancelled', finished_at = now(),
        error = coalesce(error,'authorization_changed') where id = j.id and status = 'queued';
    end;
  end loop;
end $$;
revoke all on function public.connector_claim_next_job(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.connector_claim_next_job(uuid,uuid,timestamptz) to service_role;

commit;
