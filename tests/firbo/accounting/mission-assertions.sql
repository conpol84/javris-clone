\set ON_ERROR_STOP on
begin;
insert into public.organizations(id,name,slug) values
 ('22222222-0922-4922-8922-222222222222','Mission ledger','mission-ledger');
insert into public.organization_members(organization_id,user_id,role) values
 ('22222222-0922-4922-8922-222222222222','aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa','owner');
insert into public.agents(id,organization_id,name,slug,monthly_budget_usd) values
 ('55555555-0922-4922-8922-555555555555','22222222-0922-4922-8922-222222222222','CEO','ceo',1.00),
 ('66666666-0922-4922-8922-666666666666','22222222-0922-4922-8922-222222222222','Speaker','speaker',1.00);
set local role service_role;

do $$
declare
 org constant uuid := '22222222-0922-4922-8922-222222222222';
 usr constant uuid := 'aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa';
 ceo constant uuid := '55555555-0922-4922-8922-555555555555';
 speaker constant uuid := '66666666-0922-4922-8922-666666666666';
 k constant uuid := '70000000-0922-4922-8922-700000000001';
 r jsonb;
 mission_id uuid;
begin
 r := public.firbo_reserve_inference(org,usr,ceo,'mission-runner',k,0.600000,60,100);
 if r->>'ok' <> 'true' then raise exception 'mission reservation failed: %',r; end if;
 mission_id := (r->>'request_id')::uuid;
 r := public.firbo_reserve_inference(org,usr,ceo,'mission-runner',k,0.600000,60,100);
 if r->>'duplicate' <> 'true' then raise exception 'mission duplicate not suppressed: %',r; end if;
 r := public.firbo_reserve_inference(org,usr,ceo,'agent-chat',k,0.500000,60,100);
 if r->>'reason' <> 'budget_exceeded' then raise exception 'chat ignored mission reservation: %',r; end if;
 r := public.firbo_reserve_inference(org,usr,speaker,'mission-runner',k,0,60,1);
 if r->>'reason' <> 'plan_limit' then raise exception 'second speaker ignored company reservation: %',r; end if;
 r := public.firbo_reserve_inference(org,usr,ceo,'agent-chat',k,0,1,100);
 if r->>'reason' <> 'rate_limited' then raise exception 'chat ignored mission hourly use: %',r; end if;
 perform public.firbo_settle_inference(mission_id,'mission:model',100,50,0.600000,100,false);
 r := public.firbo_reserve_inference(org,usr,ceo,'agent-chat',k,0.500000,60,100);
 if r->>'reason' <> 'budget_exceeded' then raise exception 'settled mission spend lost: %',r; end if;
 r := public.firbo_reserve_inference(org,usr,speaker,'mission-runner',k,0,60,100);
 if r->>'ok' <> 'true' then raise exception 'own-key/Free zero-cost speaker rejected: %',r; end if;
 perform public.firbo_settle_inference((r->>'request_id')::uuid,'own:model',10,5,0,100,true);
 begin
  perform public.firbo_reserve_inference(org,usr,ceo,'unmapped-route',gen_random_uuid(),0,60,100);
  raise exception 'unmapped source allowed';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;
select 'mission/chat shared budget, daily/hourly admission, fallback source allowlist and zero-cost settlement' as check_name, true as passed;
rollback;
