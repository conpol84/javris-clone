-- Run in a disposable database or inside BEGIN/ROLLBACK after applying the
-- actual task lifecycle migration. Only synthetic identities/tasks are touched.
create temp table task_lifecycle_results(name text primary key, passed boolean);
grant select, insert on task_lifecycle_results to authenticated;
create function pg_temp.assert_task(p_name text, p_ok boolean) returns void language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'task regression failed: %',p_name; end if;
  insert into task_lifecycle_results values(p_name,true);
end $$;
create function pg_temp.expect_task_error(p_name text,p_message text,p_sql text) returns void language plpgsql as $$
declare rejected boolean := false;
begin
  begin execute p_sql;
  exception when others then
    if sqlerrm <> p_message then raise; end if;
    rejected := true;
  end;
  perform pg_temp.assert_task(p_name,rejected);
end $$;

-- Bypass live billing/resource caps for synthetic setup only. Assertions run
-- with the normal triggers/policies restored, including lifecycle/audit guards.
set local firbo.seeding='on';
insert into auth.users(id,raw_user_meta_data) values
 ('aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','{}'),
 ('bbbbbbbb-0502-4502-8502-bbbbbbbbbbbb','{}'),
 ('cccccccc-0503-4503-8503-cccccccccccc','{}'),
 ('dddddddd-0504-4504-8504-dddddddddddd','{}');
insert into public.organizations(id,name,slug) values
 ('11111111-0501-4501-8501-111111111111','Synthetic task lifecycle','synthetic-task-lifecycle'),
 ('22222222-0502-4502-8502-222222222222','Synthetic other task company','synthetic-other-task-company');
insert into public.organization_members(organization_id,user_id,role) values
 ('11111111-0501-4501-8501-111111111111','aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','owner'),
 ('11111111-0501-4501-8501-111111111111','bbbbbbbb-0502-4502-8502-bbbbbbbbbbbb','manager'),
 ('11111111-0501-4501-8501-111111111111','cccccccc-0503-4503-8503-cccccccccccc','member'),
 ('11111111-0501-4501-8501-111111111111','dddddddd-0504-4504-8504-dddddddddddd','viewer');
insert into public.tasks(id,organization_id,title,status,started_at,updated_at,result) values
 ('eeeeeeee-0501-4501-8501-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic completed','completed',now()-interval '1 hour',now()-interval '1 hour','{"report":"Preserved until removal"}'),
 ('eeeeeeee-0502-4502-8502-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic pending','pending',null,now(),'{}'),
 ('eeeeeeee-0503-4503-8503-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic approval','awaiting_approval',null,now(),'{}'),
 ('eeeeeeee-0504-4504-8504-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic parent','completed',null,now(),'{}'),
 ('eeeeeeee-0505-4505-8505-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic stale running','running',now()-interval '1 hour',now()-interval '1 hour','{"report":"Existing recovery evidence"}'),
 ('eeeeeeee-0506-4506-8506-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic recent running','running',now()-interval '2 minutes',now()-interval '2 minutes','{}'),
 ('eeeeeeee-0507-4507-8507-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic queued job','blocked',null,now(),'{}'),
 ('eeeeeeee-0508-4508-8508-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic running job','blocked',null,now(),'{}'),
 ('eeeeeeee-0509-4509-8509-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic active workflow','running',now()-interval '1 hour',now()-interval '1 hour','{}'),
 ('eeeeeeee-0512-4512-8512-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','Synthetic completed workflow task','completed',null,now(),'{}'),
 ('eeeeeeee-0510-4510-8510-eeeeeeeeeeee','22222222-0502-4502-8502-222222222222','Synthetic other company','completed',null,now(),'{}');
insert into public.tasks(id,organization_id,parent_task_id,title,status) values
 ('eeeeeeee-0511-4511-8511-eeeeeeeeeeee','11111111-0501-4501-8501-111111111111','eeeeeeee-0504-4504-8504-eeeeeeeeeeee','Synthetic child','pending');
