-- Run AFTER the skills lifecycle migration. All identities, companies, agents
-- and skills below are synthetic, and the transaction always rolls back.
begin;
-- Only fixture creation bypasses resource caps; authorization and lifecycle
-- assertions below run with the normal production guards enabled.
set local firbo.seeding = 'on';
create temp table skill_acceptance_results(name text primary key, passed boolean);
grant select, insert on skill_acceptance_results to authenticated;
insert into auth.users(id, raw_user_meta_data) values
 ('aaac0001-0555-4555-8555-aaaaaaaaaaaa', '{}'::jsonb),
 ('aaac0002-0555-4555-8555-aaaaaaaaaaaa', '{}'::jsonb),
 ('aaac0003-0555-4555-8555-aaaaaaaaaaaa', '{}'::jsonb),
 ('aaac0004-0555-4555-8555-aaaaaaaaaaaa', '{}'::jsonb);
insert into public.organizations(id, name, slug) values
 ('ccac0001-0555-4555-8555-cccccccccccc', 'Synthetic skill acceptance A', 'synthetic-skill-acceptance-a'),
 ('ccac0002-0555-4555-8555-cccccccccccc', 'Synthetic skill acceptance B', 'synthetic-skill-acceptance-b');
insert into public.organization_members(organization_id, user_id, role) values
 ('ccac0001-0555-4555-8555-cccccccccccc', 'aaac0001-0555-4555-8555-aaaaaaaaaaaa', 'owner'),
 ('ccac0001-0555-4555-8555-cccccccccccc', 'aaac0002-0555-4555-8555-aaaaaaaaaaaa', 'manager'),
 ('ccac0001-0555-4555-8555-cccccccccccc', 'aaac0003-0555-4555-8555-aaaaaaaaaaaa', 'member'),
 ('ccac0002-0555-4555-8555-cccccccccccc', 'aaac0004-0555-4555-8555-aaaaaaaaaaaa', 'owner');
insert into public.agents(id, organization_id, name, slug) values
 ('ddac0001-0555-4555-8555-dddddddddddd', 'ccac0001-0555-4555-8555-cccccccccccc', 'Synthetic skill employee A', 'skill-acceptance-a'),
 ('ddac0002-0555-4555-8555-dddddddddddd', 'ccac0002-0555-4555-8555-cccccccccccc', 'Synthetic skill employee B', 'skill-acceptance-b');

set local firbo.seeding = 'off';
set local request.jwt.claims = '{"sub":"aaac0001-0555-4555-8555-aaaaaaaaaaaa","role":"authenticated"}';
set local role authenticated;
insert into public.skills(id, organization_id, slug, name, instructions, source, created_by) values
 ('eeac0001-0555-4555-8555-eeeeeeeeeeee', 'ccac0001-0555-4555-8555-cccccccccccc', 'custom-evidence', 'Evidence', 'Read the synthetic evidence first.', 'custom', auth.uid());
do $$ begin
 if not exists(select 1 from public.skills where id='eeac0001-0555-4555-8555-eeeeeeeeeeee' and slug='custom-evidence' and description='') then raise exception 'custom skill was not saved'; end if;
 insert into skill_acceptance_results values ('owner custom add and read-back', true);
 begin
  insert into public.skills(organization_id, slug, name, instructions) values
   ('ccac0001-0555-4555-8555-cccccccccccc', 'custom-evidence', 'Duplicate', 'Read the synthetic evidence first.');
  raise exception 'duplicate team installation succeeded';
 exception when unique_violation then null; end;
 if (select count(*) from public.skills where organization_id='ccac0001-0555-4555-8555-cccccccccccc' and slug='custom-evidence')<>1 then raise exception 'duplicate write changed original record'; end if;
 insert into skill_acceptance_results values ('duplicate install rejected and original preserved', true);
end $$;
insert into public.skills(id, organization_id, agent_id, slug, name, instructions) values
 ('eeac0002-0555-4555-8555-eeeeeeeeeeee', 'ccac0001-0555-4555-8555-cccccccccccc', 'ddac0001-0555-4555-8555-dddddddddddd', 'custom-evidence', 'Employee evidence', 'Read the synthetic evidence first.');
