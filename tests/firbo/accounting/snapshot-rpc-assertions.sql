-- Disposable exact-head CI only; synthetic callers and rows rolled back.
begin;
create temp table snapshot_before as
  select md5(coalesce(string_agg(row_to_json(r)::text, ',' order by id),'')) as digest
  from private.inference_requests r;

insert into auth.users(id) values
('aaaaaaaa-2123-4123-8123-aaaaaaaaaaaa'),
('bbbbbbbb-2123-4123-8123-bbbbbbbbbbbb'),
('cccccccc-2123-4123-8123-cccccccccccc'),
('dddddddd-2123-4123-8123-dddddddddddd');
insert into public.organizations(id,name,slug) values
('11111111-2123-4123-8123-111111111111','Snapshot one','snapshot-one'),
('22222222-2123-4123-8123-222222222222','Snapshot two','snapshot-two'),
('33333333-2123-4123-8123-333333333333','Snapshot empty','snapshot-empty');
insert into public.organization_members(organization_id,user_id,role) values
('11111111-2123-4123-8123-111111111111','aaaaaaaa-2123-4123-8123-aaaaaaaaaaaa','owner'),
('11111111-2123-4123-8123-111111111111','bbbbbbbb-2123-4123-8123-bbbbbbbbbbbb','admin'),
('11111111-2123-4123-8123-111111111111','cccccccc-2123-4123-8123-cccccccccccc','manager'),
('22222222-2123-4123-8123-222222222222','dddddddd-2123-4123-8123-dddddddddddd','owner'),
('33333333-2123-4123-8123-333333333333','aaaaaaaa-2123-4123-8123-aaaaaaaaaaaa','owner');
insert into public.agents(id,organization_id,name,slug) values
('44444444-2123-4123-8123-444444444444','11111111-2123-4123-8123-111111111111','Snapshot one','snapshot-one'),
('55555555-2123-4123-8123-555555555555','22222222-2123-4123-8123-222222222222','Snapshot two','snapshot-two');
insert into private.inference_requests
(organization_id,agent_id,source,request_key,status,reserved_usd,actual_usd,own_key,created_at,resolved_at)
values
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'reserved',.25,null,false,now()-interval '8 months',null),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-runner',gen_random_uuid(),'reconcile_required',.50,null,false,now()-interval '2 months',null),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'reserved',0,null,false,now(),null),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'settled',.20,.20,false,now()-interval '2 months',now()),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'settled',.90,.90,true,now(),now()),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'settled',0,0,false,now(),now()),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'settled',1,null,false,now(),now()),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'settled_overrun',.10,.30,false,now(),now()),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'settled',99,99,false,now()-interval '3 months',now()-interval '2 months'),
('11111111-2123-4123-8123-111111111111','44444444-2123-4123-8123-444444444444','agent-chat',gen_random_uuid(),'released',99,null,false,now(),now()),
('22222222-2123-4123-8123-222222222222','55555555-2123-4123-8123-555555555555','agent-chat',gen_random_uuid(),'reserved',99,null,false,now(),null);
create temp table snapshot_seeded as
  select md5(coalesce(string_agg(row_to_json(r)::text, ',' order by id),'')) as digest
  from private.inference_requests r;

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-2123-4123-8123-aaaaaaaaaaaa","role":"authenticated"}',true);
do $$ declare v jsonb; begin
  v := public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111',1);
  if v->>'open_count' <> '3' or v->>'potential_liability_usd' <> '0.750000'
     or (v->>'platform_settled_month_usd')::numeric <> .50
     or v->>'settled_month_count' <> '5' or v->>'byok_settled_month_count' <> '1'
     or v->>'zero_cost_settled_month_count' <> '1' or v->>'unknown_settled_cost_count' <> '1'
     or v->>'overrun_month_count' <> '1' or v->>'stale_open_count' <> '2'
     or jsonb_array_length(v->'details') <> 1
     or (v->'details'->0->>'reserved_usd')::numeric <> .25
     or v->>'read_only' <> 'true' then raise exception 'snapshot totals invalid: %',v; end if;
  if v::text ~ 'reconcile_reason|model|request_key|payload|user_id|agent_id' then
    raise exception 'snapshot leaked private fields'; end if;
  v := public.firbo_accounting_snapshot('33333333-2123-4123-8123-333333333333');
  if v->>'open_count' <> '0' or v->'details' <> '[]'::jsonb then raise exception 'empty snapshot wrong'; end if;
  begin perform public.firbo_accounting_snapshot('22222222-2123-4123-8123-222222222222');
    raise exception 'cross company permitted'; exception when insufficient_privilege then null; end;
  begin perform 1 from private.inference_requests;
    raise exception 'direct private read permitted'; exception when insufficient_privilege then null; end;
  begin perform public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111',0);
    raise exception 'zero bound allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111',201);
    raise exception 'large bound allowed'; exception when invalid_parameter_value then null; end;
  begin perform public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111',20,null);
    raise exception 'null bound allowed'; exception when invalid_parameter_value then null; end;
end $$;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-2123-4123-8123-bbbbbbbbbbbb","role":"authenticated"}',true);
select public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111')->>'open_count' as admin_count;
select set_config('request.jwt.claims','{"sub":"cccccccc-2123-4123-8123-cccccccccccc","role":"authenticated","user_metadata":{"role":"owner"}}',true);
do $$ begin
  begin perform public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111');
    raise exception 'manager or metadata authorized'; exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claims','{}',true);
do $$ begin
  begin perform public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111');
    raise exception 'missing subject authorized'; exception when insufficient_privilege then null; end;
end $$;
reset role;
delete from public.organization_members where user_id='bbbbbbbb-2123-4123-8123-bbbbbbbbbbbb';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"bbbbbbbb-2123-4123-8123-bbbbbbbbbbbb","role":"authenticated"}',true);
do $$ begin
  begin perform public.firbo_accounting_snapshot('11111111-2123-4123-8123-111111111111');
    raise exception 'revoked membership authorized'; exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ declare v_role text; begin
  foreach v_role in array array['anon','service_role'] loop
    if has_function_privilege(v_role,'public.firbo_accounting_snapshot(uuid,integer,integer)','EXECUTE')
       or has_function_privilege(v_role,'private.firbo_accounting_snapshot(uuid,integer,integer)','EXECUTE') then
      raise exception 'unexpected RPC privilege: %',v_role; end if;
  end loop;
  if (select prosecdef from pg_proc where oid='public.firbo_accounting_snapshot(uuid,integer,integer)'::regprocedure)
     or not (select prosecdef and provolatile='s' and proconfig=array['search_path=""']
       from pg_proc where oid='private.firbo_accounting_snapshot(uuid,integer,integer)'::regprocedure) then
    raise exception 'unexpected security or volatility'; end if;
  if (select digest from snapshot_seeded) <> (select md5(coalesce(string_agg(row_to_json(r)::text, ',' order by id),'')) from private.inference_requests r) then
    raise exception 'snapshot mutated ledger'; end if;
end $$;
rollback;

begin read only;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa","role":"authenticated"}',true);
select public.firbo_accounting_snapshot('11111111-0815-4815-8815-111111111111')->>'read_only' as succeeds_in_read_only_transaction;
rollback;
select 'PASS snapshot: owner/admin, current membership, tenant denial, private grants, cross-month totals, bounded safe fields, UTC settlement, BYOK/zero/unknown/overrun, read-only unchanged ledger' as result;
