-- Agent controls (autonomy, tool policy, budget), immutable audit trail,
-- team management RPCs, atomic hiring, org profile and realtime.

alter table public.organizations
  add column profile jsonb not null default '{}'::jsonb check (pg_column_size(profile) < 8192);

alter table public.agents
  add column autonomy text not null default 'approval'
    check (autonomy in ('suggest', 'approval', 'notify', 'auto')),
  add column monthly_budget_usd numeric(10, 2)
    check (monthly_budget_usd is null or monthly_budget_usd >= 0);

create or replace function private.sync_autonomous()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.autonomous := (new.autonomy = 'auto');
  return new;
end $$;
create trigger agents_sync_autonomous before insert or update of autonomy on public.agents
  for each row execute function private.sync_autonomous();

alter table public.agent_tools
  add column policy text not null default 'allow' check (policy in ('allow', 'approval', 'block'));

alter table public.approvals
  add column decision_note text check (decision_note is null or char_length(decision_note) <= 2000),
  add column risk text not null default 'medium' check (risk in ('low', 'medium', 'high'));

-- ---------------------------------------------------------------- audit trail
-- Clients have no write policy on audit_log; only these definer triggers write to it.
create or replace function private.write_audit(
  p_org uuid, p_action text, p_entity text, p_entity_id uuid, p_meta jsonb default '{}'::jsonb
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log (organization_id, actor_id, action, entity, entity_id, metadata)
  select p_org, (select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_meta, '{}'::jsonb)
  where exists (select 1 from public.organizations o where o.id = p_org)  -- skip while an org is being deleted
$$;
revoke all on function private.write_audit(uuid, text, text, uuid, jsonb) from public, anon, authenticated;

create or replace function private.is_seeding() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('firbo.seeding', true), '') = 'on'
$$;

create or replace function private.audit_approvals()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'approval.requested', 'approval', new.id,
      jsonb_build_object('action', new.action, 'agent_id', new.agent_id, 'risk', new.risk));
  elsif new.status is distinct from old.status then
    perform private.write_audit(new.organization_id, 'approval.' || new.status, 'approval', new.id,
      jsonb_build_object('action', new.action, 'agent_id', new.agent_id, 'note', new.decision_note));
  end if;
  return null;
end $$;
create trigger audit_approvals after insert or update on public.approvals
  for each row execute function private.audit_approvals();

create or replace function private.audit_agents()
returns trigger language plpgsql security definer set search_path = '' as $$
declare changed text[] := '{}';
begin
  if private.is_seeding() then return null; end if;
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'agent.hired', 'agent', new.id,
      jsonb_build_object('name', new.name, 'type', new.type));
  elsif tg_op = 'DELETE' then
    perform private.write_audit(old.organization_id, 'agent.removed', 'agent', old.id,
      jsonb_build_object('name', old.name));
  else
    if new.enabled is distinct from old.enabled then changed := array_append(changed, 'enabled'); end if;
    if new.autonomy is distinct from old.autonomy then changed := array_append(changed, 'autonomy'); end if;
    if new.monthly_budget_usd is distinct from old.monthly_budget_usd then changed := array_append(changed, 'budget'); end if;
    if new.model is distinct from old.model then changed := array_append(changed, 'model'); end if;
    if new.system_prompt is distinct from old.system_prompt then changed := array_append(changed, 'prompt'); end if;
    if coalesce(array_length(changed, 1), 0) > 0 then
      perform private.write_audit(new.organization_id, 'agent.updated', 'agent', new.id,
        jsonb_build_object('name', new.name, 'changed', to_jsonb(changed), 'enabled', new.enabled,
                           'autonomy', new.autonomy, 'budget', new.monthly_budget_usd));
    end if;
  end if;
  return null;
end $$;
create trigger audit_agents after insert or update or delete on public.agents
  for each row execute function private.audit_agents();

create or replace function private.audit_agent_tools()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_seeding() then return null; end if;
  if new.policy is distinct from old.policy or new.enabled is distinct from old.enabled then
    perform private.write_audit(new.organization_id, 'tool.updated', 'agent_tool', new.id,
      jsonb_build_object('agent_id', new.agent_id, 'tool', new.tool_name,
                         'policy', new.policy, 'enabled', new.enabled));
  end if;
  return null;
end $$;
create trigger audit_agent_tools after update on public.agent_tools
  for each row execute function private.audit_agent_tools();