do $$ begin
 insert into skill_acceptance_results values ('same skill permitted in team and employee scopes', true);
 begin
  insert into public.skills(organization_id, agent_id, slug, name, instructions) values
   ('ccac0001-0555-4555-8555-cccccccccccc', 'ddac0001-0555-4555-8555-dddddddddddd', 'custom-evidence', 'Duplicate', 'Read the synthetic evidence first.');
  raise exception 'duplicate employee installation succeeded';
 exception when unique_violation then null; end;
 insert into skill_acceptance_results values ('duplicate employee install rejected', true);
 begin
  insert into public.skills(organization_id, agent_id, slug, name, instructions) values
   ('ccac0001-0555-4555-8555-cccccccccccc', 'ddac0002-0555-4555-8555-dddddddddddd', 'cross-company', 'Wrong company', 'Read the synthetic evidence first.');
  raise exception 'foreign employee assignment succeeded';
 exception when foreign_key_violation then null; end;
 insert into skill_acceptance_results values ('cross-company employee assignment rejected', true);
end $$;
reset role;
insert into public.skills(id, organization_id, slug, name, instructions) values
 ('eeac0003-0555-4555-8555-eeeeeeeeeeee', 'ccac0002-0555-4555-8555-cccccccccccc', 'custom-evidence', 'Other company', 'Read the synthetic evidence first.');

set local request.jwt.claims = '{"sub":"aaac0002-0555-4555-8555-aaaaaaaaaaaa","role":"authenticated"}';
set local role authenticated;
do $$ declare n integer; begin
 update public.skills set name='Updated evidence', instructions='Updated synthetic instructions.' where organization_id='ccac0001-0555-4555-8555-cccccccccccc' and id='eeac0001-0555-4555-8555-eeeeeeeeeeee';
 get diagnostics n=row_count;
 if n<>1 or not exists(select 1 from public.skills where id='eeac0001-0555-4555-8555-eeeeeeeeeeee' and instructions='Updated synthetic instructions.') then raise exception 'manager skill edit failed'; end if;
 insert into skill_acceptance_results values ('manager edit and read-back', true);
 update public.skills set enabled=false where organization_id='ccac0001-0555-4555-8555-cccccccccccc' and id='eeac0001-0555-4555-8555-eeeeeeeeeeee';
 get diagnostics n=row_count;
 if n<>1 or not exists(select 1 from public.skills where id='eeac0001-0555-4555-8555-eeeeeeeeeeee' and enabled=false) then raise exception 'manager toggle failed'; end if;
 insert into skill_acceptance_results values ('manager toggle and read-back', true);
 update public.skills set instructions='Wrong company mutation.' where id='eeac0003-0555-4555-8555-eeeeeeeeeeee';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'cross-company skill mutation succeeded'; end if;
 if exists(select 1 from public.skills where organization_id='ccac0002-0555-4555-8555-cccccccccccc') then raise exception 'cross-company skills exposed'; end if;
 insert into skill_acceptance_results values ('company isolation on read and write', true);
 delete from public.skills where organization_id='ccac0001-0555-4555-8555-cccccccccccc' and id='eeac0002-0555-4555-8555-eeeeeeeeeeee';
 get diagnostics n=row_count;
 if n<>1 or exists(select 1 from public.skills where id='eeac0002-0555-4555-8555-eeeeeeeeeeee') then raise exception 'manager delete failed'; end if;
 insert into skill_acceptance_results values ('manager delete and absence read-back', true);
end $$;
reset role;
set local request.jwt.claims = '{"sub":"aaac0003-0555-4555-8555-aaaaaaaaaaaa","role":"authenticated"}';
set local role authenticated;
do $$ declare n integer; begin
 if not exists(select 1 from public.skills where id='eeac0001-0555-4555-8555-eeeeeeeeeeee') then raise exception 'member cannot read team skill'; end if;
 update public.skills set name='Forbidden edit' where id='eeac0001-0555-4555-8555-eeeeeeeeeeee';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'member skill edit succeeded'; end if;
 delete from public.skills where id='eeac0001-0555-4555-8555-eeeeeeeeeeee';
 get diagnostics n=row_count;
 if n<>0 then raise exception 'member skill delete succeeded'; end if;
 begin
  insert into public.skills(organization_id, slug, name, instructions) values
   ('ccac0001-0555-4555-8555-cccccccccccc', 'forbidden-add', 'Forbidden add', 'Read the synthetic evidence first.');
  raise exception 'member skill insert succeeded';
 exception when insufficient_privilege then null; end;
 insert into skill_acceptance_results values ('member reads but cannot add edit or remove', true);
end $$;
reset role;
select name, passed from skill_acceptance_results order by name;
rollback;
