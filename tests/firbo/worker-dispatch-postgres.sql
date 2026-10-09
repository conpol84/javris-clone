-- Run after the actual desktop-control and worker-dispatch migrations against
-- disposable stock PostgreSQL with the workspace/task fixtures. Never live.
begin;
set local firbo.seeding='on';
insert into auth.users(id,raw_user_meta_data) values
 ('aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','{}'),
 ('bbbbbbbb-1212-4212-8212-bbbbbbbbbbbb','{}'),
 ('cccccccc-1212-4212-8212-cccccccccccc','{}'),
 ('dddddddd-1212-4212-8212-dddddddddddd','{}');
insert into public.organizations(id,name,slug,plan,plan_status) values
 ('11111111-1212-4212-8212-111111111111','Dispatch owner','dispatch-owner','enterprise','active'),
 ('22222222-1212-4212-8212-222222222222','Foreign dispatch owner','dispatch-foreign','business','active');
insert into public.organization_members(organization_id,user_id,role) values
 ('11111111-1212-4212-8212-111111111111','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','owner'),
 ('11111111-1212-4212-8212-111111111111','bbbbbbbb-1212-4212-8212-bbbbbbbbbbbb','admin'),
 ('11111111-1212-4212-8212-111111111111','cccccccc-1212-4212-8212-cccccccccccc','member'),
 ('22222222-1212-4212-8212-222222222222','dddddddd-1212-4212-8212-dddddddddddd','owner');
insert into public.connector_devices(id,organization_id,created_by,name,paired,capabilities,agent_policy) values
 ('77777777-1212-4212-8212-777777777777','11111111-1212-4212-8212-111111111111','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','Selected Debian',true,
  '{"full_control":true,"job_kinds":["desktop_task","list"]}','{"enabled":true,"control":"full"}'),
 ('88888888-1212-4212-8212-888888888888','11111111-1212-4212-8212-111111111111','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','Other eligible worker',true,
  '{"full_control":true,"job_kinds":["desktop_task","list"]}','{"enabled":true,"control":"full"}'),
 ('99999999-1212-4212-8212-999999999999','22222222-1212-4212-8212-222222222222','dddddddd-1212-4212-8212-dddddddddddd','Foreign worker',true,
  '{"full_control":true,"job_kinds":["desktop_task","list"]}','{"enabled":true,"control":"full"}');

create function pg_temp.assert_dispatch(label text, ok boolean) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'dispatch assertion failed: %',label; end if; end $$;

create function pg_temp.native_approval(bound_device uuid default '77777777-1212-4212-8212-777777777777')
returns uuid language plpgsql as $$
declare id uuid; payload jsonb := '{"goal":"Open the synthetic test app","ai_generated":true}';
begin
 if bound_device is not null then payload:=payload||jsonb_build_object('device_id',bound_device); end if;
 insert into public.approvals(organization_id,action,payload)
 values('11111111-1212-4212-8212-111111111111','computer_desktop_task',payload) returning approvals.id into id;
 return id;
end $$;

create function pg_temp.approve_native(requested_approval uuid, actor uuid default 'aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa',
 device uuid default '77777777-1212-4212-8212-777777777777') returns jsonb language plpgsql as $$
declare p jsonb;
begin
 select payload into p from public.approvals where approvals.id=requested_approval;
 return public.connector_decide_execution(requested_approval,actor,device,'approved',null,p,'desktop_task',jsonb_build_object('goal',p->>'goal'));
end $$;

create function pg_temp.deny_native(requested_approval uuid, label text, expected text,
 actor uuid default 'aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa',
 device uuid default '77777777-1212-4212-8212-777777777777',
 proposed_payload jsonb default null, kind text default 'desktop_task', proposed_params jsonb default null)
returns void language plpgsql as $$
declare p jsonb; denied boolean:=false;
begin
 select payload into p from public.approvals where approvals.id=requested_approval;
 begin
  perform public.connector_decide_execution(requested_approval,actor,device,'approved',null,coalesce(proposed_payload,p),kind,
   coalesce(proposed_params,jsonb_build_object('goal',p->>'goal')));
 exception when others then
  if sqlerrm<>expected then raise exception '%: unexpected error %',label,sqlerrm; end if;
  denied:=true;
 end;
 perform pg_temp.assert_dispatch(label||' denied',denied);
 perform pg_temp.assert_dispatch(label||' still pending',(select status='pending' from public.approvals where approvals.id=requested_approval));
 perform pg_temp.assert_dispatch(label||' no job',not exists(select 1 from public.connector_jobs where connector_jobs.approval_id=requested_approval));
end $$;

