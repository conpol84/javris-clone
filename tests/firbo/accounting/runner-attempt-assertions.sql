\set ON_ERROR_STOP on

create or replace function pg_temp.expect_runner_error(p_name text, p_state text, p_query text)
returns void language plpgsql as $$
begin
  begin
    execute p_query;
    raise exception 'assertion_failed: % did not fail', p_name;
  exception when others then
    if sqlstate <> p_state then
      raise exception 'assertion_failed: % returned %, expected % (%)', p_name, sqlstate, p_state, sqlerrm;
    end if;
  end;
end $$;

do $$
declare
  org constant uuid := '55555555-1548-4548-8548-555555555555';
  usr constant uuid := 'aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa';
  agent constant uuid := '66666666-1548-4548-8548-666666666666';
  task constant uuid := '77777777-1548-4548-8548-777777777777';
  claim constant uuid := '88888888-1548-4548-8548-888888888888';
  first_key constant uuid := '90000000-1548-4548-8548-900000000001';
  second_key constant uuid := '90000000-1548-4548-8548-900000000002';
  third_key constant uuid := '90000000-1548-4548-8548-900000000003';
  payload constant text := repeat('a',64);
  r jsonb;
  first_id uuid;
  second_id uuid;
  third_id uuid;
begin
  if has_table_privilege('anon','private.inference_runner_runs','select')
     or has_table_privilege('authenticated','private.inference_runner_runs','select')
     or has_table_privilege('service_role','private.inference_runner_runs','select')
     or has_table_privilege('anon','private.inference_runner_attempts','select')
     or has_table_privilege('authenticated','private.inference_runner_attempts','select')
     or has_table_privilege('service_role','private.inference_runner_attempts','select') then
    raise exception 'runner accounting tables are directly readable';
  end if;
  if has_function_privilege('anon','public.firbo_reserve_runner_inference(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,integer,numeric,integer,integer)','execute')
     or has_function_privilege('authenticated','public.firbo_reserve_runner_inference(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,integer,numeric,integer,integer)','execute')
     or not has_function_privilege('service_role','public.firbo_reserve_runner_inference(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,integer,numeric,integer,integer)','execute') then
    raise exception 'runner reservation RPC privileges are unsafe';
  end if;
  if has_function_privilege('anon','public.firbo_begin_runner_dispatch(uuid,uuid,uuid,text)','execute')
     or has_function_privilege('authenticated','public.firbo_begin_runner_dispatch(uuid,uuid,uuid,text)','execute')
     or not has_function_privilege('service_role','public.firbo_begin_runner_dispatch(uuid,uuid,uuid,text)','execute') then
    raise exception 'runner dispatch RPC privileges are unsafe';
  end if;
  if exists(
    select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
    where p.oid in (
      'public.firbo_reserve_runner_inference(uuid,uuid,uuid,uuid,uuid,integer,uuid,text,text,integer,numeric,integer,integer)'::regprocedure,
      'public.firbo_begin_runner_dispatch(uuid,uuid,uuid,text)'::regprocedure
    ) and acl.grantee=0 and acl.privilege_type='EXECUTE'
  ) then
    raise exception 'PUBLIC can execute a runner accounting RPC';
  end if;

  insert into public.organizations(id,name,slug) values(org,'Runner ledger fixture','runner-ledger-fixture');
  insert into public.organization_members(organization_id,user_id,role) values(org,usr,'owner');
  insert into public.agents(id,organization_id,name,slug,monthly_budget_usd)
    values(agent,org,'Runner employee','runner-employee',1.00);
  insert into public.tasks(id,organization_id,created_by,assigned_agent_id,title,status,run_claim,result)
    values(task,org,usr,agent,'Runner attempt fixture','running',claim,'{}'::jsonb);

  r := public.firbo_reserve_runner_inference(
    org,usr,agent,task,claim,1,first_key,payload,'omniroute:quality',4000,0.600000,60,100
  );
  if r->>'ok' <> 'true' or r->>'duplicate' <> 'false'
     or r->>'logical_run_new' <> 'true' or r->>'dispatch_state' <> 'admitted' then
    raise exception 'first runner admission failed: %', r;
  end if;
  first_id := (r->>'request_id')::uuid;

  r := public.firbo_reserve_runner_inference(
    org,usr,agent,task,claim,1,first_key,payload,'omniroute:quality',4000,0.600000,60,100
  );
  if r->>'duplicate' <> 'true' or (r->>'request_id')::uuid <> first_id
     or r->>'dispatch_allowed' <> 'false' then
    raise exception 'duplicate runner admission was not stable: %', r;
  end if;

  perform pg_temp.expect_runner_error(
    'request key cannot change payload','22023',
    format('select public.firbo_reserve_runner_inference(%L,%L,%L,%L,%L,1,%L,%L,%L,4000,0.600000,60,100)',
      org,usr,agent,task,claim,first_key,repeat('b',64),'omniroute:quality')
  );
  perform pg_temp.expect_runner_error(
    'attempt ordinal cannot bind another key','22023',
    format('select public.firbo_reserve_runner_inference(%L,%L,%L,%L,%L,1,%L,%L,%L,4000,0.600000,60,100)',
      org,usr,agent,task,claim,second_key,payload,'omniroute:quality')
  );
  perform pg_temp.expect_runner_error(
    'wrong dispatch fingerprint denied','40001',
    format('select public.firbo_begin_runner_dispatch(%L,%L,%L,%L)',first_id,task,claim,repeat('b',64))
  );

  r := public.firbo_begin_runner_dispatch(first_id,task,claim,payload);
  if r->>'dispatch_allowed' <> 'true' or r->>'dispatch_state' <> 'dispatching' then
    raise exception 'first dispatch transition failed: %', r;
  end if;
  r := public.firbo_begin_runner_dispatch(first_id,task,claim,payload);
  if r->>'dispatch_allowed' <> 'false' or r->>'duplicate' <> 'true' then
    raise exception 'duplicate dispatch was allowed: %', r;
  end if;
  perform pg_temp.expect_runner_error(
    'dispatched attempt cannot be released','23514',
    format('select public.firbo_release_inference(%L,%L)',first_id,'synthetic_not_dispatched')
  );
  perform pg_temp.expect_runner_error(
    'task cannot publish before provider receipt','23514',
    format('select public.publish_task_run(%L,%L,%L,%L::jsonb,%L::jsonb,%L)',
      org,task,claim,'{}','[]','completed')
  );

  perform public.firbo_mark_inference_ambiguous(first_id,'synthetic_provider_unknown');
  if (select dispatch_state from private.inference_runner_attempts where request_id=first_id) <> 'reconcile_required' then
    raise exception 'ambiguous request did not synchronize attempt state';
  end if;
  perform pg_temp.expect_runner_error(
    'unresolved attempt blocks a fresh ordinal','23514',
    format('select public.firbo_reserve_runner_inference(%L,%L,%L,%L,%L,2,%L,%L,%L,4000,0.300000,60,100)',
      org,usr,agent,task,claim,second_key,payload,'omniroute:quality')
  );
  r := public.firbo_settle_inference(first_id,'omniroute:quality',100,50,0.400000,200,false);
  if r->>'status' <> 'settled'
     or (select dispatch_state from private.inference_runner_attempts where request_id=first_id) <> 'settled'
     or (select count(*) from public.usage_events where inference_request_id=first_id) <> 1 then
    raise exception 'late settlement did not reconcile exactly once: %', r;
  end if;

  r := public.firbo_reserve_runner_inference(
    org,usr,agent,task,claim,2,second_key,payload,'direct:own-key',8000,0,60,100
  );
  if r->>'ok' <> 'true' or r->>'logical_run_new' <> 'false' then
    raise exception 'second attempt consumed another logical run: %', r;
  end if;
  second_id := (r->>'request_id')::uuid;
  perform pg_temp.expect_runner_error(
    'task cancellation must first release admitted attempt','23514',
    format('update public.tasks set status=%L where id=%L','cancelled',task)
  );
  perform pg_temp.expect_runner_error(
    'settlement before dispatch denied','23514',
    format('select public.firbo_settle_inference(%L,%L,10,5,0,20,true)',second_id,'direct:own-key')
  );
  if exists(select 1 from public.usage_events where inference_request_id=second_id) then
    raise exception 'failed pre-dispatch settlement leaked a usage event';
  end if;
  r := public.firbo_release_inference(second_id,'synthetic_not_dispatched');
  if r->>'status' <> 'released'
     or (select dispatch_state from private.inference_runner_attempts where request_id=second_id) <> 'released' then
    raise exception 'proven pre-dispatch release did not synchronize: %', r;
  end if;

  r := public.firbo_reserve_runner_inference(
    org,usr,agent,task,claim,3,third_key,payload,'omniroute:quality',4000,0.300000,60,100
  );
  third_id := (r->>'request_id')::uuid;
  perform public.firbo_begin_runner_dispatch(third_id,task,claim,payload);
  r := public.firbo_settle_inference(third_id,'omniroute:quality',20,10,0.350000,100,false);
  if r->>'status' <> 'settled_overrun'
     or (select dispatch_state from private.inference_runner_attempts where request_id=third_id) <> 'settled_overrun' then
    raise exception 'runner overrun was hidden: %', r;
  end if;

  -- A second logical task is plan-limited even though retries within the first
  -- claim consumed only one logical run.
  insert into public.tasks(id,organization_id,created_by,assigned_agent_id,title,status,run_claim,result)
    values('77777777-1548-4548-8548-777777777778',org,usr,agent,'Second logical run','running',
      '88888888-1548-4548-8548-888888888889','{}'::jsonb);
  r := public.firbo_reserve_runner_inference(
    org,usr,agent,'77777777-1548-4548-8548-777777777778','88888888-1548-4548-8548-888888888889',1,
    '90000000-1548-4548-8548-900000000004',payload,'omniroute:quality',4000,0,60,1
  );
  if r->>'reason' <> 'plan_limit' then
    raise exception 'logical-run quota counted attempts instead of runs: %', r;
  end if;

  update public.tasks set status='cancelled' where id=task;
  delete from public.tasks where id=task;
  if not exists(select 1 from private.inference_runner_runs where organization_id=org and task_id=task)
     or (select count(*) from private.inference_runner_attempts where organization_id=org and task_id=task) <> 3 then
    raise exception 'task deletion erased retained accounting evidence';
  end if;
end $$;

select 'runner claim, attempt, dispatch, reconciliation, quotas and retention' as check_name, true as passed;

do $$
begin
  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('firbo_reserve_runner_inference','firbo_begin_runner_dispatch')
      and (not p.prosecdef or coalesce(array_to_string(p.proconfig,','),'') not like '%search_path=%')
  ) then
    raise exception 'runner RPC is not a fixed-search-path security definer';
  end if;
  if exists(
    select 1 from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='private' and c.relname in ('inference_runner_runs','inference_runner_attempts')
  ) then
    raise exception 'private runner ledger unexpectedly exposes an RLS policy';
  end if;
end $$;

select 'runner ledger private RLS and fixed-path RPCs' as check_name, true as passed;
