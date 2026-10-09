-- Advanced own-device control is Business/Enterprise, including API callers.
-- Terminal receipts, cancellation and Stop remain possible after downgrade.
begin;
alter table public.connector_jobs drop constraint if exists connector_jobs_kind_check;
alter table public.connector_jobs add constraint connector_jobs_kind_check check
 (kind in ('list','read','write','exec','browser_open','browser_task','open_app','shortcut','desktop_task'));

create or replace function private.guard_advanced_computer_job()
returns trigger language plpgsql security definer set search_path = '' as $$
declare o public.organizations%rowtype; d public.connector_devices%rowtype;
begin
  if new.kind not in ('browser_task','open_app','shortcut','desktop_task') or new.status not in ('queued','running') then return new; end if;
  select * into o from public.organizations where id=new.organization_id for share;
  if not found or o.status is distinct from 'active' or o.plan not in ('business','enterprise') or o.plan_status not in ('active','trialing')
    or o.plan is null or o.plan_status is null then
    raise exception 'advanced_computer_not_authorized' using errcode='23514';
  end if;
  if new.kind='desktop_task' then
    select * into d from public.connector_devices where id=new.device_id and organization_id=new.organization_id;
    if not found or d.paired is distinct from true or d.revoked_at is not null
      or coalesce(d.agent_policy->>'enabled','false') <> 'true'
      or coalesce(d.agent_policy->>'control','guarded') <> 'full'
      or not private.agent_policy_within_hours(d.agent_policy)
      or coalesce(d.capabilities->>'full_control','false') <> 'true'
      or not coalesce(d.capabilities->'job_kinds' ? 'desktop_task',false)
      or not exists(select 1 from public.organization_members where organization_id=new.organization_id and user_id=new.created_by and role in ('owner','admin'))
      or jsonb_typeof(new.params->'goal') is distinct from 'string'
      or length(new.params->>'goal') not between 1 and 4000 then
      raise exception 'advanced_computer_not_authorized' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_advanced_computer_job() from public,anon,authenticated;
create trigger connector_jobs_advanced_guard before insert or update of kind,organization_id,device_id,created_by,params,status
on public.connector_jobs for each row execute function private.guard_advanced_computer_job();

create or replace function public.connector_claim_next_job(
  p_org uuid, p_device uuid, p_min_created timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare d public.connector_devices%rowtype; j public.connector_jobs%rowtype; candidate uuid;
begin
  select * into d from public.connector_devices
    where id = p_device and organization_id = p_org;
  if not found or d.paired is distinct from true or d.revoked_at is not null then
    raise exception 'device_not_ready' using errcode = 'P0002';
  end if;
  loop
    select * into j from public.connector_jobs
      where organization_id = p_org and device_id = p_device and status = 'queued'
        and created_at >= p_min_created
      order by created_at,id limit 1;
    if not found then return null; end if;
    candidate := j.id;
    -- Match enqueue/publication lock order: parent before device before job.
    -- Holding the device while waiting on the parent deadlocks with an enqueue
    -- holding that parent and waiting on this same device.
    if coalesce(j.agent_task_id,j.task_id) is not null then
      perform 1 from public.tasks where id=coalesce(j.agent_task_id,j.task_id) for update;
    end if;
    select * into d from public.connector_devices
      where id = p_device and organization_id = p_org for update;
    if not found or d.paired is distinct from true or d.revoked_at is not null then
      raise exception 'device_not_ready' using errcode = 'P0002';
    end if;
    select * into j from public.connector_jobs
      where id=candidate and device_id=p_device and organization_id=p_org and status='queued'
      for update skip locked;
    if not found then return null; end if;
    begin
      update public.connector_jobs set status = 'running', started_at = statement_timestamp()
        where id = j.id and status = 'queued' returning * into j;
      if found then
        return jsonb_build_object('id',j.id,'kind',j.kind,'params',j.params);
      end if;
    exception when check_violation then
      if sqlerrm not in ('agent_job_not_authorized','advanced_computer_not_authorized') then raise; end if;
      update public.connector_jobs set status = 'cancelled', finished_at = now(),
        error = coalesce(error,'authorization_changed') where id = j.id and status = 'queued';
    end;
  end loop;
end $$;
revoke all on function public.connector_claim_next_job(uuid,uuid,timestamptz) from public, anon, authenticated;
grant execute on function public.connector_claim_next_job(uuid,uuid,timestamptz) to service_role;

commit;
