\set ON_ERROR_STOP on

do $$
declare
  org constant uuid := '11111111-0815-4815-8815-111111111111';
  usr constant uuid := 'aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa';
  agent constant uuid := '33333333-0815-4815-8815-333333333333';
  open_agent constant uuid := '44444444-0815-4815-8815-444444444444';
  first_key constant uuid := '10000000-0815-4815-8815-100000000001';
  second_key constant uuid := '10000000-0815-4815-8815-100000000002';
  free_key constant uuid := '10000000-0815-4815-8815-100000000003';
  overrun_key constant uuid := '10000000-0815-4815-8815-100000000004';
  r jsonb;
  first_id uuid;
  second_id uuid;
  free_id uuid;
  overrun_id uuid;
begin
  if has_function_privilege('anon', 'public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)', 'execute') then
    raise exception 'client role can execute accounting reservation';
  end if;
  if not has_function_privilege('service_role', 'public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)', 'execute') then
    raise exception 'service role cannot execute accounting reservation';
  end if;
  if has_table_privilege('authenticated', 'private.inference_requests', 'select')
     or has_table_privilege('anon', 'private.inference_requests', 'select') then
    raise exception 'client role can read private accounting rows';
  end if;

  r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',first_key,0.600000,60,100);
  if r->>'ok' <> 'true' or r->>'duplicate' <> 'false' then raise exception 'first reservation failed: %', r; end if;
  first_id := (r->>'request_id')::uuid;

  r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',first_key,0.600000,60,100);
  if r->>'ok' <> 'true' or r->>'duplicate' <> 'true' or (r->>'request_id')::uuid <> first_id then
    raise exception 'reservation is not idempotent: %', r;
  end if;

  r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',second_key,0.500000,60,100);
  if r->>'ok' <> 'false' or r->>'reason' <> 'budget_exceeded' then
    raise exception 'active reservation was not counted: %', r;
  end if;

  r := public.firbo_settle_inference(first_id,'omniroute:test',100,50,0.400000,1200,false);
  if r->>'status' <> 'settled' then raise exception 'settlement failed: %', r; end if;
  if (select count(*) from public.usage_events where inference_request_id=first_id) <> 1 then
    raise exception 'settlement did not write exactly one usage event';
  end if;
  perform public.firbo_settle_inference(first_id,'omniroute:test',100,50,0.400000,1200,false);
  if (select count(*) from public.usage_events where inference_request_id=first_id) <> 1 then
    raise exception 'duplicate settlement wrote duplicate usage';
  end if;

  r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',second_key,0.500000,60,100);
  if r->>'ok' <> 'true' then raise exception 'released reservation was not reusable: %', r; end if;
  second_id := (r->>'request_id')::uuid;
  perform public.firbo_mark_inference_ambiguous(second_id,'provider_result_unknown');
  r := public.firbo_reserve_inference(org,usr,agent,'agent-chat','10000000-0815-4815-8815-100000000005',0.200000,60,100);
  if r->>'reason' <> 'budget_exceeded' then raise exception 'ambiguous reservation was released: %', r; end if;

  -- Zero-cost Free/BYOK work is still rate-counted but is not blocked by a
  -- paid-spend budget that it cannot increase.
  r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',free_key,0,60,100);
  if r->>'ok' <> 'true' then raise exception 'zero-cost route was blocked by paid budget: %', r; end if;
  free_id := (r->>'request_id')::uuid;
  perform public.firbo_settle_inference(free_id,'firbo-free:test',10,5,0,50,false);

  r := public.firbo_reserve_inference(org,usr,open_agent,'agent-chat',overrun_key,0.100000,60,100);
  overrun_id := (r->>'request_id')::uuid;
  r := public.firbo_settle_inference(overrun_id,'direct:test',10,5,0.200000,50,false);
  if r->>'status' <> 'settled_overrun' then raise exception 'reservation overrun was hidden: %', r; end if;

  r := public.firbo_reserve_inference(org,usr,open_agent,'agent-chat','10000000-0815-4815-8815-100000000006',0,1,100);
  if r->>'reason' <> 'rate_limited' then raise exception 'atomic hourly limit not enforced: %', r; end if;

  begin
    perform public.firbo_reserve_inference(org,usr,'99999999-0815-4815-8815-999999999999','agent-chat',
      '10000000-0815-4815-8815-100000000007',0,60,100);
    raise exception 'cross-company/missing agent accepted';
  exception when no_data_found then
    null;
  end;
end $$;

select 'accounting reservation, settlement, ACL, reconciliation and limits' as check_name, true as passed;

do $$
declare
  org_agent_cols text[];
  user_cols text[];
begin
  select array_agg(a.attname::text order by k.ordinality)
    into org_agent_cols
    from pg_class i
    join pg_namespace n on n.oid = i.relnamespace
    join pg_index x on x.indexrelid = i.oid
    join unnest(x.indkey) with ordinality as k(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
   where n.nspname = 'private'
     and i.relname = 'inference_requests_org_agent_idx';

  select array_agg(a.attname::text order by k.ordinality)
    into user_cols
    from pg_class i
    join pg_namespace n on n.oid = i.relnamespace
    join pg_index x on x.indexrelid = i.oid
    join unnest(x.indkey) with ordinality as k(attnum, ordinality) on true
    join pg_attribute a on a.attrelid = x.indrelid and a.attnum = k.attnum
   where n.nspname = 'private'
     and i.relname = 'inference_requests_user_idx';

  if org_agent_cols is distinct from array['organization_id', 'agent_id'] then
    raise exception 'organization/agent FK index missing or ordered incorrectly: %', org_agent_cols;
  end if;
  if user_cols is distinct from array['user_id'] then
    raise exception 'user FK index missing or ordered incorrectly: %', user_cols;
  end if;
end $$;

select 'accounting foreign-key covering indexes' as check_name, true as passed;
