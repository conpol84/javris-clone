-- Retain the original owner proposal beside its durable Connector job. The
-- server records only request identity and the chosen worker, never inventory
-- or credentials. Existing jobs remain nullable for compatibility.
begin;
alter table public.connector_jobs add column if not exists dispatch_request jsonb;
alter table public.connector_jobs drop constraint if exists connector_jobs_dispatch_request_check;
alter table public.connector_jobs add constraint connector_jobs_dispatch_request_check check (
  dispatch_request is null or (jsonb_typeof(dispatch_request)='object' and pg_column_size(dispatch_request)<=180000)
);

-- Extend the latest decision RPC to native goals without changing its legacy
-- approval/rejection lifecycle. The existing advanced-control insert/claim
-- trigger continues to recheck plan, tenant, capability, Full Control and hours.
CREATE OR REPLACE FUNCTION public.connector_decide_execution(p_approval uuid, p_actor uuid, p_device uuid, p_decision text, p_note text, p_payload jsonb, p_kind text, p_params jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO ''
AS $function$
declare a public.approvals%rowtype; d public.connector_devices%rowtype; j uuid; existing uuid; active_count int; pending_count int; native boolean; existing_job public.connector_jobs%rowtype;
begin
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'bad_decision' using errcode='22023'; end if;
  select * into a from public.approvals where id=p_approval for update;
  if not found then raise exception 'approval_not_found' using errcode='P0002'; end if;
  if not exists(select 1 from public.organization_members m where m.organization_id=a.organization_id and m.user_id=p_actor and m.role in ('owner','admin')) then
    raise exception 'forbidden' using errcode='42501';
  end if;

  -- Native work is the exact goal reviewed in the Inbox, on the worker
  -- selected before approval. Neither edited metadata nor a retry may move it.
  native := a.action='computer_desktop_task' or p_kind='desktop_task';
  if p_decision='approved' and native then
    if a.action is distinct from 'computer_desktop_task' or p_kind is distinct from 'desktop_task'
      or jsonb_typeof(a.payload) is distinct from 'object'
      or p_payload is distinct from a.payload
      or jsonb_typeof(a.payload->'goal') is distinct from 'string'
      or length(a.payload->>'goal') not between 1 and 4000
      or p_params is distinct from jsonb_build_object('goal',a.payload->>'goal') then
      raise exception 'native_approval_mismatch' using errcode='22023';
    end if;
    if a.payload ? 'device_id' then
      if jsonb_typeof(a.payload->'device_id') is distinct from 'string'
        or (a.payload->>'device_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'native_approval_mismatch' using errcode='22023';
      end if;
      if (a.payload->>'device_id')::uuid is distinct from p_device then
        raise exception 'native_approval_mismatch' using errcode='22023';
      end if;
    end if;
  end if;

  if a.status='approved' and p_decision='approved' then
    select id into existing from public.connector_jobs where approval_id=a.id;
    if existing is not null then
      if native then
        select * into existing_job from public.connector_jobs where id=existing;
        if existing_job.organization_id is distinct from a.organization_id
          or existing_job.device_id is distinct from p_device
          or existing_job.kind is distinct from p_kind
          or existing_job.params is distinct from p_params then
          raise exception 'native_approval_mismatch' using errcode='22023';
        end if;
      end if;
      return jsonb_build_object('decision','approved','job_id',existing,'duplicate',true);
    end if;
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

  if p_device is null or p_kind is null or p_kind not in ('list','read','write','exec','browser_open','browser_task','open_app','shortcut','desktop_task') or p_params is null or jsonb_typeof(p_params)<>'object' then
    raise exception 'bad_execution' using errcode='22023';
  end if;
  if native then
    -- Match claim/publication order: the parent task before the device. Hold
    -- current permission rows until the guarded insert and decision commit.
    if a.task_id is not null then
      perform 1 from public.tasks where id=a.task_id for update;
    end if;
    perform 1 from public.organization_members where organization_id=a.organization_id
      and user_id=p_actor and role in ('owner','admin') for share;
    if not found then raise exception 'forbidden' using errcode='42501'; end if;
    select * into d from public.connector_devices where id=p_device
      and organization_id=a.organization_id and paired=true and revoked_at is null for share;
  else
    select * into d from public.connector_devices where id=p_device and organization_id=a.organization_id and paired=true and revoked_at is null;
  end if;
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

revoke all on function public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb) to service_role;
commit;
