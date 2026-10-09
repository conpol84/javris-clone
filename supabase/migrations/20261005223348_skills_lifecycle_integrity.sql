-- Preserve every installed skill. Conflicting historical records require explicit
-- review before this migration can proceed; never delete or rewrite them here.
do $$
begin
  if exists (
    select 1 from public.skills
    group by organization_id, agent_id, slug having count(*) > 1
  ) then
    raise exception 'skills_duplicate_scope: review duplicate organization/employee/slug records before applying';
  end if;
  if exists (
    select 1 from public.skills s join public.agents a on a.id = s.agent_id
    where s.organization_id <> a.organization_id
  ) then
    raise exception 'skills_agent_wrong_organization: review cross-company assignments before applying';
  end if;
end
$$;

-- A team-wide skill and an employee-specific skill may coexist. Repeat installs
-- for the same target cannot race into duplicate rows.
create unique index if not exists skills_scope_slug_unique on public.skills (
  organization_id,
  coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  slug
);

-- RLS authorizes writes to the company, and this composite key also prevents a
-- forged employee ID from targeting a different company's agent.
alter table public.skills add constraint skills_agent_same_organization
  foreign key (organization_id, agent_id)
  references public.agents (organization_id, id) on delete cascade;
