-- An employee's own computer steps (connector_jobs.agent_task_id) keep their task from being run again while
-- they are still queued or running, like approved steps (task_id) already do. publish_task_run is unchanged on
-- purpose: an employee may finish its report while a slow step it started is still running on the computer.
-- Deleting a task withdraws its employee steps that the computer has not picked up yet.
begin;
CREATE OR REPLACE FUNCTION public.claim_task_run(p_org uuid, p_task uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.tasks%rowtype; claimed uuid := gen_random_uuid();
begin
  perform id from public.approvals where organization_id = p_org and task_id = p_task order by id for update;
  perform id from public.connector_jobs where organization_id = p_org and (task_id = p_task or agent_task_id = p_task) order by id for update;
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
  if exists(select 1 from public.connector_jobs where (task_id = t.id or agent_task_id = t.id) and status in ('queued','running')) then
    raise exception 'task_active_jobs' using errcode = '23514';
  end if;
  if exists(select 1 from public.approvals where task_id = t.id and status = 'pending') then
    raise exception 'task_pending_approvals' using errcode = '23514';
  end if;
  update public.tasks set status = 'running', started_at = now(), completed_at = null, run_claim = claimed
    where organization_id = p_org and id = t.id;
  return jsonb_build_object('id',t.id,'organization_id',p_org,'run_claim',claimed,'status','running');
end $function$;
revoke all on function public.claim_task_run(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.claim_task_run(uuid,uuid,uuid) to service_role;

create or replace function private.withdraw_agent_jobs_of_deleted_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.connector_jobs set status = 'cancelled', finished_at = now()
    where agent_task_id = old.id and status = 'queued';
  return old;
end $$;
revoke all on function private.withdraw_agent_jobs_of_deleted_task() from public, anon, authenticated;
drop trigger if exists tasks_withdraw_agent_jobs on public.tasks;
create trigger tasks_withdraw_agent_jobs before delete on public.tasks
  for each row execute function private.withdraw_agent_jobs_of_deleted_task();
commit;
