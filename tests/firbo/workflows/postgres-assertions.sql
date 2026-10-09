-- Synthetic records only; every change is rolled back. It also runs unchanged
-- against the actual deployed RLS schema after applying the candidate migration.
begin;
create temp table workflow_test_state(k text primary key,v jsonb);
create temp table workflow_test_results(name text primary key,passed boolean);
grant select,insert,update on workflow_test_state,workflow_test_results to authenticated;
-- Set-up bypass applies only to disposable synthetic membership/agent rows.
-- Every RPC and permission assertion below runs with normal limits and RLS.
select set_config('firbo.seeding','on',true);
insert into auth.users(id) values
 ('aaeeeeee-0111-4111-8111-aaeeeeeeeeee'),('aaeeeeee-0222-4222-8222-aaeeeeeeeeee'),
 ('aaeeeeee-0333-4333-8333-aaeeeeeeeeee'),('aaeeeeee-0444-4444-8444-aaeeeeeeeeee'),
 ('aaeeeeee-0555-4555-8555-aaeeeeeeeeee'),('aaeeeeee-0666-4666-8666-aaeeeeeeeeee');
insert into public.organizations(id,name,slug) values
 ('bbeeeeee-0111-4111-8111-bbeeeeeeeeee','Synthetic workflow A','synthetic-workflow-atomic-a'),
 ('bbeeeeee-0222-4222-8222-bbeeeeeeeeee','Synthetic workflow B','synthetic-workflow-atomic-b');
insert into public.organization_members(organization_id,user_id,role) values
 ('bbeeeeee-0111-4111-8111-bbeeeeeeeeee','aaeeeeee-0111-4111-8111-aaeeeeeeeeee','owner'),
 ('bbeeeeee-0111-4111-8111-bbeeeeeeeeee','aaeeeeee-0222-4222-8222-aaeeeeeeeeee','admin'),
 ('bbeeeeee-0111-4111-8111-bbeeeeeeeeee','aaeeeeee-0333-4333-8333-aaeeeeeeeeee','manager'),
 ('bbeeeeee-0111-4111-8111-bbeeeeeeeeee','aaeeeeee-0444-4444-8444-aaeeeeeeeeee','member'),
 ('bbeeeeee-0111-4111-8111-bbeeeeeeeeee','aaeeeeee-0555-4555-8555-aaeeeeeeeeee','viewer'),
 ('bbeeeeee-0222-4222-8222-bbeeeeeeeeee','aaeeeeee-0666-4666-8666-aaeeeeeeeeee','owner');
insert into public.agents(id,organization_id,name,slug,enabled) values
 ('cceeeeee-0111-4111-8111-cceeeeeeeeee','bbeeeeee-0111-4111-8111-bbeeeeeeeeee','Synthetic A','synthetic-workflow-a',true),
 ('cceeeeee-0222-4222-8222-cceeeeeeeeee','bbeeeeee-0222-4222-8222-bbeeeeeeeeee','Synthetic B','synthetic-workflow-b',true),
 ('cceeeeee-0333-4333-8333-cceeeeeeeeee','bbeeeeee-0111-4111-8111-bbeeeeeeeeee','Synthetic disabled','synthetic-workflow-disabled',false);
insert into workflow_test_state values('draft','{"name":"Synthetic original","enabled":true,"trigger_type":"manual","trigger_config":{},"created_by":"aaeeeeee-0666-4666-8666-aaeeeeeeeeee","steps":[{"agent_id":"cceeeeee-0111-4111-8111-cceeeeeeeeee","action":"Original report"}]}');
select set_config('firbo.seeding','off',true);
set local request.jwt.claims='{"sub":"aaeeeeee-0111-4111-8111-aaeeeeeeeeee","role":"authenticated"}';
set local role authenticated;
do $$ declare saved jsonb; changed jsonb; draft jsonb; begin
 select v into draft from workflow_test_state where k='draft';
 saved:=public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft);
 if saved->>'created_by'<>'aaeeeeee-0111-4111-8111-aaeeeeeeeeee' or (saved->>'revision')::bigint<>1
  or jsonb_array_length(saved->'workflow_steps')<>1 then raise exception 'invalid creation receipt'; end if;
 insert into workflow_test_results values('creation authenticates creator and returns steps',true);
 changed:=public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft||'{"name":"Synthetic edited","steps":[{"agent_id":"cceeeeee-0111-4111-8111-cceeeeeeeeee","action":"First updated report"},{"agent_id":"cceeeeee-0111-4111-8111-cceeeeeeeeee","action":"Second updated report"}]}'::jsonb,(saved->>'id')::uuid,1);
 if (changed->>'revision')::bigint<>2 or jsonb_array_length(changed->'workflow_steps')<>2 then raise exception 'edit receipt incorrect'; end if;
 insert into workflow_test_state values('saved',changed);
 insert into workflow_test_results values('edit replaces all steps once and advances revision',true);
 begin
  perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft,(saved->>'id')::uuid,1);
  raise exception 'stale revision unexpectedly saved';
 exception when serialization_failure then if sqlerrm<>'workflow_conflict' then raise; end if; end;
 insert into workflow_test_results values('stale edit rejected',true);
