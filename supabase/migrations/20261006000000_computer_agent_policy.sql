-- AI employees on a paired computer, under the owner's rules.
-- connector_devices.agent_policy: what AI employees may do there (off until the owner turns it on; cleaned by the connector function).
-- connector_jobs.agent_task_id / agent_id / origin: which employee and task asked for a job. agent_task_id is separate from
-- task_id on purpose: connector_finish_execution moves task_id's task to completed/failed, which must not happen
-- while that employee is still working on it.
alter table public.connector_devices
  add column if not exists agent_policy jsonb not null default '{}'::jsonb;
alter table public.connector_devices drop constraint if exists connector_devices_agent_policy_check;
alter table public.connector_devices add constraint connector_devices_agent_policy_check
  check (jsonb_typeof(agent_policy) = 'object' and pg_column_size(agent_policy) < 8000);

alter table public.connector_jobs
  add column if not exists agent_task_id uuid references public.tasks(id) on delete set null,
  add column if not exists agent_id uuid references public.agents(id) on delete set null,
  add column if not exists origin text not null default 'owner';
alter table public.connector_jobs drop constraint if exists connector_jobs_origin_check;
alter table public.connector_jobs add constraint connector_jobs_origin_check check (origin in ('owner', 'approval', 'agent'));
alter table public.connector_jobs drop constraint if exists connector_jobs_kind_check;
alter table public.connector_jobs add constraint connector_jobs_kind_check
  check (kind = any (array['list', 'read', 'write', 'exec', 'browser_open', 'browser_task', 'open_app', 'shortcut']));
create index if not exists connector_jobs_agent_task_idx on public.connector_jobs (agent_task_id) where agent_task_id is not null;
create index if not exists connector_jobs_agent_idx on public.connector_jobs (agent_id) where agent_id is not null;

-- Approved computer actions may now also open a page, open an app or run a Shortcut. Everything else is unchanged.
CREATE OR REPLACE FUNCTION public.connector_decide_execution(p_approval uuid, p_actor uuid, p_device uuid, p_decision text, p_note text, p_payload jsonb, p_kind text, p_params jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.approvals%rowtype; d public.connector_devices%rowtype; j uuid; existing uuid; active_count int; pending_count int;
begin
  if p_decision not in ('approved','rejected') then raise exception 'bad_decision' using errcode='22023'; end if;
  select * into a from public.approvals where id=p_approval for update;
  if not found then raise exception 'approval_not_found' using errcode='P0002'; end if;
  if not exists(select 1 from public.organization_members m where m.organization_id=a.organization_id and m.user_id=p_actor and m.role in ('owner','admin')) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  if a.status='approved' and p_decision='approved' then
    select id into existing from public.connector_jobs where approval_id=a.id;
    if existing is not null then return jsonb_build_object('decision','approved','job_id',existing,'duplicate',true); end if;
  end if;
  if a.status<>'pending' then raise exception 'state_conflict' using errcode='40001'; end if;

  if p_decision='rejected' then
    update public.approvals set status='rejected',decided_by=p_actor,decided_at=now(),decision_note=nullif(left(coalesce(p_note,''),500),''),
      payload=coalesce(p_payload,a.payload) where id=a.id;
    if a.task_id is not null then
      select count(*) into pending_count from public.approvals where task_id=a.task_id and status='pending' and id<>a.id;
      select count(*) into active_count from public.connector_jobs where task_id=a.task_id and status in ('queued','running');
      if pending_count=0 and active_count=0 then
        update public.tasks set status='completed',completed_at=coalesce(completed_at,now()),
          result=coalesce(result,'{}'::jsonb)||jsonb_build_object('execution_decision','rejected') where id=a.task_id and status='awaiting_approval';
      end if;
    end if;
    insert into public.audit_log(organization_id,actor_id,action,entity,entity_id,metadata)
      values(a.organization_id,p_actor,'connector.approval_rejected','approval',a.id,jsonb_build_object('task_id',a.task_id));
    return jsonb_build_object('decision','rejected','duplicate',false);
  end if;

  if p_device is null or p_kind not in ('list','read','write','exec','browser_open','browser_task','open_app','shortcut') or p_params is null or jsonb_typeof(p_params)<>'object' then
    raise exception 'bad_execution' using errcode='22023';
  end if;
  select * into d from public.connector_devices where id=p_device and organization_id=a.organization_id and paired=true and revoked_at is null;
  if not found then raise exception 'device_not_ready' using errcode='P0002'; end if;
  if (select count(*) from public.connector_jobs where device_id=d.id and status='queued')>=10 then
    raise exception 'too_many' using errcode='54000';
  end if;

  insert into public.connector_jobs(organization_id,device_id,created_by,kind,params,task_id,approval_id,agent_id,origin)
    values(a.organization_id,d.id,p_actor,p_kind,p_params,a.task_id,a.id,a.agent_id,'approval') returning id into j;
  update public.approvals set status='approved',decided_by=p_actor,decided_at=now(),decision_note=nullif(left(coalesce(p_note,''),500),''),
    payload=coalesce(p_payload,a.payload) where id=a.id;
  if a.task_id is not null then
    update public.tasks set status='running',started_at=coalesce(started_at,now()),completed_at=null,
      result=coalesce(result,'{}'::jsonb)||jsonb_build_object('execution_job_id',j,'execution_status','queued')
      where id=a.task_id;
  end if;
  insert into public.audit_log(organization_id,actor_id,action,entity,entity_id,metadata)
    values(a.organization_id,p_actor,'connector.approval_queued','connector_job',j,jsonb_build_object('approval_id',a.id,'task_id',a.task_id,'device_id',d.id,'kind',p_kind));
  return jsonb_build_object('decision','approved','job_id',j,'duplicate',false);
end $function$;
