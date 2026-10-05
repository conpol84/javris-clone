-- A model run owns one bounded claim. Reports and executable approvals become
-- visible together, so a fast device receipt can never race a later report write.
begin;
alter table public.tasks add column run_claim uuid;

create function private.guard_task_run_claim()
returns trigger language plpgsql security definer set search_path = '' as $$
declare protected_key text; recovery_keys text[] := array['reconcile_required','recovery_reason','recovered_at','recovered_by','verified_success'];
begin
  if auth.role() = 'authenticated' then
    if tg_op = 'INSERT' then
      if new.run_claim is not null or new.status in ('running','awaiting_approval') then
        raise exception 'task_server_status' using errcode = '23514';
      end if;
      if new.result ?| array['execution_receipts','last_execution','execution_job_id','execution_status','execution_decision'] then
        raise exception 'task_server_result' using errcode = '23514';
      end if;
    else
      if new.run_claim is distinct from old.run_claim then
        raise exception 'task_server_claim' using errcode = '23514';
      end if;
      foreach protected_key in array array['execution_receipts','last_execution','execution_job_id','execution_status','execution_decision'] loop
        if new.result->protected_key is distinct from old.result->protected_key then
          raise exception 'task_server_result' using errcode = '23514';
        end if;
      end loop;
      if old.run_claim is not null and (new.result is distinct from old.result
        or new.started_at is distinct from old.started_at or new.completed_at is distinct from old.completed_at) then
        -- The lifecycle guard separately proves manager permission and elapsed
        -- recovery time. Permit only that exact barrier addition here.
        if new.status <> 'blocked' or new.result->>'recovery_reason' is distinct from 'stalled_task'
          or new.result->>'reconcile_required' is distinct from 'true'
          or new.result->>'verified_success' is distinct from 'false'
          or new.result->>'recovered_by' is distinct from auth.uid()::text
          or (coalesce(new.result,'{}'::jsonb) - recovery_keys) is distinct from (coalesce(old.result,'{}'::jsonb) - recovery_keys)
          or new.started_at is distinct from old.started_at or new.completed_at is not null then
          raise exception 'task_server_result' using errcode = '23514';
        end if;
      end if;
    end if;
  end if;
  if new.status <> 'running' then new.run_claim := null; end if;
  return new;
end $$;
revoke all on function private.guard_task_run_claim() from public, anon, authenticated;
create trigger tasks_run_claim_guard before insert or update on public.tasks
  for each row execute function private.guard_task_run_claim();

-- While a claimed model is working, external writers cannot expose a partial
-- action queue. Publication first clears its claim and stores the report, then
-- inserts the queue within that same transaction.
create function private.guard_task_run_dependency()
returns trigger language plpgsql security definer set search_path = '' as $$
declare active_claim uuid;
begin
  if new.task_id is null or new.status not in ('pending','approved','queued','running') then return new; end if;
  select run_claim into active_claim from public.tasks
    where organization_id = new.organization_id and id = new.task_id for update;
  if not found or active_claim is not null then
    raise exception 'task_not_executable' using errcode = '23514';
  end if;
  -- A new child is a phantom to a repeatable-read claim transaction. Touch the
  -- locked parent so that stale snapshot cannot claim beside executable work;
  -- PostgreSQL then rejects the stale parent version with serialization error.
  update public.tasks set updated_at = now()
    where organization_id = new.organization_id and id = new.task_id;
  return new;
end $$;
revoke all on function private.guard_task_run_dependency() from public, anon, authenticated;
create trigger approvals_run_claim_guard before insert or update of task_id,status on public.approvals
  for each row execute function private.guard_task_run_dependency();
create trigger connector_jobs_run_claim_guard before insert or update of task_id,status on public.connector_jobs
  for each row execute function private.guard_task_run_dependency();

