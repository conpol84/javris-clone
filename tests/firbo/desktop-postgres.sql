-- Actual migration/trigger/claim regression, disposable PostgreSQL only.
begin;
set local firbo.seeding='on';
insert into auth.users(id,raw_user_meta_data) values ('aaaaaaaa-0909-4909-8909-aaaaaaaaaaaa','{}');
insert into public.organizations(id,name,slug,plan,plan_status) values
 ('11111111-0909-4909-8909-111111111111','Desktop owner','desktop-owner','enterprise','active'),
 ('22222222-0909-4909-8909-222222222222','Other tenant','desktop-other','enterprise','active');
insert into public.organization_members(organization_id,user_id,role) values
 ('11111111-0909-4909-8909-111111111111','aaaaaaaa-0909-4909-8909-aaaaaaaaaaaa','owner');
insert into public.connector_devices(id,organization_id,created_by,name,paired,capabilities,agent_policy) values
 ('77777777-0909-4909-8909-777777777777','11111111-0909-4909-8909-111111111111','aaaaaaaa-0909-4909-8909-aaaaaaaaaaaa','Synthetic desktop',true,
 '{"full_control":true,"job_kinds":["desktop_task","browser_task"]}', '{"enabled":true,"control":"full"}');
create function pg_temp.desktop_enqueue(org uuid default '11111111-0909-4909-8909-111111111111') returns uuid language plpgsql as $$
declare id uuid;
begin
 insert into public.connector_jobs(organization_id,device_id,created_by,kind,params)
 values(org,'77777777-0909-4909-8909-777777777777','aaaaaaaa-0909-4909-8909-aaaaaaaaaaaa','desktop_task','{"goal":"Use synthetic app"}') returning connector_jobs.id into id;
 return id;
end $$;
do $$
declare p text; state text; job_id uuid; result jsonb; denied boolean;
begin
 foreach p in array array['free','pro','business','enterprise'] loop
  foreach state in array array['active','trialing','past_due','canceled'] loop
   update public.organizations set plan=p,plan_status=state where slug='desktop-owner';
   denied:=false;
   begin job_id:=pg_temp.desktop_enqueue();
   exception when check_violation then
     if sqlerrm<>'advanced_computer_not_authorized' then raise; end if;denied:=true;
   end;
   if denied is distinct from not(p in ('business','enterprise') and state in ('active','trialing')) then raise exception 'plan gate failed: % %',p,state;end if;
   if not denied then update public.connector_jobs set status='cancelled' where connector_jobs.id=job_id;end if;
  end loop;
 end loop;
 update public.organizations set plan='enterprise',plan_status='active' where slug='desktop-owner';
 denied:=false;
 begin perform pg_temp.desktop_enqueue('22222222-0909-4909-8909-222222222222');
 exception when check_violation then denied:=true;end;
 if not denied then raise exception 'cross tenant accepted';end if;
 job_id:=pg_temp.desktop_enqueue();
 update public.organizations set plan='pro' where slug='desktop-owner';
 result:=public.connector_claim_next_job('11111111-0909-4909-8909-111111111111','77777777-0909-4909-8909-777777777777',now()-interval '1 minute');
 if result is not null or (select status from public.connector_jobs where connector_jobs.id=job_id)<>'cancelled' then raise exception 'downgraded queued work reached device';end if;
 update public.organizations set plan='business' where slug='desktop-owner';
 job_id:=pg_temp.desktop_enqueue();
 result:=public.connector_claim_next_job('11111111-0909-4909-8909-111111111111','77777777-0909-4909-8909-777777777777',now()-interval '1 minute');
 if result->>'id' is distinct from job_id::text then raise exception 'entitled claim failed';end if;
 update public.organizations set plan_status='past_due' where slug='desktop-owner';
 -- A terminal acknowledgement remains writable after entitlement is removed.
 update public.connector_jobs set status='error',error='operation_stopped',finished_at=now() where connector_jobs.id=job_id;
 raise notice 'DESKTOP_POSTGRES_PLAN_TENANT_CLAIM_DOWNGRADE_TERMINAL_PASSED';
end $$;
rollback;
