-- Task lifecycle actions are atomic and scoped to the current company. A status
-- change is never treated as a way to stop an already running model or command.
create or replace function private.guard_task_lifecycle()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Preserve organization deletion cascades; the parent no longer exists then.
  if tg_op = 'DELETE' then
    if not exists(select 1 from public.organizations where id = old.organization_id) then return old; end if;
    if old.status not in ('completed','failed','cancelled') then
      raise exception 'task_cancel_first' using errcode = '23514';
    end if;
    if exists(select 1 from public.tasks where parent_task_id = old.id) then
      raise exception 'task_has_dependents' using errcode = '23514';
    end if;
    if exists(select 1 from public.connector_jobs where task_id = old.id and status in ('queued','running')) then
      raise exception 'task_active_jobs' using errcode = '23514';
    end if;
    if exists(select 1 from public.approvals where task_id = old.id and status = 'pending') then
      raise exception 'task_pending_approvals' using errcode = '23514';
    end if;
    if exists(select 1 from public.workflow_runs where task_id = old.id and status = 'running') then
      raise exception 'task_active_workflow' using errcode = '23514';
    end if;
    perform private.write_audit(old.organization_id, 'task.deleted', 'task', old.id,
      jsonb_build_object('title',old.title,'status',old.status,'agent_id',old.assigned_agent_id));
    return old;
  end if;
  -- Recovery remains a reconciliation barrier even for a late service-role
  -- final write. A timed-out request must not revive or overwrite this record.
  if old.result->>'recovery_reason' = 'stalled_task' and old.result->>'reconcile_required' = 'true' then
    if new.result->>'recovery_reason' is distinct from 'stalled_task'
      or new.result->>'reconcile_required' is distinct from 'true'
      or new.status not in ('blocked','cancelled') then
      raise exception 'task_reconciliation_required' using errcode = '23514';
    end if;
  end if;
  if auth.role() = 'authenticated' and new.status is distinct from old.status then
    if old.status = 'running' then
      if new.status <> 'blocked' or new.result->>'recovery_reason' is distinct from 'stalled_task'
        or new.result->>'reconcile_required' is distinct from 'true'
        or not private.has_role(old.organization_id,array['owner','admin','manager'])
        or old.started_at is null or old.started_at >= now() - interval '30 minutes'
        or old.updated_at >= now() - interval '30 minutes'
        or exists(select 1 from public.connector_jobs where task_id = old.id and status in ('queued','running'))
        or exists(select 1 from public.approvals where task_id = old.id and status = 'pending')
        or exists(select 1 from public.workflow_runs where task_id = old.id and status = 'running')
        or exists(select 1 from public.tasks where parent_task_id = old.id) then
        raise exception 'task_in_progress' using errcode = '23514';
      end if;
      perform private.write_audit(old.organization_id,'task.recovered','task',old.id,
        jsonb_build_object('title',old.title,'previous_status',old.status,'started_at',old.started_at,'last_updated_at',old.updated_at,'verified_success',false,'reconcile_required',true));
    end if;
    if new.status in ('running','awaiting_approval') then
      raise exception 'task_server_status' using errcode = '23514';
    end if;
    if new.status = 'cancelled' and not private.has_role(old.organization_id,array['owner','admin','manager']) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    if exists(select 1 from public.workflow_runs where task_id = old.id and status = 'running') then
      raise exception 'task_active_workflow' using errcode = '23514';
    end if;
    if exists(select 1 from public.connector_jobs where task_id = old.id and status in ('queued','running')) then
      raise exception 'task_active_jobs' using errcode = '23514';
    end if;
    if new.status not in ('running','awaiting_approval') and exists(select 1 from public.approvals where task_id = old.id and status = 'pending') then
      raise exception 'task_pending_approvals' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_task_lifecycle() from public, anon, authenticated;
drop trigger if exists tasks_lifecycle_delete on public.tasks;
create trigger tasks_lifecycle_delete before delete on public.tasks for each row execute function private.guard_task_lifecycle();
drop trigger if exists tasks_lifecycle_update on public.tasks;
create trigger tasks_lifecycle_update before update on public.tasks for each row execute function private.guard_task_lifecycle();