insert into public.approvals(id,organization_id,task_id,action,status) values
 ('ffffffff-0501-4501-8501-ffffffffffff','11111111-0501-4501-8501-111111111111','eeeeeeee-0503-4503-8503-eeeeeeeeeeee','file_read','pending');
insert into public.connector_devices(id,organization_id,created_by,name) values
 ('77777777-0501-4501-8501-777777777777','11111111-0501-4501-8501-111111111111','aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','Synthetic disconnected test device');
insert into public.connector_jobs(id,organization_id,device_id,created_by,task_id,kind,params,status) values
 ('88888888-0501-4501-8501-888888888888','11111111-0501-4501-8501-111111111111','77777777-0501-4501-8501-777777777777','aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','eeeeeeee-0507-4507-8507-eeeeeeeeeeee','read','{"path":"synthetic-test-only"}','queued'),
 ('88888888-0502-4502-8502-888888888888','11111111-0501-4501-8501-111111111111','77777777-0501-4501-8501-777777777777','aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','eeeeeeee-0508-4508-8508-eeeeeeeeeeee','read','{"path":"synthetic-test-only"}','running');
insert into public.workflows(id,organization_id,name) values
 ('99999999-0501-4501-8501-999999999999','11111111-0501-4501-8501-111111111111','Synthetic workflow');
insert into public.workflow_runs(id,organization_id,workflow_id,task_id,status) values
 ('99999999-0502-4502-8502-999999999999','11111111-0501-4501-8501-111111111111','99999999-0501-4501-8501-999999999999','eeeeeeee-0509-4509-8509-eeeeeeeeeeee','running'),
 ('99999999-0503-4503-8503-999999999999','11111111-0501-4501-8501-111111111111','99999999-0501-4501-8501-999999999999','eeeeeeee-0512-4512-8512-eeeeeeeeeeee','running');