create function public.claim_task_run(p_org uuid, p_task uuid, p_actor uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.tasks%rowtype; claimed uuid := gen_random_uuid();
begin
  perform id from public.approvals where organization_id = p_org and task_id = p_task order by id for update;
  perform id from public.connector_jobs where organization_id = p_org and task_id = p_task order by id for update;
  select * into t from public.tasks where organization_id = p_org and id = p_task for update;
  if not found then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.organization_members
    where organization_id = p_org and user_id = p_actor and role in ('owner','admin','manager','member') for share;
  if not found then raise exception 'forbidden' using errcode = '42501'; end if;
  if t.status not in ('pending','blocked','failed') or t.run_claim is not null then
    raise exception 'state_conflict' using errcode = '40001';
  end if;
  if t.result->>'reconcile_required' = 'true' then
    raise exception 'task_reconciliation_required' using errcode = '23514';
  end if;
  if exists(select 1 from public.connector_jobs where task_id = t.id and status in ('queued','running')) then
    raise exception 'task_active_jobs' using errcode = '23514';
  end if;
  if exists(select 1 from public.approvals where task_id = t.id and status = 'pending') then
    raise exception 'task_pending_approvals' using errcode = '23514';
  end if;
  update public.tasks set status = 'running', started_at = now(), completed_at = null, run_claim = claimed
    where organization_id = p_org and id = t.id;
  return jsonb_build_object('id',t.id,'organization_id',p_org,'run_claim',claimed,'status','running');
end $$;
revoke all on function public.claim_task_run(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_task_run(uuid,uuid,uuid) to service_role;

create function public.publish_task_run(
  p_org uuid, p_task uuid, p_claim uuid, p_result jsonb, p_approvals jsonb, p_status text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare t public.tasks%rowtype; action jsonb; action_count integer; next_result jsonb;
begin
  if p_result is null or jsonb_typeof(p_result) <> 'object' or pg_column_size(p_result) > 500000
    or p_result ?| array['execution_receipts','last_execution','execution_job_id','execution_status','execution_decision']
    or p_approvals is null or jsonb_typeof(p_approvals) <> 'array'
    or p_status is null or p_status not in ('completed','awaiting_approval','failed','blocked') then
    raise exception 'bad_task_publish' using errcode = '22023';
  end if;
  action_count := jsonb_array_length(p_approvals);
  if action_count > 5 or (p_status = 'awaiting_approval') is distinct from (action_count > 0)
    or (action_count > 0 and p_result->>'reconcile_required' = 'true') then
    raise exception 'bad_task_publish' using errcode = '22023';
  end if;
  for action in select value from jsonb_array_elements(p_approvals) loop
    if jsonb_typeof(action) <> 'object' then
      raise exception 'bad_task_publish' using errcode = '22023';
    end if;
    if jsonb_typeof(action->'action') is distinct from 'string'
      or char_length(btrim(action->>'action')) not between 1 and 120
      or jsonb_typeof(action->'payload') is distinct from 'object' or pg_column_size(action->'payload') > 100000
      or jsonb_typeof(action->'risk') is distinct from 'string' or action->>'risk' not in ('low','medium','high')
      or exists(select 1 from jsonb_object_keys(action) key where key not in ('action','payload','risk')) then
      raise exception 'bad_task_publish' using errcode = '22023';
    end if;
  end loop;
  perform id from public.approvals where organization_id = p_org and task_id = p_task order by id for update;
  perform id from public.connector_jobs where organization_id = p_org and task_id = p_task order by id for update;
  select * into t from public.tasks where organization_id = p_org and id = p_task for update;
  if not found then raise exception 'task_not_found' using errcode = 'P0002'; end if;
  if p_claim is null or t.run_claim is distinct from p_claim or t.status <> 'running' then
    raise exception 'state_conflict' using errcode = '40001';
  end if;
  if t.result->>'reconcile_required' = 'true' then
    raise exception 'task_reconciliation_required' using errcode = '23514';
  end if;
  if exists(select 1 from public.connector_jobs where task_id = t.id and status in ('queued','running')) then
    raise exception 'task_active_jobs' using errcode = '23514';
  end if;
  if exists(select 1 from public.approvals where task_id = t.id and status = 'pending') then
    raise exception 'task_pending_approvals' using errcode = '23514';
  end if;
  if action_count > 0 and t.assigned_agent_id is null then
    raise exception 'bad_task_publish' using errcode = '22023';
  end if;
  -- Replace the earlier report/error/queue fields on a retry. Preserve only
  -- execution provenance, which a new model report cannot forge or replace.
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into next_result
    from jsonb_each(case when jsonb_typeof(t.result) = 'object' then t.result else '{}'::jsonb end)
    where key in ('execution_receipts','last_execution','execution_job_id','execution_status','execution_decision');
  next_result := next_result || p_result;
  update public.tasks set status = p_status, result = next_result, run_claim = null,
    completed_at = case when p_status in ('completed','failed') then now() else null end
    where organization_id = p_org and id = t.id;
  insert into public.approvals (organization_id,task_id,agent_id,action,payload,status,risk)
    select p_org,t.id,t.assigned_agent_id,value->>'action',value->'payload','pending',value->>'risk'
    from jsonb_array_elements(p_approvals);
  return jsonb_build_object('id',t.id,'organization_id',p_org,'run_claim',p_claim,'status',p_status,'queued',action_count);
end $$;
revoke all on function public.publish_task_run(uuid,uuid,uuid,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.publish_task_run(uuid,uuid,uuid,jsonb,jsonb,text) to service_role;
commit;