end $$;
reset role;
-- Inject a failure AFTER parent update/deletion; transaction rollback must restore
-- the old name, revision and exact step identifiers/content, not only row counts.
create function pg_temp.fail_synthetic_workflow_step() returns trigger language plpgsql as $$ begin
 if new.action='SYNTHETIC_INSERT_FAILURE' then raise exception using errcode='23514',message='synthetic_insert_failure'; end if; return new;
end $$;
create trigger synthetic_workflow_insert_failure before insert on public.workflow_steps
for each row execute function pg_temp.fail_synthetic_workflow_step();
set local role authenticated;
do $$ declare old jsonb; draft jsonb; actual jsonb; wf uuid; before_count integer; begin
 select v into old from workflow_test_state where k='saved'; wf:=(old->>'id')::uuid;
 select v into draft from workflow_test_state where k='draft';
 draft:=draft||'{"name":"Must roll back","steps":[{"agent_id":"cceeeeee-0111-4111-8111-cceeeeeeeeee","action":"SYNTHETIC_INSERT_FAILURE"}]}'::jsonb;
 begin
  perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft,wf,2); raise exception 'insert failure was swallowed';
 exception when check_violation then if sqlerrm<>'synthetic_insert_failure' then raise; end if; end;
 select to_jsonb(w)||jsonb_build_object('workflow_steps',(select jsonb_agg(to_jsonb(s) order by s.position) from public.workflow_steps s where s.workflow_id=wf)) into actual from public.workflows w where w.id=wf;
 if actual<>old then raise exception 'failed edit did not preserve exact prior definition'; end if;
 insert into workflow_test_results values('late insert failure preserves parent revision and exact prior steps',true);
 select count(*) into before_count from public.workflows where organization_id='bbeeeeee-0111-4111-8111-bbeeeeeeeeee';
 begin
  perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft); raise exception 'failed create survived';
 exception when check_violation then if sqlerrm<>'synthetic_insert_failure' then raise; end if; end;
 if (select count(*) from public.workflows where organization_id='bbeeeeee-0111-4111-8111-bbeeeeeeeeee')<>before_count then raise exception 'failed create left orphan workflow'; end if;
 insert into workflow_test_results values('failed create leaves no parent or steps',true);
end $$;
reset role;
drop trigger synthetic_workflow_insert_failure on public.workflow_steps;
set local role authenticated;
do $$ declare draft jsonb; old jsonb; cfg jsonb; bad_agent uuid; begin
 select v into draft from workflow_test_state where k='draft';select v into old from workflow_test_state where k='saved';
 foreach bad_agent in array array['cceeeeee-0222-4222-8222-cceeeeeeeeee'::uuid,'cceeeeee-0333-4333-8333-cceeeeeeeeee'::uuid] loop
  begin
   perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft||jsonb_build_object('steps',jsonb_build_array(jsonb_build_object('agent_id',bad_agent,'action','Synthetic'))),(old->>'id')::uuid,2);
   raise exception 'foreign/disabled agent accepted';
  exception when invalid_parameter_value then if sqlerrm<>'workflow_agent_unavailable' then raise; end if; end;
 end loop;
 insert into workflow_test_results values('foreign and disabled agents rejected',true);
 for cfg in select value from jsonb_array_elements('[{"hour":24},{"minute":60},{"weekday":7},{"tz":"Invalid/Synthetic"},{"cadence":"never"}]'::jsonb) loop
  begin
   perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft||jsonb_build_object('trigger_type','schedule','trigger_config',cfg)); raise exception 'invalid schedule accepted';
  exception when invalid_parameter_value then if sqlerrm<>'workflow_invalid_schedule' then raise; end if; end;
 end loop;
 insert into workflow_test_results values('schedule bounds and IANA zone validated',true);
 draft:=public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft||'{"trigger_type":"schedule","trigger_config":{"cadence":"weekly","hour":9,"minute":15,"weekday":1,"tz":"Europe/Athens","input":"Preserve input"}}'::jsonb);
 if draft#>>'{trigger_config,input}'<>'Preserve input' or (draft->>'next_run_at')::timestamptz<=now() then raise exception 'schedule config lost or not future'; end if;
 insert into workflow_test_results values('schedule preserves configuration and server computes next run',true);
