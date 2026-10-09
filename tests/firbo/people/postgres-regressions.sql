-- Synthetic identities and company records; the caller wraps this in a rollback
-- transaction. The same assertions run against real production RLS and in CI.
create temp table owner_guard_results(name text primary key, passed boolean);
grant select, insert on owner_guard_results to authenticated;
insert into auth.users(id, raw_user_meta_data) values
 ('aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa', '{}'::jsonb),
 ('bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb', '{}'::jsonb);
insert into public.organizations(id,name,slug) values
 ('cccccccc-0333-4333-8333-cccccccccccc','Synthetic owner guard','synthetic-owner-guard');
insert into public.organization_members(organization_id,user_id,role) values
 ('cccccccc-0333-4333-8333-cccccccccccc','aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa','owner'),
 ('cccccccc-0333-4333-8333-cccccccccccc','bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb','manager');

do $$ begin
 begin
  update public.organization_members set role='manager' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner';
  raise exception 'sole owner demotion unexpectedly succeeded';
 exception when check_violation then if sqlerrm <> 'last_owner' then raise; end if; end;
 insert into owner_guard_results values ('sole owner demotion rejected',true);
 begin
  delete from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner';
  raise exception 'sole owner deletion unexpectedly succeeded';
 exception when check_violation then if sqlerrm <> 'last_owner' then raise; end if; end;
 insert into owner_guard_results values ('sole owner removal rejected',true);
 begin
  update public.organization_members set user_id='bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner';
  raise exception 'membership identity mutation unexpectedly succeeded';
 exception when check_violation then if sqlerrm <> 'membership_identity_immutable' then raise; end if; end;
 insert into owner_guard_results values ('membership identity immutable',true);
 begin
  delete from auth.users where id='aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa';
  raise exception 'sole owner auth cascade unexpectedly succeeded';
 exception when check_violation then if sqlerrm <> 'last_owner' then raise; end if; end;
 insert into owner_guard_results values ('sole owner auth deletion blocked',true);
end $$;

set local request.jwt.claims='{"sub":"bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb","role":"authenticated"}';
set local role authenticated;
do $$ declare n integer; begin
 update public.organization_members set role='owner' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id=auth.uid();
 get diagnostics n=row_count;
 if n<>0 then raise exception 'manager self-promotion unexpectedly succeeded'; end if;
 insert into owner_guard_results values ('manager cannot self-promote',true);
end $$;
reset role;
update public.organization_members set role='admin' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id='bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb';
set local role authenticated;
do $$ declare n integer; begin
 begin
  update public.organization_members set role='owner' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id=auth.uid();
  raise exception 'admin ownership grant unexpectedly succeeded';
 exception when insufficient_privilege then null; end;
 insert into owner_guard_results values ('admin cannot grant ownership',true);
 update public.organization_members set role='manager' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id='aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'admin changed owner unexpectedly'; end if;
 insert into owner_guard_results values ('admin cannot change owner',true);
end $$;
reset role;
update public.organization_members set role='owner' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id='bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb';

do $$ begin
 begin
  update public.organization_members set role='manager' where organization_id='cccccccc-0333-4333-8333-cccccccccccc';
  raise exception 'bulk owner demotion unexpectedly succeeded';
 exception when check_violation then if sqlerrm <> 'last_owner' then raise; end if; end;
 if (select count(*) from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner')<>2 then raise exception 'bulk demotion was not atomic'; end if;
 insert into owner_guard_results values ('bulk owner demotion rejected atomically',true);
 begin
  delete from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc';
  raise exception 'bulk owner deletion unexpectedly succeeded';
 exception when check_violation then if sqlerrm <> 'last_owner' then raise; end if; end;
 if (select count(*) from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner')<>2 then raise exception 'bulk deletion was not atomic'; end if;
 insert into owner_guard_results values ('bulk owner removal rejected atomically',true);
end $$;

set local request.jwt.claims='{"sub":"aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa","role":"authenticated"}';
set local role authenticated;
do $$ declare n integer; begin
 update public.organization_members set role='manager' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id=auth.uid();
 get diagnostics n=row_count;
 if n<>1 then raise exception 'valid ownership handoff failed'; end if;
 if (select count(*) from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner')<>1 then raise exception 'handoff lost owner'; end if;
 insert into owner_guard_results values ('handoff with second owner succeeds',true);
 if private.has_role('cccccccc-0333-4333-8333-cccccccccccc',array['owner','admin']) then raise exception 'demoted member retained admin access'; end if;
 insert into owner_guard_results values ('demoted user loses management access',true);
end $$;
reset role;
update public.organization_members set role='owner' where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and user_id='aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa';
set local request.jwt.claims='{}';
delete from auth.users where id='aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa';
do $$ begin
 if (select count(*) from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc' and role='owner')<>1 then raise exception 'second-owner auth cascade failed'; end if;
 insert into owner_guard_results values ('auth deletion with second owner succeeds',true);
 if has_function_privilege('anon','private.preserve_last_owner()','execute') or has_function_privilege('authenticated','private.preserve_last_owner()','execute') then raise exception 'private guard exposed'; end if;
 insert into owner_guard_results values ('guard has no client execute grant',true);
end $$;
delete from public.organizations where id='cccccccc-0333-4333-8333-cccccccccccc';
do $$ begin
 if exists(select 1 from public.organization_members where organization_id='cccccccc-0333-4333-8333-cccccccccccc') then raise exception 'organization cascade failed'; end if;
 insert into owner_guard_results values ('organization deletion cascade succeeds',true);
end $$;
select name,passed from owner_guard_results order by name;
