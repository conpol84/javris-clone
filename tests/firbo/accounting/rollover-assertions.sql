\set ON_ERROR_STOP on
begin;

-- All fixtures roll back. No provider, tenant credentials or live data involved.
insert into public.organizations(id,name,slug) values
 ('22222222-1445-4445-8445-222222222222','Rollover ledger','rollover-ledger');
insert into public.organization_members(organization_id,user_id,role) values
 ('22222222-1445-4445-8445-222222222222','aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa','owner');
insert into public.agents(id,organization_id,name,slug,monthly_budget_usd) values
 ('55555555-1445-4445-8445-555555555555','22222222-1445-4445-8445-222222222222','Rollover','rollover',1.00);

do $$
declare
 org constant uuid := '22222222-1445-4445-8445-222222222222';
 usr constant uuid := 'aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa';
 agent constant uuid := '55555555-1445-4445-8445-555555555555';
 utc_month timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
 zone text;
 old_status text;
 old_source text;
 new_source text;
 r jsonb;
 old_id uuid;
 new_id uuid;
 old_key uuid;
begin
 foreach zone in array array['Pacific/Kiritimati','Pacific/Pago_Pago'] loop
  perform set_config('TimeZone',zone,true);
  foreach old_status in array array['reserved','reconcile_required'] loop
   foreach old_source in array array['agent-chat','mission-runner'] loop
    foreach new_source in array array['agent-chat','mission-runner'] loop
     old_key := gen_random_uuid();
     r := public.firbo_reserve_inference(org,usr,agent,old_source,old_key,0.750000,60,100);
     if r->>'ok' is distinct from 'true' then raise exception 'fixture reservation failed: %',r; end if;
     old_id := (r->>'request_id')::uuid;
     -- Backdate a real admitted receipt, keeping the actual production RPCs.
     update private.inference_requests set created_at=utc_month-interval '1 second',status=old_status where id=old_id;

     r := public.firbo_reserve_inference(org,usr,agent,new_source,gen_random_uuid(),0.500000,60,100);
     if r->>'reason' is distinct from 'budget_exceeded' or (r->>'reserved')::numeric is distinct from 0.750000 then
      raise exception 'rollover lost unresolved liability: zone %, status %, % -> %, %',zone,old_status,old_source,new_source,r;
     end if;
     if (select count(*) from private.inference_requests where organization_id=org) <> 1 then
      raise exception 'denied rollover admission wrote a request';
     end if;
     -- Boundary is inclusive: exactly the remaining budget is allowed.
     r := public.firbo_reserve_inference(org,usr,agent,new_source,gen_random_uuid(),0.250000,60,100);
     if r->>'ok' is distinct from 'true' then raise exception 'exact remaining budget denied: %',r; end if;
     new_id := (r->>'request_id')::uuid;
     perform public.firbo_release_inference(new_id,'synthetic_not_dispatched');

     -- Late settlement replaces an old reservation with current-month actual
     -- usage exactly once. It must not make the liability disappear or double it.
     r := public.firbo_settle_inference(old_id,'synthetic:model',10,5,0.600000,20,false);
     if r->>'status' is distinct from 'settled' then raise exception 'late settlement failed: %',r; end if;
     perform public.firbo_settle_inference(old_id,'synthetic:model',10,5,0.600000,20,false);
     if (select count(*) from public.usage_events where inference_request_id=old_id) <> 1 then
      raise exception 'late settlement duplicated usage';
     end if;
     r := public.firbo_reserve_inference(org,usr,agent,new_source,gen_random_uuid(),0.500000,60,100);
     if r->>'reason' is distinct from 'budget_exceeded' or (r->>'reserved')::numeric is distinct from 0 then
      raise exception 'late settlement lost or doubled liability: %',r;
     end if;
     r := public.firbo_reserve_inference(org,usr,agent,new_source,gen_random_uuid(),0.400000,60,100);
     if r->>'ok' is distinct from 'true' then raise exception 'late settlement double-counted: %',r; end if;
     delete from public.usage_events where organization_id=org;
     delete from private.inference_requests where organization_id=org;
    end loop;
   end loop;
  end loop;
 end loop;

 -- Genuine previous-month paid usage and resolved/released reservations do
 -- expire from the monthly budget. This fix carries only unresolved exposure.
 r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',gen_random_uuid(),1.000000,60,100);
 old_id := (r->>'request_id')::uuid;
 perform public.firbo_settle_inference(old_id,'synthetic:old-paid',10,5,1.000000,20,false);
 update private.inference_requests set created_at=utc_month-interval '40 days' where id=old_id;
 update public.usage_events set created_at=utc_month-interval '40 days' where inference_request_id=old_id;
 r := public.firbo_reserve_inference(org,usr,agent,'mission-runner',gen_random_uuid(),1.000000,60,100);
 if r->>'ok' is distinct from 'true' then raise exception 'resolved prior-month usage carried forward: %',r; end if;
 new_id := (r->>'request_id')::uuid;
 update private.inference_requests set created_at=utc_month-interval '40 days' where id=new_id;
 perform public.firbo_release_inference(new_id,'synthetic_not_dispatched');
 r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',gen_random_uuid(),1.000000,60,100);
 if r->>'ok' is distinct from 'true' then raise exception 'released prior-month liability retained: %',r; end if;
 new_id := (r->>'request_id')::uuid;
 update private.inference_requests set created_at=utc_month-interval '40 days' where id=new_id;
 perform public.firbo_mark_inference_ambiguous(new_id,'synthetic_unknown');

 -- Age does not release paid liability, but it still expires from rolling
 -- hourly/daily counts; new Free/BYOK requests consume those counts normally.
 r := public.firbo_reserve_inference(org,usr,agent,'mission-runner',gen_random_uuid(),0,1,1);
 if r->>'ok' is distinct from 'true' then raise exception 'aged request polluted rolling counts or zero-cost budget: %',r; end if;
 perform public.firbo_settle_inference((r->>'request_id')::uuid,'own:model',10,5,0,20,true);
 r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',gen_random_uuid(),0,1,100);
 if r->>'reason' is distinct from 'rate_limited' then raise exception 'zero-cost hourly count lost: %',r; end if;
 r := public.firbo_reserve_inference(org,usr,agent,'agent-chat',gen_random_uuid(),0,60,1);
 if r->>'reason' is distinct from 'plan_limit' then raise exception 'zero-cost daily count lost: %',r; end if;

 -- Preserve the private service boundary and empty search_path.
 if has_function_privilege('anon','public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)','execute')
 or has_function_privilege('authenticated','public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)','execute')
 or not has_function_privilege('service_role','public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)','execute') then
  raise exception 'rollover changed RPC permissions';
 end if;
 if not exists(select 1 from pg_proc where oid='public.firbo_reserve_inference(uuid,uuid,uuid,text,uuid,numeric,integer,integer)'::regprocedure
   and prosecdef and proconfig @> array['search_path=""']) then
  raise exception 'rollover changed security definer search_path';
 end if;
end $$;
select 'rollover: 16 timezone/status/source combinations, exact boundary, late settlement, old resolved usage, release, zero-cost quotas, permissions' as check_name,true as passed;
rollback;
