-- Keep workflow definitions and their step replacement in a single transaction.
-- RLS remains authoritative: these RPCs are SECURITY INVOKER, authenticated only.
alter table public.workflows add column if not exists revision bigint not null default 1;

create or replace function private.bump_workflow_revision()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.name,new.description,new.enabled,new.trigger_type,new.trigger_config)
    is distinct from (old.name,old.description,old.enabled,old.trigger_type,old.trigger_config)
    and exists(select 1 from public.workflow_runs r where r.workflow_id=old.id and r.status='running') then
    raise exception using errcode='55000',message='workflow_running';
  end if;
  new.revision := old.revision + 1;
  return new;
end
$$;
revoke all on function private.bump_workflow_revision() from public, anon, authenticated;
create trigger workflows_revision before update on public.workflows
for each row execute function private.bump_workflow_revision();

create or replace function private.workflow_delete_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Organization deletion has its own explicit cascade; this guard protects a
  -- definition deleted directly while its organization still exists.
  if not exists(select 1 from public.organizations o where o.id=old.organization_id) then return old; end if;
  if exists (select 1 from public.workflow_runs r where r.workflow_id = old.id and r.status = 'running') then
    raise exception using errcode = '55000', message = 'workflow_running';
  end if;
  return old;
end
$$;
revoke all on function private.workflow_delete_guard() from public, anon, authenticated;
create trigger workflows_preserve_running before delete on public.workflows
for each row execute function private.workflow_delete_guard();