do $$
declare a uuid; b uuid; result jsonb; replay jsonb; payload jsonb; job uuid; denied boolean; variant text;
begin
 -- Both fresh owner and administrator approval create exactly one native job.
 a:=pg_temp.native_approval(); result:=pg_temp.approve_native(a);
 job:=(result->>'job_id')::uuid;
 perform pg_temp.assert_dispatch('native owner approval',result->>'decision'='approved' and result->>'duplicate'='false');
 perform pg_temp.assert_dispatch('native owner exact worker/goal/origin',exists(select 1 from public.connector_jobs where id=job
  and device_id='77777777-1212-4212-8212-777777777777' and kind='desktop_task' and origin='approval'
  and params='{"goal":"Open the synthetic test app"}' and approval_id=a));
 replay:=pg_temp.approve_native(a);
 perform pg_temp.assert_dispatch('native replay reuses first job',replay->>'job_id'=job::text and replay->>'duplicate'='true'
  and (select count(*) from public.connector_jobs where approval_id=a)=1);
 denied:=false;
 begin perform pg_temp.approve_native(a,'aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','88888888-1212-4212-8212-888888888888');
 exception when invalid_parameter_value then
  if sqlerrm<>'native_approval_mismatch' then raise; end if; denied:=true;
 end;
 perform pg_temp.assert_dispatch('native replay cannot move first worker',denied);
 update public.connector_jobs set status='cancelled' where id=job;

 a:=pg_temp.native_approval(); result:=pg_temp.approve_native(a,'bbbbbbbb-1212-4212-8212-bbbbbbbbbbbb');
 perform pg_temp.assert_dispatch('native admin approval',result->>'decision'='approved');
 update public.connector_jobs set status='cancelled' where approval_id=a;

 -- The actor's current database membership, rather than a stale session,
 -- authorizes a pending decision after a role change.
 update public.organization_members set role='owner' where organization_id='11111111-1212-4212-8212-111111111111' and user_id='bbbbbbbb-1212-4212-8212-bbbbbbbbbbbb';
 update public.organization_members set role='member' where organization_id='11111111-1212-4212-8212-111111111111' and user_id='aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa';
 a:=pg_temp.native_approval(); perform pg_temp.deny_native(a,'actor role removed','forbidden');
 update public.organization_members set role='owner' where organization_id='11111111-1212-4212-8212-111111111111' and user_id='aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa';
 update public.organization_members set role='admin' where organization_id='11111111-1212-4212-8212-111111111111' and user_id='bbbbbbbb-1212-4212-8212-bbbbbbbbbbbb';

 a:=pg_temp.native_approval(); perform pg_temp.deny_native(a,'foreign owner','forbidden','dddddddd-1212-4212-8212-dddddddddddd');
 perform pg_temp.deny_native(a,'member actor','forbidden','cccccccc-1212-4212-8212-cccccccccccc');
 perform pg_temp.deny_native(a,'other eligible worker','native_approval_mismatch','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','88888888-1212-4212-8212-888888888888');
 perform pg_temp.deny_native(a,'bound foreign worker','native_approval_mismatch','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','99999999-1212-4212-8212-999999999999');
 select approvals.payload into payload from public.approvals where id=a;
 perform pg_temp.deny_native(a,'edited payload goal','native_approval_mismatch','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','77777777-1212-4212-8212-777777777777',payload||'{"goal":"Run a different action"}');
 perform pg_temp.deny_native(a,'edited params goal','native_approval_mismatch','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','77777777-1212-4212-8212-777777777777',null,'desktop_task','{"goal":"Run a different action"}');
 perform pg_temp.deny_native(a,'extra params','native_approval_mismatch','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','77777777-1212-4212-8212-777777777777',null,'desktop_task','{"goal":"Open the synthetic test app","command":"changed"}');
 perform pg_temp.deny_native(a,'changed kind','native_approval_mismatch','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','77777777-1212-4212-8212-777777777777',null,'exec','{"command":"changed"}');
 b:=pg_temp.native_approval(null);
 perform pg_temp.deny_native(b,'unbound foreign worker','device_not_ready','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','99999999-1212-4212-8212-999999999999');
 update public.approvals set action='computer_open_app' where id=b;
 perform pg_temp.deny_native(b,'native kind needs native action','native_approval_mismatch');

 -- Current authorization is checked in the same insert transaction. A denial
 -- must not consume the Inbox approval or leave a partial queued job.
 foreach variant in array array['downgrade','past_due','full_control','job_kind','enabled','control','hours','revoked','unpaired'] loop
  if variant='downgrade' then update public.organizations set plan='pro' where slug='dispatch-owner';
  elsif variant='past_due' then update public.organizations set plan_status='past_due' where slug='dispatch-owner';
  elsif variant='full_control' then update public.connector_devices set capabilities=capabilities||'{"full_control":false}' where id='77777777-1212-4212-8212-777777777777';
  elsif variant='job_kind' then update public.connector_devices set capabilities=capabilities||'{"job_kinds":["list"]}' where id='77777777-1212-4212-8212-777777777777';
  elsif variant='enabled' then update public.connector_devices set agent_policy=agent_policy||'{"enabled":false}' where id='77777777-1212-4212-8212-777777777777';
  elsif variant='control' then update public.connector_devices set agent_policy=agent_policy||'{"control":"guarded"}' where id='77777777-1212-4212-8212-777777777777';
  elsif variant='hours' then update public.connector_devices set agent_policy=agent_policy||'{"hours":{"from":0,"to":0,"tz":"UTC"}}' where id='77777777-1212-4212-8212-777777777777';
  elsif variant='revoked' then update public.connector_devices set revoked_at=now() where id='77777777-1212-4212-8212-777777777777';
  elsif variant='unpaired' then update public.connector_devices set paired=false where id='77777777-1212-4212-8212-777777777777';
  end if;
  b:=pg_temp.native_approval();
  perform pg_temp.deny_native(b,variant,case when variant in ('revoked','unpaired') then 'device_not_ready' else 'advanced_computer_not_authorized' end);
  update public.organizations set plan='enterprise',plan_status='active' where slug='dispatch-owner';
  update public.connector_devices set paired=true,revoked_at=null,
   capabilities='{"full_control":true,"job_kinds":["desktop_task","list"]}',agent_policy='{"enabled":true,"control":"full"}'
   where id='77777777-1212-4212-8212-777777777777';
 end loop;

 a:=pg_temp.native_approval(); result:=pg_temp.approve_native(a); job:=(result->>'job_id')::uuid;
 update public.connector_devices set agent_policy='{"enabled":false,"control":"full"}' where id='77777777-1212-4212-8212-777777777777';
 result:=public.connector_claim_next_job('11111111-1212-4212-8212-111111111111','77777777-1212-4212-8212-777777777777',now()-interval '1 minute');
 perform pg_temp.assert_dispatch('permission revoked before claim is cancelled',result is null and (select status='cancelled' from public.connector_jobs where id=job));

 -- Keep legacy Inbox editing and rejected decisions, with no new access grants.
 insert into public.approvals(organization_id,action,payload)
 values('11111111-1212-4212-8212-111111111111','computer_list','{"path":"."}') returning id into a;
 result:=public.connector_decide_execution(a,'aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','77777777-1212-4212-8212-777777777777',
  'approved',null,'{"path":"examples"}','list','{"path":"examples"}');
 perform pg_temp.assert_dispatch('legacy edited approval retained',result->>'decision'='approved');
 b:=pg_temp.native_approval(); result:=public.connector_decide_execution(b,'aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa',null,'rejected','No',null,null,null);
 perform pg_temp.assert_dispatch('native rejection retained',result->>'decision'='rejected' and not exists(select 1 from public.connector_jobs where approval_id=b));
 perform pg_temp.assert_dispatch('RPC remains service only',not has_function_privilege('authenticated','public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb)','execute')
  and not has_function_privilege('anon','public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb)','execute')
  and has_function_privilege('service_role','public.connector_decide_execution(uuid,uuid,uuid,text,text,jsonb,text,jsonb)','execute'));

 -- Request identity is stored atomically with the job; legacy NULL is valid.
 insert into public.connector_jobs(organization_id,device_id,created_by,kind,params,dispatch_request)
 values('11111111-1212-4212-8212-111111111111','77777777-1212-4212-8212-777777777777','aaaaaaaa-1212-4212-8212-aaaaaaaaaaaa','list','{}',
  '{"request_id":"44444444-1212-4212-8212-444444444444","proposal":{"kind":"list","params":{"path":"."}},"worker":{"id":"77777777-1212-4212-8212-777777777777"}}') returning id into job;
 perform pg_temp.assert_dispatch('request envelope persisted',(select dispatch_request->'proposal'->>'kind'='list' from public.connector_jobs where id=job));
 denied:=false;
 begin update public.connector_jobs set dispatch_request='[]' where id=job;
 exception when check_violation then denied:=true; end;
 perform pg_temp.assert_dispatch('array request rejected',denied);
 denied:=false;
 begin update public.connector_jobs set dispatch_request=jsonb_build_object('content',repeat('x',180001)) where id=job;
 exception when check_violation then denied:=true; end;
 perform pg_temp.assert_dispatch('oversized request rejected',denied);
 update public.connector_jobs set dispatch_request=null where id=job;
 perform pg_temp.assert_dispatch('legacy null request retained',(select dispatch_request is null from public.connector_jobs where id=job));
 raise notice 'WORKER_DISPATCH_NATIVE_APPROVAL_TENANT_WORKER_PAYLOAD_PLAN_PERMISSION_REPLAY_PASSED';
end $$;
rollback;