-- A late approval or job claim must not resurrect a cancelled/deleted task.
-- Lock the FK parent before accepting executable job state, just as deletion
-- locks that parent; existing job -> task locking also matches receipt writes.
create or replace function private.guard_task_execution()
returns trigger language plpgsql security definer set search_path = '' as $$
declare task_status text; task_org uuid; requires_reconciliation text;
begin
  if new.task_id is null or new.status not in ('queued','running') then return new; end if;
  select status, organization_id, result->>'reconcile_required' into task_status, task_org, requires_reconciliation from public.tasks where id = new.task_id for update;
  if not found or task_org <> new.organization_id or task_status in ('completed','failed','cancelled') or requires_reconciliation = 'true' then
    raise exception 'task_not_executable' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_task_execution() from public, anon, authenticated;
drop trigger if exists connector_jobs_task_lifecycle on public.connector_jobs;
create trigger connector_jobs_task_lifecycle before insert or update of task_id, status on public.connector_jobs
  for each row execute function private.guard_task_execution();

-- Pending/approved decisions require a live, executable task. Locking that FK
-- parent prevents late inserts/decisions from racing recovery or deletion;
-- rejection/expiry remains available to the cancellation transaction.
create or replace function private.guard_task_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare task_status text; task_org uuid; requires_reconciliation text;
begin
  if new.task_id is null or new.status not in ('pending','approved') then return new; end if;
  select status,organization_id,result->>'reconcile_required' into task_status,task_org,requires_reconciliation
    from public.tasks where id = new.task_id for update;
  if not found or task_org <> new.organization_id or task_status in ('completed','failed','cancelled') or requires_reconciliation = 'true' then
    raise exception 'task_not_executable' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_task_approval() from public, anon, authenticated;
drop trigger if exists approvals_task_lifecycle on public.approvals;
create trigger approvals_task_lifecycle before insert or update of task_id,status on public.approvals
  for each row execute function private.guard_task_approval();

create or replace function private.guard_task_workflow()
returns trigger language plpgsql security definer set search_path = '' as $$
declare task_status text; task_org uuid; requires_reconciliation text;
begin
  if new.task_id is null or new.status <> 'running' then return new; end if;
  select status,organization_id,result->>'reconcile_required' into task_status,task_org,requires_reconciliation
    from public.tasks where id = new.task_id for update;
  if not found or task_org <> new.organization_id or task_status in ('failed','cancelled') or requires_reconciliation = 'true' then
    raise exception 'task_not_executable' using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_task_workflow() from public, anon, authenticated;
drop trigger if exists workflow_runs_task_lifecycle on public.workflow_runs;
create trigger workflow_runs_task_lifecycle before insert or update of task_id,status on public.workflow_runs
  for each row execute function private.guard_task_workflow();