end $$;
reset role;
insert into public.workflow_runs(organization_id,workflow_id,trigger,status) select 'bbeeeeee-0111-4111-8111-bbeeeeeeeeee',(v->>'id')::uuid,'manual','running' from workflow_test_state where k='saved';
set local role authenticated;
do $$ declare old jsonb; draft jsonb; begin
 select v into old from workflow_test_state where k='saved';select v into draft from workflow_test_state where k='draft';
 begin perform public.delete_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',(old->>'id')::uuid,2); raise exception 'active run deleted';
 exception when object_not_in_prerequisite_state then if sqlerrm<>'workflow_running' then raise; end if; end;
 begin perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft,(old->>'id')::uuid,2); raise exception 'active definition edited';
 exception when object_not_in_prerequisite_state then if sqlerrm<>'workflow_running' then raise; end if; end;
 begin delete from public.workflows where id=(old->>'id')::uuid; raise exception 'legacy direct delete erased run';
 exception when object_not_in_prerequisite_state then if sqlerrm<>'workflow_running' then raise; end if; end;
 insert into workflow_test_results values('running workflow blocks RPC edit/delete and legacy direct delete',true);
end $$;
reset role;
update public.workflow_runs set status='completed' where organization_id='bbeeeeee-0111-4111-8111-bbeeeeeeeeee';
set local role authenticated;
do $$ declare draft jsonb; identity uuid; saved jsonb; denied uuid; begin
 select v into draft from workflow_test_state where k='draft';
 foreach identity in array array['aaeeeeee-0111-4111-8111-aaeeeeeeeeee'::uuid,'aaeeeeee-0222-4222-8222-aaeeeeeeeeee'::uuid,'aaeeeeee-0333-4333-8333-aaeeeeeeeeee'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',identity,'role','authenticated')::text,true);
  saved:=public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft);
  if public.delete_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',(saved->>'id')::uuid,1)<>(saved->>'id')::uuid then raise exception 'valid delete unconfirmed'; end if;
 end loop;
 insert into workflow_test_results values('owner admin and manager can atomically create and delete',true);
 foreach denied in array array['aaeeeeee-0444-4444-8444-aaeeeeeeeeee'::uuid,'aaeeeeee-0555-4555-8555-aaeeeeeeeeee'::uuid,'aaeeeeee-0666-4666-8666-aaeeeeeeeeee'::uuid] loop
  perform set_config('request.jwt.claims',jsonb_build_object('sub',denied,'role','authenticated')::text,true);
  begin perform public.save_workflow('bbeeeeee-0111-4111-8111-bbeeeeeeeeee',draft); raise exception 'non-manager saved'; exception when insufficient_privilege then if sqlerrm<>'forbidden' then raise; end if; end;
 end loop;
 insert into workflow_test_results values('member viewer and foreign organization owner cannot write',true);
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.save_workflow(uuid,jsonb,uuid,bigint)','execute') or has_function_privilege('anon','public.delete_workflow(uuid,uuid,bigint)','execute') then raise exception 'anonymous workflow RPC exposure'; end if;
 if (select prosecdef from pg_proc where oid='public.save_workflow(uuid,jsonb,uuid,bigint)'::regprocedure) then raise exception 'save RPC bypasses RLS'; end if;
 insert into workflow_test_results values('RPCs invoker and anonymous execute revoked',true);
end $$;
-- A deliberate organization cascade still works even if it contains a running flow.
insert into public.workflows(id,organization_id,name) values('ddeeeeee-0222-4222-8222-ddeeeeeeeeee','bbeeeeee-0222-4222-8222-bbeeeeeeeeee','Synthetic cascade flow');
insert into public.workflow_runs(organization_id,workflow_id,trigger,status) values('bbeeeeee-0222-4222-8222-bbeeeeeeeeee','ddeeeeee-0222-4222-8222-ddeeeeeeeeee','manual','running');
delete from public.organizations where id='bbeeeeee-0222-4222-8222-bbeeeeeeeeee';
do $$ begin
 if exists(select 1 from public.workflow_runs where workflow_id='ddeeeeee-0222-4222-8222-ddeeeeeeeeee') then raise exception 'organization cascade left run'; end if;
 insert into workflow_test_results values('organization cascade preserved',true);
end $$;
select name,passed from workflow_test_results order by name;
rollback;
