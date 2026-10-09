alter table public.connector_jobs
  add column if not exists task_id uuid references public.tasks(id) on delete set null,
  add column if not exists approval_id uuid references public.approvals(id) on delete set null,
  add column if not exists report_sha256 text,
  add column if not exists receipt jsonb;

create index if not exists connector_jobs_task_idx on public.connector_jobs(task_id);
create index if not exists connector_jobs_approval_idx on public.connector_jobs(approval_id);
create unique index if not exists connector_jobs_one_per_approval_idx on public.connector_jobs(approval_id) where approval_id is not null;

alter table public.connector_jobs drop constraint if exists connector_jobs_report_sha256_check;
alter table public.connector_jobs add constraint connector_jobs_report_sha256_check
  check (report_sha256 is null or report_sha256 ~ '^[a-f0-9]{64}$');
alter table public.connector_jobs drop constraint if exists connector_jobs_receipt_check;
alter table public.connector_jobs add constraint connector_jobs_receipt_check
  check (receipt is null or pg_column_size(receipt) < 20000);

create or replace function public.connector_decide_execution(
  p_approval uuid, p_actor uuid, p_device uuid, p_decision text,
  p_note text, p_payload jsonb, p_kind text, p_params jsonb
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
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
  if p_device is null or p_kind not in ('list','read','write','exec') or p_params is null or jsonb_typeof(p_params)<>'object' then
    raise exception 'bad_execution' using errcode='22023';
  end if;
  select * into d from public.connector_devices where id=p_device and organization_id=a.organization_id and paired=true and revoked_at is null;
  if not found then raise exception 'device_not_ready' using errcode='P0002'; end if;
  if (select count(*) from public.connector_jobs where device_id=d.id and status='queued')>=10 then
    raise exception 'too_many' using errcode='54000';
  end if;
  insert into public.connector_jobs(organization_id,device_id,created_by,kind,params,task_id,approval_id)
    values(a.organization_id,d.id,p_actor,p_kind,p_params,a.task_id,a.id) returning id into j;
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
end $$;

revoke all on function public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb) from public, anon, authenticated;
grant execute on function public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb) to service_role;

create or replace function public.connector_finish_execution(
  p_job uuid, p_device uuid, p_org uuid, p_ok boolean, p_result jsonb, p_error text, p_digest text
) returns jsonb
language plpgsql security invoker set search_path=''
as $$
declare j public.connector_jobs%rowtype; r jsonb; tresult jsonb; receipts jsonb; pending_count int; active_count int; next_status text; finished timestamptz:=now();
begin
  if p_digest !~ '^[a-f0-9]{64}$' then raise exception 'bad_digest' using errcode='22023'; end if;
  select * into j from public.connector_jobs where id=p_job and device_id=p_device and organization_id=p_org for update;
  if not found then raise exception 'job_not_found' using errcode='P0002'; end if;
  if j.status in ('done','error') then
    if j.report_sha256=p_digest and j.status=(case when p_ok then 'done' else 'error' end) then
      return jsonb_build_object('duplicate',true,'receipt',j.receipt,'task_id',j.task_id);
    end if;
    raise exception 'report_conflict' using errcode='40001';
  end if;
  if j.status<>'running' then raise exception 'state_conflict' using errcode='40001'; end if;
  r=jsonb_build_object('contract','firbo-execution-receipt/v1','job_id',j.id,'task_id',j.task_id,'approval_id',j.approval_id,
    'device_id',j.device_id,'kind',j.kind,'ok',p_ok,'report_sha256',p_digest,'finished_at',finished);
  update public.connector_jobs set status=case when p_ok then 'done' else 'error' end,result=case when p_ok then p_result else null end,
    error=case when p_ok then null else left(coalesce(p_error,'failed'),500) end,finished_at=finished,report_sha256=p_digest,receipt=r where id=j.id;
  if j.task_id is not null then
    select coalesce(result,'{}'::jsonb) into tresult from public.tasks where id=j.task_id for update;
    receipts=coalesce(tresult->'execution_receipts','[]'::jsonb);
    if not exists(select 1 from jsonb_array_elements(receipts) x where x->>'job_id'=j.id::text) then receipts=receipts||jsonb_build_array(r); end if;
    select count(*) into pending_count from public.approvals where task_id=j.task_id and status='pending';
    select count(*) into active_count from public.connector_jobs where task_id=j.task_id and status in ('queued','running');
    next_status=case when not p_ok then 'failed' when pending_count>0 then 'awaiting_approval' when active_count>0 then 'running' else 'completed' end;
    update public.tasks set status=next_status,completed_at=case when next_status in ('completed','failed') then finished else null end,
      result=jsonb_set(jsonb_set(tresult,'{execution_receipts}',receipts,true),'{last_execution}',r,true)||jsonb_build_object('execution_status',next_status)
      where id=j.task_id;
  end if;
  insert into public.audit_log(organization_id,actor_id,action,entity,entity_id,metadata)
    values(j.organization_id,j.created_by,case when p_ok then 'connector.job_completed' else 'connector.job_failed' end,'connector_job',j.id,
      jsonb_build_object('task_id',j.task_id,'approval_id',j.approval_id,'report_sha256',p_digest,'receipt',r));
  return jsonb_build_object('duplicate',false,'receipt',r,'task_id',j.task_id);
end $$;

revoke all on function public.connector_finish_execution(uuid,uuid,uuid,boolean,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.connector_finish_execution(uuid,uuid,uuid,boolean,jsonb,text,text) to service_role;