create or replace function public.save_workflow(
  p_org uuid, p_workflow jsonb, p_id uuid default null, p_expected_revision bigint default null
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  saved public.workflows;
  step jsonb;
  agent uuid;
  pos integer := 0;
  cfg jsonb;
  title text;
  trigger_kind text;
  active boolean;
  next_at timestamptz;
  zone text;
  cadence text;
  hh integer;
  mm integer;
  wd integer;
  day integer;
  local_day timestamp;
begin
  if auth.uid() is null or not exists (
    select 1 from public.organization_members m where m.organization_id = p_org
      and m.user_id = auth.uid() and m.role in ('owner','admin','manager')
  ) then raise exception using errcode = '42501', message = 'forbidden'; end if;
  if jsonb_typeof(p_workflow) is distinct from 'object'
    or jsonb_typeof(p_workflow->'steps') is distinct from 'array'
    or jsonb_typeof(p_workflow->'name') is distinct from 'string'
    or jsonb_typeof(p_workflow->'enabled') is distinct from 'boolean'
  then raise exception using errcode = '22023', message = 'workflow_invalid'; end if;
  title := btrim(p_workflow->>'name');
  trigger_kind := p_workflow->>'trigger_type';
  active := (p_workflow->>'enabled')::boolean;
  cfg := coalesce(p_workflow->'trigger_config', '{}'::jsonb);
  if length(title) not between 1 and 120
    or length(coalesce(p_workflow->>'description','')) > 500
    or trigger_kind is null or trigger_kind not in ('manual','schedule','webhook','event')
    or jsonb_typeof(cfg) is distinct from 'object'
    or octet_length(cfg::text) > 8000
    or jsonb_array_length(p_workflow->'steps') not between 1 and 8
  then raise exception using errcode = '22023', message = 'workflow_invalid'; end if;
  -- Validate every new step before touching the parent or its existing steps.
  for step in select value from jsonb_array_elements(p_workflow->'steps') loop
    if jsonb_typeof(step) is distinct from 'object'
      or jsonb_typeof(step->'action') is distinct from 'string'
      or length(btrim(step->>'action')) not between 1 and 3000
      or coalesce(step->>'agent_id','') !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
    then raise exception using errcode = '22023', message = 'workflow_invalid'; end if;
    agent := (step->>'agent_id')::uuid;
    if not exists (select 1 from public.agents a where a.organization_id = p_org and a.id = agent and a.enabled) then
      raise exception using errcode = '22023', message = 'workflow_agent_unavailable';
    end if;
  end loop;
  if trigger_kind = 'schedule' then
    cadence := coalesce(cfg->>'cadence','daily');
    zone := coalesce(cfg->>'tz','UTC');
    if cadence not in ('hourly','daily','weekly')
      or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = zone)
      or coalesce(cfg->>'hour','9') !~ '^([0-9]|1[0-9]|2[0-3])$'
      or coalesce(cfg->>'minute','0') !~ '^([0-9]|[1-5][0-9])$'
      or coalesce(cfg->>'weekday','1') !~ '^[0-6]$'
    then raise exception using errcode = '22023', message = 'workflow_invalid_schedule'; end if;
    hh := coalesce((cfg->>'hour')::integer,9);
    mm := coalesce((cfg->>'minute')::integer,0);
    wd := coalesce((cfg->>'weekday')::integer,1);
    if active then
      if cadence = 'hourly' then
        next_at := pg_catalog.date_trunc('hour',now()) + mm * interval '1 minute';
        if next_at <= now() then next_at := next_at + interval '1 hour'; end if;
      else
        local_day := pg_catalog.date_trunc('day',now() at time zone zone);
        for day in 0..8 loop
          next_at := (local_day + day * interval '1 day' + hh * interval '1 hour' + mm * interval '1 minute') at time zone zone;
          if next_at > now() and (cadence <> 'weekly' or extract(dow from next_at at time zone zone) = wd) then exit; end if;
        end loop;
      end if;
    end if;
  end if;
  if p_id is null then
    insert into public.workflows(organization_id,created_by,name,description,enabled,trigger_type,trigger_config,next_run_at)
    values(p_org,auth.uid(),title,nullif(p_workflow->>'description',''),active,trigger_kind,cfg,next_at)
    returning * into saved;
  else
    select * into saved from public.workflows w where w.organization_id = p_org and w.id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'workflow_not_found'; end if;
    if p_expected_revision is null or saved.revision <> p_expected_revision then
      raise exception using errcode = '40001', message = 'workflow_conflict';
    end if;
    if exists(select 1 from public.workflow_runs r where r.workflow_id = saved.id and r.status = 'running') then
      raise exception using errcode = '55000', message = 'workflow_running';
    end if;
    update public.workflows w set name=title,description=nullif(p_workflow->>'description',''),enabled=active,
      trigger_type=trigger_kind,trigger_config=cfg,next_run_at=next_at,updated_at=now()
    where w.organization_id=p_org and w.id=p_id returning * into saved;
    if not found then raise exception using errcode = 'P0002', message = 'workflow_not_found'; end if;
    delete from public.workflow_steps s where s.organization_id=p_org and s.workflow_id=p_id;
  end if;
  for step in select value from jsonb_array_elements(p_workflow->'steps') loop
    insert into public.workflow_steps(organization_id,workflow_id,position,agent_id,action)
    values(p_org,saved.id,pos,(step->>'agent_id')::uuid,btrim(step->>'action'));
    pos := pos + 1;
  end loop;
  return pg_catalog.to_jsonb(saved) || pg_catalog.jsonb_build_object('workflow_steps',(
    select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) order by s.position)
    from public.workflow_steps s where s.organization_id=p_org and s.workflow_id=saved.id
  ));
end
$$;
revoke all on function public.save_workflow(uuid,jsonb,uuid,bigint) from public, anon;
grant execute on function public.save_workflow(uuid,jsonb,uuid,bigint) to authenticated;

create or replace function public.delete_workflow(p_org uuid,p_id uuid,p_expected_revision bigint default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare existing public.workflows; removed uuid;
begin
  if auth.uid() is null or not exists(select 1 from public.organization_members m
    where m.organization_id=p_org and m.user_id=auth.uid() and m.role in ('owner','admin','manager')) then
    raise exception using errcode='42501',message='forbidden';
  end if;
  select * into existing from public.workflows w where w.organization_id=p_org and w.id=p_id for update;
  if not found then raise exception using errcode='P0002',message='workflow_not_found'; end if;
  if p_expected_revision is not null and existing.revision<>p_expected_revision then
    raise exception using errcode='40001',message='workflow_conflict';
  end if;
  -- The delete trigger also protects legacy direct-table writes from deleting active runs.
  delete from public.workflows w where w.organization_id=p_org and w.id=p_id returning w.id into removed;
  if removed is null then raise exception using errcode='P0002',message='workflow_not_found'; end if;
  return removed;
end
$$;
revoke all on function public.delete_workflow(uuid,uuid,bigint) from public, anon;
grant execute on function public.delete_workflow(uuid,uuid,bigint) to authenticated;
