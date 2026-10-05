-- Actual claim/publish and connector decision/receipt RPCs, disposable CI only.
-- The whole fixture and fault-injection triggers are rolled back at the end.
begin;
create temp table run_protocol_results(name text primary key, passed boolean);
create temp table run_claims(task_id uuid primary key, claim uuid not null);
grant select,insert on run_protocol_results,run_claims to authenticated,service_role;
create function pg_temp.assert_run(p_name text,p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'run protocol regression failed: %',p_name; end if;
  insert into run_protocol_results values(p_name,true);
end $$;
create function pg_temp.expect_run_error(p_name text,p_message text,p_sql text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm <> p_message then raise; end if;
    rejected := true;
  end;
  perform pg_temp.assert_run(p_name,rejected);
end $$;

set local firbo.seeding='on';
insert into auth.users(id,raw_user_meta_data) values
 ('aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa','{}'),
 ('bbbbbbbb-0602-4602-8602-bbbbbbbbbbbb','{}'),
 ('cccccccc-0603-4603-8603-cccccccccccc','{}'),
 ('dddddddd-0604-4604-8604-dddddddddddd','{}'),
 ('aaaaaaaa-0605-4605-8605-aaaaaaaaaaaa','{}'),
 ('bbbbbbbb-0606-4606-8606-bbbbbbbbbbbb','{}');
insert into public.organizations(id,name,slug) values
 ('11111111-0601-4601-8601-111111111111','Synthetic run protocol','synthetic-run-protocol'),
 ('22222222-0602-4602-8602-222222222222','Synthetic run other org','synthetic-run-other-org');
insert into public.organization_members(organization_id,user_id,role) values
 ('11111111-0601-4601-8601-111111111111','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa','owner'),
 ('11111111-0601-4601-8601-111111111111','bbbbbbbb-0602-4602-8602-bbbbbbbbbbbb','admin'),
 ('11111111-0601-4601-8601-111111111111','cccccccc-0603-4603-8603-cccccccccccc','manager'),
 ('11111111-0601-4601-8601-111111111111','dddddddd-0604-4604-8604-dddddddddddd','member'),
 ('11111111-0601-4601-8601-111111111111','aaaaaaaa-0605-4605-8605-aaaaaaaaaaaa','viewer');
insert into public.agents(id,organization_id,name,slug) values
 ('33333333-0601-4601-8601-333333333333','11111111-0601-4601-8601-111111111111','Synthetic model','synthetic-run-model');
insert into public.connector_devices(id,organization_id,created_by,name,paired) values
 ('77777777-0601-4601-8601-777777777777','11111111-0601-4601-8601-111111111111','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa','Synthetic paired device',true);
insert into public.tasks(id,organization_id,assigned_agent_id,title,status,result) values
 ('eeeeeeee-0601-4601-8601-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111','33333333-0601-4601-8601-333333333333','Synthetic publication','failed','{"report":"old report","model_error":"stale error","queued":4,"execution_receipts":[{"job_id":"historic","ok":false}],"last_execution":{"job_id":"historic","ok":false},"execution_job_id":"historic","execution_status":"failed","execution_decision":"rejected"}'),
 ('eeeeeeee-0602-4602-8602-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111','33333333-0601-4601-8601-333333333333','Synthetic rollback','pending','{"report":"original"}'),
 ('eeeeeeee-0603-4603-8603-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic preflight','pending','{}'),
 ('eeeeeeee-0604-4604-8604-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic queued','blocked','{}'),
 ('eeeeeeee-0605-4605-8605-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic sibling running','blocked','{}'),
 ('eeeeeeee-0606-4606-8606-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic pending approval','blocked','{}'),
 ('eeeeeeee-0607-4607-8607-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic reconciliation','blocked','{"reconcile_required":true,"recovery_reason":"stalled_task"}'),
 ('eeeeeeee-0608-4608-8608-eeeeeeeeeeee','22222222-0602-4602-8602-222222222222',null,'Synthetic other org','pending','{}'),
 ('eeeeeeee-0609-4609-8609-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic no assigned agent','pending','{}'),
 ('eeeeeeee-0610-4610-8610-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic model failure','pending','{}'),
 ('eeeeeeee-0611-4611-8611-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic usage failure','pending','{}'),
 ('eeeeeeee-0612-4612-8612-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic recovery','running','{"report":"original recovery evidence"}'),
 ('eeeeeeee-0613-4613-8613-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111',null,'Synthetic cancellation','running','{}'),
 ('eeeeeeee-0614-4614-8614-eeeeeeeeeeee','11111111-0601-4601-8601-111111111111','33333333-0601-4601-8601-333333333333','Synthetic invalid input','pending','{}');
insert into public.connector_jobs(organization_id,device_id,task_id,kind,status) values
 ('11111111-0601-4601-8601-111111111111','77777777-0601-4601-8601-777777777777','eeeeeeee-0604-4604-8604-eeeeeeeeeeee','read','queued'),
 ('11111111-0601-4601-8601-111111111111','77777777-0601-4601-8601-777777777777','eeeeeeee-0605-4605-8605-eeeeeeeeeeee','read','running');
-- A failed sibling receipt can leave another execution running on this task.
update public.tasks set status='failed' where id='eeeeeeee-0605-4605-8605-eeeeeeeeeeee';
insert into public.approvals(organization_id,task_id,action,status) values
 ('11111111-0601-4601-8601-111111111111','eeeeeeee-0606-4606-8606-eeeeeeeeeeee','file_read','pending');
update public.tasks set run_claim='99999999-0612-4612-8612-999999999999',started_at=now()-interval '1 hour'
 where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee';
-- The normal updated_at trigger cannot manufacture elapsed time in a test.
alter table public.tasks disable trigger tasks_updated_at;
update public.tasks set updated_at=now()-interval '1 hour' where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee';
alter table public.tasks enable trigger tasks_updated_at;
update public.tasks set run_claim='99999999-0613-4613-8613-999999999999' where id='eeeeeeee-0613-4613-8613-eeeeeeeeeeee';
set local firbo.seeding='off';

select pg_temp.assert_run('claim service only',not has_function_privilege('authenticated','public.claim_task_run(uuid,uuid,uuid)','execute') and not has_function_privilege('anon','public.claim_task_run(uuid,uuid,uuid)','execute') and has_function_privilege('service_role','public.claim_task_run(uuid,uuid,uuid)','execute'));
select pg_temp.assert_run('publish service only',not has_function_privilege('authenticated','public.publish_task_run(uuid,uuid,uuid,jsonb,jsonb,text)','execute') and not has_function_privilege('anon','public.publish_task_run(uuid,uuid,uuid,jsonb,jsonb,text)','execute') and has_function_privilege('service_role','public.publish_task_run(uuid,uuid,uuid,jsonb,jsonb,text)','execute'));
select pg_temp.assert_run('private protocol guards not callable',not has_function_privilege('authenticated','private.guard_task_run_claim()','execute') and not has_function_privilege('authenticated','private.guard_task_run_dependency()','execute'));
set local request.jwt.claims='{"sub":"aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa","role":"authenticated"}';
set local role authenticated;
select pg_temp.expect_run_error('client cannot forge a run claim','task_server_claim',$q$update public.tasks set run_claim='99999999-0601-4601-8601-999999999999' where id='eeeeeeee-0603-4603-8603-eeeeeeeeeeee'$q$);
select pg_temp.expect_run_error('client cannot insert server running state','task_server_status',$q$insert into public.tasks(organization_id,title,status) values('11111111-0601-4601-8601-111111111111','Synthetic forged running','running')$q$);
do $$
declare protected_key text;
begin
  foreach protected_key in array array['execution_receipts','last_execution','execution_job_id','execution_status','execution_decision'] loop
    perform pg_temp.expect_run_error('client cannot insert provenance: '||protected_key,'task_server_result',format('insert into public.tasks(organization_id,title,status,result) values(%L,%L,%L,%L::jsonb)','11111111-0601-4601-8601-111111111111','Synthetic forged provenance','completed',jsonb_build_object(protected_key,'forged')));
    perform pg_temp.expect_run_error('client cannot change provenance: '||protected_key,'task_server_result',format('update public.tasks set result=jsonb_set(result,array[%L],to_jsonb(%L::text)) where id=%L',protected_key,'forged','eeeeeeee-0601-4601-8601-eeeeeeeeeeee'));
  end loop;
end $$;
select pg_temp.expect_run_error('client cannot overwrite claimed report','task_server_result',$q$update public.tasks set result='{"report":"forged"}' where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'$q$);
select pg_temp.expect_run_error('client cannot rewrite claimed start time','task_server_result',$q$update public.tasks set started_at=now() where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'$q$);
select pg_temp.expect_run_error('client cannot rewrite claimed completion time','task_server_result',$q$update public.tasks set completed_at=now() where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'$q$);
select pg_temp.expect_run_error('recovery cannot replace claimed report','task_server_result',$q$update public.tasks set status='blocked',result=result||jsonb_build_object('report','forged','recovery_reason','stalled_task','reconcile_required',true,'verified_success',false,'recovered_by',auth.uid()) where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'$q$);
select pg_temp.expect_run_error('recovery cannot manufacture verified success','task_server_result',$q$update public.tasks set status='blocked',result=result||jsonb_build_object('recovery_reason','stalled_task','reconcile_required',true,'verified_success',true,'recovered_by',auth.uid()) where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'$q$);
update public.tasks set title='Synthetic safe title edit' where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee';
-- Safe metadata edits refresh updated_at, so restore the simulated stalled
-- clock before asking the actual recovery RPC to validate elapsed time.
reset role;
alter table public.tasks disable trigger tasks_updated_at;
update public.tasks set updated_at=now()-interval '1 hour' where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee';
alter table public.tasks enable trigger tasks_updated_at;
set local role authenticated;
select pg_temp.assert_run('client retains safe claimed title edits',(select title='Synthetic safe title edit' and run_claim is not null from public.tasks where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'));
select pg_temp.assert_run('recovery clears the claimed run',(public.manage_task('11111111-0601-4601-8601-111111111111','eeeeeeee-0612-4612-8612-eeeeeeeeeeee','running','recover')->>'reconcile_required')='true');
select pg_temp.assert_run('recovery retains evidence and clears token',(select run_claim is null and result->>'report'='original recovery evidence' from public.tasks where id='eeeeeeee-0612-4612-8612-eeeeeeeeeeee'));
reset role;
set local request.jwt.claims='{"role":"service_role"}';
set local role service_role;
select pg_temp.expect_run_error('null actor forbidden','forbidden',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0603-4603-8603-eeeeeeeeeeee',null)$q$);
select pg_temp.expect_run_error('viewer actor forbidden','forbidden',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0603-4603-8603-eeeeeeeeeeee','aaaaaaaa-0605-4605-8605-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('nonmember actor forbidden','forbidden',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0603-4603-8603-eeeeeeeeeeee','bbbbbbbb-0606-4606-8606-bbbbbbbbbbbb')$q$);
reset role;
update public.organization_members set role='viewer' where organization_id='11111111-0601-4601-8601-111111111111' and user_id='bbbbbbbb-0602-4602-8602-bbbbbbbbbbbb';
set local role service_role;
select pg_temp.expect_run_error('claim checks fresh revoked writer membership','forbidden',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0603-4603-8603-eeeeeeeeeeee','bbbbbbbb-0602-4602-8602-bbbbbbbbbbbb')$q$);
reset role;
update public.organization_members set role='admin' where organization_id='11111111-0601-4601-8601-111111111111' and user_id='bbbbbbbb-0602-4602-8602-bbbbbbbbbbbb';
set local role service_role;
select pg_temp.expect_run_error('claim stays in supplied organization','task_not_found',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0608-4608-8608-eeeeeeeeeeee','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('queued work blocks inference claim','task_active_jobs',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0604-4604-8604-eeeeeeeeeeee','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('failed task with running sibling blocks inference','task_active_jobs',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0605-4605-8605-eeeeeeeeeeee','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('pending action blocks inference claim','task_pending_approvals',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0606-4606-8606-eeeeeeeeeeee','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('reconciliation blocks inference claim','task_reconciliation_required',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0607-4607-8607-eeeeeeeeeeee','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('late model cannot publish after recovery','state_conflict',$q$select public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0612-4612-8612-eeeeeeeeeeee','99999999-0612-4612-8612-999999999999','{"report":"late"}','[]','completed')$q$);
update public.tasks set status='cancelled' where id='eeeeeeee-0613-4613-8613-eeeeeeeeeeee';
select pg_temp.assert_run('terminal service cancellation clears claim',(select run_claim is null from public.tasks where id='eeeeeeee-0613-4613-8613-eeeeeeeeeeee'));
select pg_temp.expect_run_error('cancelled task cannot publish','state_conflict',$q$select public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0613-4613-8613-eeeeeeeeeeee','99999999-0613-4613-8613-999999999999','{}','[]','completed')$q$);

do $$
declare actor uuid; t uuid; receipt jsonb;
begin
  for actor in select user_id from public.organization_members where organization_id='11111111-0601-4601-8601-111111111111' and role in ('owner','admin','manager','member') loop
    insert into public.tasks(organization_id,title) values('11111111-0601-4601-8601-111111111111','Synthetic writer role') returning id into t;
    receipt := public.claim_task_run('11111111-0601-4601-8601-111111111111',t,actor);
    perform pg_temp.assert_run('writer can claim: '||actor::text,receipt->>'status'='running' and (receipt->>'run_claim')::uuid is not null);
    perform public.publish_task_run('11111111-0601-4601-8601-111111111111',t,(receipt->>'run_claim')::uuid,'{}','[]','completed');
  end loop;
end $$;
insert into run_claims select id,(public.claim_task_run(organization_id,id,'aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')->>'run_claim')::uuid
 from public.tasks where id in ('eeeeeeee-0601-4601-8601-eeeeeeeeeeee','eeeeeeee-0602-4602-8602-eeeeeeeeeeee','eeeeeeee-0609-4609-8609-eeeeeeeeeeee','eeeeeeee-0610-4610-8610-eeeeeeeeeeee','eeeeeeee-0611-4611-8611-eeeeeeeeeeee','eeeeeeee-0614-4614-8614-eeeeeeeeeeee');
select pg_temp.expect_run_error('duplicate inference claim conflicts','state_conflict',$q$select public.claim_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0601-4601-8601-eeeeeeeeeeee','aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa')$q$);
select pg_temp.expect_run_error('wrong run token cannot publish','state_conflict',$q$select public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0601-4601-8601-eeeeeeeeeeee','99999999-0601-4601-8601-999999999999','{}','[]','completed')$q$);
select pg_temp.expect_run_error('null run token cannot publish','state_conflict',$q$select public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0601-4601-8601-eeeeeeeeeeee',null,'{}','[]','completed')$q$);
select pg_temp.expect_run_error('publish cannot cross organization','task_not_found',$q$select public.publish_task_run('22222222-0602-4602-8602-222222222222','eeeeeeee-0601-4601-8601-eeeeeeeeeeee','99999999-0601-4601-8601-999999999999','{}','[]','completed')$q$);
select pg_temp.expect_run_error('partial action cannot become visible before report','task_not_executable',$q$insert into public.approvals(organization_id,task_id,action,status) values('11111111-0601-4601-8601-111111111111','eeeeeeee-0601-4601-8601-eeeeeeeeeeee','file_read','pending')$q$);
select pg_temp.expect_run_error('partial computer job cannot become visible before report','task_not_executable',$q$insert into public.connector_jobs(organization_id,device_id,task_id,kind,status) values('11111111-0601-4601-8601-111111111111','77777777-0601-4601-8601-777777777777','eeeeeeee-0601-4601-8601-eeeeeeeeeeee','read','queued')$q$);

-- Exercise all input bounds using the same live claim. Every rejection leaves
-- the task claimed/running and its queue empty; no successful test mirrors SQL.
do $$
declare c uuid := (select claim from run_claims where task_id='eeeeeeee-0614-4614-8614-eeeeeeeeeeee');
  payload jsonb; item record;
begin
  for item in select * from (values
    ('result must be an object','[]'::jsonb,'[]'::jsonb,'completed'),
    ('approval list must be an array','{}'::jsonb,'{}'::jsonb,'completed'),
    ('status must be terminal publication','{}'::jsonb,'[]'::jsonb,'running'),
    ('awaiting needs at least one approval','{}'::jsonb,'[]'::jsonb,'awaiting_approval'),
    ('completed cannot queue approvals','{}'::jsonb,'[{"action":"file_read","payload":{},"risk":"low"}]'::jsonb,'completed'),
    ('risk enum enforced','{}'::jsonb,'[{"action":"file_read","payload":{},"risk":"critical"}]'::jsonb,'awaiting_approval'),
    ('approval payload must be object','{}'::jsonb,'[{"action":"file_read","payload":[],"risk":"low"}]'::jsonb,'awaiting_approval'),
    ('approval must be object','{}'::jsonb,'["file_read"]'::jsonb,'awaiting_approval'),
    ('action cannot be empty','{}'::jsonb,'[{"action":"  ","payload":{},"risk":"low"}]'::jsonb,'awaiting_approval'),
    ('caller cannot inject approval scope','{}'::jsonb,'[{"action":"file_read","payload":{},"risk":"low","organization_id":"other"}]'::jsonb,'awaiting_approval'),
    ('caller cannot forge old receipts','{"execution_receipts":[]}'::jsonb,'[]'::jsonb,'completed'),
    ('caller cannot forge last receipt','{"last_execution":{}}'::jsonb,'[]'::jsonb,'completed'),
    ('caller cannot forge execution state','{"execution_status":"completed"}'::jsonb,'[]'::jsonb,'completed'),
    ('caller cannot forge execution job','{"execution_job_id":"other"}'::jsonb,'[]'::jsonb,'completed'),
    ('caller cannot forge decision history','{"execution_decision":"approved"}'::jsonb,'[]'::jsonb,'completed')
  ) x(name,result,approvals,status) loop
    perform pg_temp.expect_run_error(item.name,'bad_task_publish',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0614-4614-8614-eeeeeeeeeeee',c,item.result,item.approvals,item.status));
  end loop;
  payload := jsonb_build_object('report',repeat('x',500001));
  perform pg_temp.expect_run_error('result size bounded','bad_task_publish',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0614-4614-8614-eeeeeeeeeeee',c,payload,'[]','completed'));
  payload := jsonb_build_array(jsonb_build_object('action','file_read','payload',jsonb_build_object('body',repeat('x',100001)),'risk','low'));
  perform pg_temp.expect_run_error('action payload size bounded','bad_task_publish',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0614-4614-8614-eeeeeeeeeeee',c,'{}',payload,'awaiting_approval'));
  select jsonb_agg(jsonb_build_object('action','file_read','payload','{}'::jsonb,'risk','low')) into payload from generate_series(1,6);
  perform pg_temp.expect_run_error('action count bounded','bad_task_publish',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0614-4614-8614-eeeeeeeeeeee',c,'{}',payload,'awaiting_approval'));
  perform pg_temp.assert_run('rejected publish left claim and empty queue',(select status='running' and run_claim=c from public.tasks where id='eeeeeeee-0614-4614-8614-eeeeeeeeeeee') and not exists(select 1 from public.approvals where task_id='eeeeeeee-0614-4614-8614-eeeeeeeeeeee'));
end $$;

-- Fail after one approval has actually been inserted. A surrounding PL/pgSQL
-- exception subtransaction rolls back report, status, both queue and audit.
reset role;
create function pg_temp.fail_second_run_action() returns trigger language plpgsql as $$
begin
  if new.task_id='eeeeeeee-0602-4602-8602-eeeeeeeeeeee' and new.action='synthetic_fail_second' then raise exception 'synthetic_approval_failure'; end if;
  return new;
end $$;
create trigger synthetic_second_action_failure before insert on public.approvals for each row execute function pg_temp.fail_second_run_action();
set local role service_role;
select pg_temp.expect_run_error('second approval failure rolls back entire publication','synthetic_approval_failure',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0602-4602-8602-eeeeeeeeeeee',(select claim from run_claims where task_id='eeeeeeee-0602-4602-8602-eeeeeeeeeeee'),'{"report":"must roll back"}','[{"action":"synthetic_first","payload":{},"risk":"low"},{"action":"synthetic_fail_second","payload":{},"risk":"medium"}]','awaiting_approval'));
select pg_temp.assert_run('rollback retained original report and claim',(select status='running' and run_claim=(select claim from run_claims where task_id=id) and result->>'report'='original' from public.tasks where id='eeeeeeee-0602-4602-8602-eeeeeeeeeeee'));
select pg_temp.assert_run('rollback left no orphan approval or approval audit',not exists(select 1 from public.approvals where task_id='eeeeeeee-0602-4602-8602-eeeeeeeeeeee') and not exists(select 1 from public.audit_log where action='approval.requested' and metadata->>'action'='synthetic_first'));

select pg_temp.expect_run_error('approval publication needs assigned agent','bad_task_publish',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0609-4609-8609-eeeeeeeeeeee',(select claim from run_claims where task_id='eeeeeeee-0609-4609-8609-eeeeeeeeeeee'),'{}','[{"action":"file_read","payload":{},"risk":"low"}]','awaiting_approval'));
select pg_temp.assert_run('model failure publication confirms failed status',(public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0610-4610-8610-eeeeeeeeeeee',(select claim from run_claims where task_id='eeeeeeee-0610-4610-8610-eeeeeeeeeeee'),'{"model_error":"Synthetic failure"}','[]','failed')->>'status')='failed');
select pg_temp.assert_run('model failure publication clears claim',(select run_claim is null and result->>'model_error'='Synthetic failure' from public.tasks where id='eeeeeeee-0610-4610-8610-eeeeeeeeeeee'));
select pg_temp.assert_run('usage failure publication confirms blocked status',(public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0611-4611-8611-eeeeeeeeeeee',(select claim from run_claims where task_id='eeeeeeee-0611-4611-8611-eeeeeeeeeeee'),'{"error":"Synthetic usage failed","reconcile_required":true}','[]','blocked')->>'status')='blocked');
select pg_temp.assert_run('usage failure publication clears claim',(select run_claim is null and result->>'reconcile_required'='true' from public.tasks where id='eeeeeeee-0611-4611-8611-eeeeeeeeeeee'));
select pg_temp.assert_run('report and actions publish together',(public.publish_task_run('11111111-0601-4601-8601-111111111111','eeeeeeee-0601-4601-8601-eeeeeeeeeeee',(select claim from run_claims where task_id='eeeeeeee-0601-4601-8601-eeeeeeeeeeee'),'{"report":"new report","queued":1}','[{"action":"file_read","payload":{"path":"synthetic-only"},"risk":"low"}]','awaiting_approval')->>'queued')='1');
select pg_temp.assert_run('retry replaced stale report and error but preserved receipts',(select status='awaiting_approval' and run_claim is null and result->>'report'='new report' and result->>'queued'='1' and not result ? 'model_error' and result->'execution_receipts'='[{"job_id":"historic","ok":false}]'::jsonb and result->'last_execution'='{"job_id":"historic","ok":false}'::jsonb and result->>'execution_job_id'='historic' and result->>'execution_status'='failed' and result->>'execution_decision'='rejected' from public.tasks where id='eeeeeeee-0601-4601-8601-eeeeeeeeeeee'));
select pg_temp.assert_run('published approval inherits locked task scope',(select count(*)=1 and bool_and(organization_id='11111111-0601-4601-8601-111111111111' and agent_id='33333333-0601-4601-8601-333333333333' and status='pending' and risk='low') from public.approvals where task_id='eeeeeeee-0601-4601-8601-eeeeeeeeeeee'));

do $$
declare a uuid; j uuid; receipt jsonb;
begin
  select id into a from public.approvals where task_id='eeeeeeee-0601-4601-8601-eeeeeeeeeeee' and status='pending';
  receipt := public.connector_decide_execution(a,'aaaaaaaa-0601-4601-8601-aaaaaaaaaaaa','77777777-0601-4601-8601-777777777777','approved',null,null,'read','{"path":"synthetic-only"}');
  j := (receipt->>'job_id')::uuid;
  update public.connector_jobs set status='running' where id=j;
  receipt := public.connector_finish_execution(j,'77777777-0601-4601-8601-777777777777','11111111-0601-4601-8601-111111111111',true,'{"content":"synthetic-only"}',null,repeat('a',64));
  perform pg_temp.assert_run('real receipt preserves report and historical evidence',(select status='completed' and run_claim is null and result->>'report'='new report' and jsonb_array_length(result->'execution_receipts')=2 and result->'last_execution'->>'job_id'=j::text from public.tasks where id='eeeeeeee-0601-4601-8601-eeeeeeeeeeee'));
  perform pg_temp.expect_run_error('late model cannot overwrite real completed receipt','state_conflict',format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)','11111111-0601-4601-8601-111111111111','eeeeeeee-0601-4601-8601-eeeeeeeeeeee',(select claim from run_claims where task_id='eeeeeeee-0601-4601-8601-eeeeeeeeeeee'),'{"report":"late overwrite"}','[]','completed'));
  perform pg_temp.assert_run('duplicate real receipt stays idempotent',(public.connector_finish_execution(j,'77777777-0601-4601-8601-777777777777','11111111-0601-4601-8601-111111111111',true,'{"content":"synthetic-only"}',null,repeat('a',64))->>'duplicate')='true');
end $$;
reset role;
select name,passed from run_protocol_results order by name;
rollback;