create or replace function public.manage_task(
  p_org uuid, p_task uuid, p_expected_status text, p_action text, p_status text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks%rowtype;
  changed uuid;
  next_status text;
  actor uuid := auth.uid();
begin
  if p_action is null or p_action not in ('cancel','delete','set_status','recover') then
    raise exception 'bad_task_action' using errcode = '22023';
  end if;
  if actor is null or not private.has_role(p_org,
    case when p_action = 'set_status' then array['owner','admin','manager','member'] else array['owner','admin','manager'] end
  ) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_action = 'set_status' and (p_status is null or p_status not in ('pending','blocked','completed','failed')) then
    raise exception 'bad_task_status' using errcode = '22023';
  end if;
  -- Existing execution decisions lock approval -> task; execution receipts lock
  -- job -> task. Take those locks in that order before locking the parent task.
  -- A queued job cannot be claimed while we decide whether to cancel it.
  perform id from public.approvals where organization_id = p_org and task_id = p_task order by id for update;
  perform id from public.connector_jobs where organization_id = p_org and task_id = p_task order by id for update;
  perform id from public.workflow_runs where organization_id = p_org and task_id = p_task order by id for update;
  select * into t from public.tasks where organization_id = p_org and id = p_task for update;
  if not found then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  if p_expected_status is null or t.status <> p_expected_status then raise exception 'task_changed' using errcode = '40001'; end if;
  if p_action = 'recover' then
    if t.status <> 'running' or t.started_at is null or t.started_at >= now() - interval '30 minutes' or t.updated_at >= now() - interval '30 minutes'
      or exists(select 1 from public.connector_jobs where task_id = t.id and status in ('queued','running'))
      or exists(select 1 from public.approvals where task_id = t.id and status = 'pending')
      or exists(select 1 from public.workflow_runs where task_id = t.id and status = 'running')
      or exists(select 1 from public.tasks where parent_task_id = t.id) then
      raise exception 'task_not_stalled' using errcode = '23514';
    end if;
    update public.tasks set status = 'blocked', completed_at = null,
      result = coalesce(result,'{}'::jsonb) || jsonb_build_object('reconcile_required',true,'recovery_reason','stalled_task','recovered_at',now(),'recovered_by',actor,'verified_success',false)
      where id = t.id and organization_id = p_org returning id into changed;
    if changed is null then raise exception 'task_changed' using errcode = '40001'; end if;
    return jsonb_build_object('id',changed,'organization_id',p_org,'action',p_action,'status','blocked','reconcile_required',true);
  end if;
  if t.status = 'running' or exists(select 1 from public.connector_jobs where task_id = t.id and status = 'running') then
    raise exception 'task_in_progress' using errcode = '23514';
  end if;
  if exists(select 1 from public.workflow_runs where task_id = t.id and status = 'running') then
    raise exception 'task_active_workflow' using errcode = '23514';
  end if;
  -- Removing a parent would cascade child tasks and their saved reports. Make
  -- that a separate explicit operation instead of silently discarding them.
  if p_action in ('cancel','delete') and exists(select 1 from public.tasks where parent_task_id = t.id) then
    raise exception 'task_has_dependents' using errcode = '23514';
  end if;
  if p_action = 'set_status' then
    if t.result->>'recovery_reason' = 'stalled_task' and t.result->>'reconcile_required' = 'true' and p_status <> 'blocked' then
      raise exception 'task_reconciliation_required' using errcode = '23514';
    end if;
    if exists(select 1 from public.connector_jobs where task_id = t.id and status = 'queued') then
      raise exception 'task_active_jobs' using errcode = '23514';
    end if;
    if exists(select 1 from public.approvals where task_id = t.id and status = 'pending') then
      raise exception 'task_pending_approvals' using errcode = '23514';
    end if;
    next_status := p_status;
    update public.tasks set status = next_status,
      completed_at = case when next_status in ('completed','failed') then now() else null end
      where id = t.id and organization_id = p_org returning id into changed;
  else
    if p_action = 'cancel' and t.status not in ('pending','blocked','awaiting_approval') then
      raise exception 'task_changed' using errcode = '40001';
    end if;
    update public.approvals set status = 'rejected', decided_by = actor, decided_at = now(), decision_note = 'Task cancelled by a company manager'
      where organization_id = p_org and task_id = t.id and status = 'pending';
    update public.connector_jobs set status = 'cancelled', finished_at = now()
      where organization_id = p_org and task_id = t.id and status = 'queued';
    next_status := case when t.status in ('completed','failed','cancelled') then t.status else 'cancelled' end;
    if t.status <> next_status then
      update public.tasks set status = next_status, completed_at = now()
        where id = t.id and organization_id = p_org;
    end if;
    if p_action = 'delete' then
      delete from public.tasks where id = t.id and organization_id = p_org returning id into changed;
    else
      select id into changed from public.tasks where id = t.id and organization_id = p_org and status = 'cancelled';
    end if;
  end if;
  if changed is null then raise exception 'task_changed' using errcode = '40001'; end if;
  return jsonb_build_object('id',changed,'organization_id',p_org,'action',p_action,'status',next_status);
end $$;
revoke all on function public.manage_task(uuid,uuid,text,text,text) from public, anon;
grant execute on function public.manage_task(uuid,uuid,text,text,text) to authenticated;