set local firbo.seeding='off';
select pg_temp.assert_task('anon cannot execute lifecycle RPC',not has_function_privilege('anon','public.manage_task(uuid,uuid,text,text,text)','execute'));
select pg_temp.assert_task('private lifecycle guard not callable',not has_function_privilege('authenticated','private.guard_task_lifecycle()','execute'));
select pg_temp.assert_task('private execution guard not callable',not has_function_privilege('authenticated','private.guard_task_execution()','execute'));
select pg_temp.assert_task('private approval guard not callable',not has_function_privilege('authenticated','private.guard_task_approval()','execute'));
select pg_temp.assert_task('private workflow guard not callable',not has_function_privilege('authenticated','private.guard_task_workflow()','execute'));
set local request.jwt.claims='{"sub":"cccccccc-0503-4503-8503-cccccccccccc","role":"authenticated"}';
set local role authenticated;
select pg_temp.expect_task_error('member cannot remove','forbidden',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0501-4501-8501-eeeeeeeeeeee','completed','delete')$q$);
select pg_temp.expect_task_error('member cannot cancel','forbidden',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0502-4502-8502-eeeeeeeeeeee','pending','cancel')$q$);
select pg_temp.expect_task_error('native API member cannot cancel','forbidden',$q$update public.tasks set status='cancelled' where id='eeeeeeee-0502-4502-8502-eeeeeeeeeeee'$q$);
select pg_temp.expect_task_error('native API cannot manufacture running status','task_server_status',$q$update public.tasks set status='running' where id='eeeeeeee-0502-4502-8502-eeeeeeeeeeee'$q$);
select pg_temp.expect_task_error('native API cannot manufacture approval status','task_server_status',$q$update public.tasks set status='awaiting_approval' where id='eeeeeeee-0502-4502-8502-eeeeeeeeeeee'$q$);
select pg_temp.assert_task('member retains safe manual status edits',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0502-4502-8502-eeeeeeeeeeee','pending','set_status','blocked')->>'status')='blocked');
select pg_temp.expect_task_error('native running status cannot pretend cancellation','task_in_progress',$q$update public.tasks set status='cancelled' where id='eeeeeeee-0506-4506-8506-eeeeeeeeeeee'$q$);
set local request.jwt.claims='{"sub":"dddddddd-0504-4504-8504-dddddddddddd","role":"authenticated"}';
select pg_temp.expect_task_error('viewer cannot edit status','forbidden',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0502-4502-8502-eeeeeeeeeeee','blocked','set_status','pending')$q$);
set local request.jwt.claims='{"sub":"bbbbbbbb-0502-4502-8502-bbbbbbbbbbbb","role":"authenticated"}';
select pg_temp.expect_task_error('manager cannot cross company','forbidden',$q$select public.manage_task('22222222-0502-4502-8502-222222222222','eeeeeeee-0510-4510-8510-eeeeeeeeeeee','completed','delete')$q$);
select pg_temp.expect_task_error('task must belong to supplied company','task_not_found',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0510-4510-8510-eeeeeeeeeeee','completed','delete')$q$);
select pg_temp.expect_task_error('stale status does not succeed','task_changed',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0502-4502-8502-eeeeeeeeeeee','pending','delete')$q$);
select pg_temp.expect_task_error('running task removal blocked','task_in_progress',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0506-4506-8506-eeeeeeeeeeee','running','delete')$q$);
select pg_temp.expect_task_error('running task cancellation blocked','task_in_progress',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0506-4506-8506-eeeeeeeeeeee','running','cancel')$q$);
select pg_temp.expect_task_error('child reports never cascade silently','task_has_dependents',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0504-4504-8504-eeeeeeeeeeee','completed','delete')$q$);
select pg_temp.expect_task_error('native deletion respects child guard','task_has_dependents',$q$delete from public.tasks where id='eeeeeeee-0504-4504-8504-eeeeeeeeeeee'$q$);
select pg_temp.expect_task_error('running computer job removal blocked','task_in_progress',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0508-4508-8508-eeeeeeeeeeee','blocked','delete')$q$);
select pg_temp.expect_task_error('completed task in active workflow cannot be removed','task_active_workflow',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0512-4512-8512-eeeeeeeeeeee','completed','delete')$q$);
select pg_temp.expect_task_error('native deletion cannot orphan active workflow','task_active_workflow',$q$delete from public.tasks where id='eeeeeeee-0512-4512-8512-eeeeeeeeeeee'$q$);
select pg_temp.expect_task_error('manual status cannot bypass active workflow','task_active_workflow',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0512-4512-8512-eeeeeeeeeeee','completed','set_status','pending')$q$);
select pg_temp.expect_task_error('status cannot bypass pending approvals','task_pending_approvals',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0503-4503-8503-eeeeeeeeeeee','awaiting_approval','set_status','completed')$q$);
select pg_temp.assert_task('cancellation confirmed',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0503-4503-8503-eeeeeeeeeeee','awaiting_approval','cancel')->>'status')='cancelled');
select pg_temp.assert_task('pending approval rejected atomically',(select status='rejected' and decided_by=auth.uid() from public.approvals where id='ffffffff-0501-4501-8501-ffffffffffff'));
select pg_temp.assert_task('completed removal confirmed',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0501-4501-8501-eeeeeeeeeeee','completed','delete')->>'id')='eeeeeeee-0501-4501-8501-eeeeeeeeeeee');
select pg_temp.assert_task('pending removal confirmed after cancellation',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0502-4502-8502-eeeeeeeeeeee','blocked','delete')->>'status')='cancelled');
select pg_temp.assert_task('queued job task removal confirmed',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0507-4507-8507-eeeeeeeeeeee','blocked','delete')->>'status')='cancelled');
select pg_temp.expect_task_error('recent running task cannot recover','task_not_stalled',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0506-4506-8506-eeeeeeeeeeee','running','recover')$q$);
select pg_temp.expect_task_error('active workflow prevents recovery','task_not_stalled',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0509-4509-8509-eeeeeeeeeeee','running','recover')$q$);
select pg_temp.assert_task('stalled task recovery confirmed',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','running','recover')->>'reconcile_required')='true');
select pg_temp.assert_task('recovery preserves report without claiming success',(select status='blocked' and result->>'report'='Existing recovery evidence' and result->>'verified_success'='false' from public.tasks where id='eeeeeeee-0505-4505-8505-eeeeeeeeeeee'));
select pg_temp.expect_task_error('recovered task cannot silently restart','task_reconciliation_required',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','blocked','set_status','pending')$q$);
reset role;
set local request.jwt.claims='{"role":"service_role"}';
select pg_temp.assert_task('queued cancellation persisted and task reference detached',(select status='cancelled' and task_id is null from public.connector_jobs where id='88888888-0501-4501-8501-888888888888'));
select pg_temp.assert_task('deletion audit survives task deletion',exists(select 1 from public.audit_log where entity_id='eeeeeeee-0501-4501-8501-eeeeeeeeeeee' and action='task.deleted'));
select pg_temp.assert_task('recovery audit never claims verified success',exists(select 1 from public.audit_log where entity_id='eeeeeeee-0505-4505-8505-eeeeeeeeeeee' and action='task.recovered' and metadata->>'verified_success'='false'));
select pg_temp.expect_task_error('late service final write cannot overwrite recovery','task_reconciliation_required',$q$update public.tasks set status='completed',result='{"report":"Late final output"}' where id='eeeeeeee-0505-4505-8505-eeeeeeeeeeee'$q$);
select pg_temp.expect_task_error('service cannot clear recovery marker alone','task_reconciliation_required',$q$update public.tasks set result='{}' where id='eeeeeeee-0505-4505-8505-eeeeeeeeeeee'$q$);
select pg_temp.expect_task_error('late execution cannot resurrect cancelled task','task_not_executable',$q$insert into public.connector_jobs(organization_id,device_id,created_by,task_id,kind,params,status) values('11111111-0501-4501-8501-111111111111','77777777-0501-4501-8501-777777777777','aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','eeeeeeee-0503-4503-8503-eeeeeeeeeeee','read','{}','queued')$q$);
select pg_temp.expect_task_error('recovered task cannot queue new execution','task_not_executable',$q$insert into public.connector_jobs(organization_id,device_id,created_by,task_id,kind,params,status) values('11111111-0501-4501-8501-111111111111','77777777-0501-4501-8501-777777777777','aaaaaaaa-0501-4501-8501-aaaaaaaaaaaa','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','read','{}','queued')$q$);
select pg_temp.expect_task_error('late pending approval cannot resurrect recovered task','task_not_executable',$q$insert into public.approvals(organization_id,task_id,action,status) values('11111111-0501-4501-8501-111111111111','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','file_read','pending')$q$);
select pg_temp.expect_task_error('late approval decision cannot resurrect cancelled task','task_not_executable',$q$update public.approvals set status='approved' where id='ffffffff-0501-4501-8501-ffffffffffff'$q$);
select pg_temp.expect_task_error('late workflow cannot attach recovered task','task_not_executable',$q$insert into public.workflow_runs(organization_id,workflow_id,task_id,status) values('11111111-0501-4501-8501-111111111111','99999999-0501-4501-8501-999999999999','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','running')$q$);
set local request.jwt.claims='{"sub":"bbbbbbbb-0502-4502-8502-bbbbbbbbbbbb","role":"authenticated"}';
set local role authenticated;
select pg_temp.assert_task('recovered task can be explicitly removed',(public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','blocked','delete')->>'status')='cancelled');
select pg_temp.expect_task_error('already removed task never reports success','task_not_found',$q$select public.manage_task('11111111-0501-4501-8501-111111111111','eeeeeeee-0505-4505-8505-eeeeeeeeeeee','blocked','delete')$q$);
reset role;
select name,passed from task_lifecycle_results order by name;