create or replace function private.audit_members()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if private.is_seeding() then return null; end if;
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'member.added', 'member', null,
      jsonb_build_object('user_id', new.user_id, 'role', new.role));
  elsif tg_op = 'DELETE' then
    perform private.write_audit(old.organization_id, 'member.removed', 'member', null,
      jsonb_build_object('user_id', old.user_id, 'role', old.role));
  elsif new.role is distinct from old.role then
    perform private.write_audit(new.organization_id, 'member.role_changed', 'member', null,
      jsonb_build_object('user_id', new.user_id, 'from', old.role, 'to', new.role));
  end if;
  return null;
end $$;
create trigger audit_members after insert or update or delete on public.organization_members
  for each row execute function private.audit_members();

create or replace function private.audit_tasks()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.write_audit(new.organization_id, 'task.created', 'task', new.id,
      jsonb_build_object('title', new.title, 'agent_id', new.assigned_agent_id));
  elsif new.status is distinct from old.status then
    perform private.write_audit(new.organization_id, 'task.' || new.status, 'task', new.id,
      jsonb_build_object('title', new.title, 'agent_id', new.assigned_agent_id));
  end if;
  return null;
end $$;
create trigger audit_tasks after insert or update on public.tasks
  for each row execute function private.audit_tasks();

-- ---------------------------------------------------------------- org creation
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  org_id uuid;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  perform set_config('firbo.seeding', 'on', true);
  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into org_id;
  insert into public.organization_members (organization_id, user_id, role) values (org_id, uid, 'owner');
  update public.profiles set default_organization_id = coalesce(default_organization_id, org_id) where id = uid;
  perform private.seed_default_agents(org_id);
  -- Anything that reaches outside the company needs a human by default.
  update public.agent_tools set policy = 'approval'
   where organization_id = org_id
     and tool_name = any (array['channel_send', 'file_write', 'apply_patch', 'git_commit', 'shell_exec']);
  perform set_config('firbo.seeding', 'off', true);
  perform private.write_audit(org_id, 'org.created', 'organization', org_id, jsonb_build_object('name', p_name));
  return org_id;
end $$;

-- ---------------------------------------------------------------- team RPCs
create or replace function public.list_members(p_org uuid)
returns table (user_id uuid, role text, joined_at timestamptz, full_name text, email text)
language sql stable security definer set search_path = '' as $$
  select m.user_id, m.role, m.created_at, p.full_name,
         case when private.has_role(p_org, array['owner', 'admin']) then u.email::text end
  from public.organization_members m
  left join public.profiles p on p.id = m.user_id
  left join auth.users u on u.id = m.user_id
  where m.organization_id = p_org and private.is_member(p_org)
  order by m.created_at
$$;

create or replace function public.add_member_by_email(p_org uuid, p_email text, p_role text default 'member')
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not private.has_role(p_org, array['owner', 'admin']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_role not in ('owner', 'admin', 'manager', 'member', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_role = 'owner' and not private.has_role(p_org, array['owner']) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then
    raise exception 'no_account' using errcode = 'P0002';
  end if;
  insert into public.organization_members (organization_id, user_id, role)
  values (p_org, uid, p_role) on conflict do nothing;
  if not found then
    raise exception 'already_member' using errcode = '23505';
  end if;
  return uid;
end $$;

-- SECURITY INVOKER: row-level security decides who may hire.
create or replace function public.hire_agent(
  p_org uuid, p_name text, p_slug text, p_type text, p_description text, p_prompt text, p_tools jsonb
) returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  base text := p_slug;
  s text := p_slug;
  n int := 1;
  aid uuid;
  t jsonb;
begin
  while exists (select 1 from public.agents where organization_id = p_org and slug = s) loop
    n := n + 1;
    s := base || '-' || n;
  end loop;
  insert into public.agents (organization_id, name, slug, type, description, system_prompt)
  values (p_org, p_name, s, coalesce(p_type, 'custom'), p_description, coalesce(p_prompt, ''))
  returning id into aid;
  for t in select * from jsonb_array_elements(coalesce(p_tools, '[]'::jsonb)) loop
    insert into public.agent_tools (organization_id, agent_id, tool_name, policy)
    values (p_org, aid, t ->> 'tool', coalesce(t ->> 'policy', 'allow'));
  end loop;
  return aid;
end $$;

revoke all on function public.list_members(uuid), public.add_member_by_email(uuid, text, text),
  public.hire_agent(uuid, text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.list_members(uuid), public.add_member_by_email(uuid, text, text),
  public.hire_agent(uuid, text, text, text, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------- realtime
alter publication supabase_realtime add table public.tasks, public.approvals, public.agents, public.audit_log;
