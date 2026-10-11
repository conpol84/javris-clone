-- Source-only: FIRBO JARVIS durable admission, never deployed automatically.
-- Server-side standing permission (one user in one company), idempotent handoff
-- and a one-time queue claim using the EXISTING public.tasks and agent-runner.
-- No unrestricted shell, provider credentials, second memory or second executor.
begin;

create table public.jarvis_autopilot_settings (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default false,
  max_daily_tasks smallint not null default 5 check (max_daily_tasks between 1 and 20),
  updated_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);
create index jarvis_autopilot_settings_user_idx on public.jarvis_autopilot_settings(user_id,organization_id);
alter table public.jarvis_autopilot_settings enable row level security;
revoke all on public.jarvis_autopilot_settings from public, anon;
grant select, insert, update, delete on public.jarvis_autopilot_settings to authenticated;
grant all on public.jarvis_autopilot_settings to service_role;
create policy "personal jarvis read" on public.jarvis_autopilot_settings
  for select to authenticated
  using (user_id=(select auth.uid()) and private.is_member(organization_id));
create policy "personal jarvis opt in" on public.jarvis_autopilot_settings
  for insert to authenticated
  with check (user_id=(select auth.uid()) and private.has_role(organization_id,array['owner','admin','manager','member']));
create policy "personal jarvis update" on public.jarvis_autopilot_settings
  for update to authenticated
  using (user_id=(select auth.uid()) and private.has_role(organization_id,array['owner','admin','manager','member']))
  with check (user_id=(select auth.uid()) and private.has_role(organization_id,array['owner','admin','manager','member']));
create policy "personal jarvis revoke" on public.jarvis_autopilot_settings
  for delete to authenticated
  using (user_id=(select auth.uid()) and private.is_member(organization_id));
create trigger jarvis_autopilot_updated_at before update on public.jarvis_autopilot_settings
  for each row execute function private.set_updated_at();

create function private.guard_jarvis_identity()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.organization_id is distinct from old.organization_id or new.user_id is distinct from old.user_id then
    raise exception 'jarvis_identity_immutable' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_jarvis_identity() from public,anon,authenticated;
create trigger jarvis_identity_immutable before update on public.jarvis_autopilot_settings
  for each row execute function private.guard_jarvis_identity();

-- Authenticated clients may create and edit only ordinary manual tasks.
-- Server-origin Jarvis tasks are FULLY server-owned, not just metadata:
-- prohibit forged completion, changed assignee, cancelled/rewritten origin,
-- or premature reruns through unrestricted direct PostgREST UPDATE.
create function private.guard_jarvis_task_origin()
returns trigger language plpgsql set search_path='' as $$
begin
  if current_user='authenticated' and (
    (tg_op='INSERT' and new.metadata->>'source'='jarvis_autopilot_server_v1')
    or (tg_op='UPDATE' and (
      new.metadata->>'source'='jarvis_autopilot_server_v1'
      or old.metadata->>'source'='jarvis_autopilot_server_v1'
    ))
  ) then raise exception 'jarvis_server_task_immutable' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_jarvis_task_origin() from public,anon,authenticated;
create trigger tasks_jarvis_origin before insert or update on public.tasks
  for each row execute function private.guard_jarvis_task_origin();

-- Service-role agent-chat persists assistant replies; an authenticated user
-- must never forge an assistant TASK marker through PostgREST.
create policy "jarvis clients only own user turns" on public.messages
  as restrictive for insert to authenticated
  with check (
    role='user'
    and exists (
      select 1 from public.conversations c
      where c.id=public.messages.conversation_id and c.organization_id=public.messages.organization_id
        and c.user_id=(select auth.uid()) and c.status='active'
    )
  );

-- A model reply is NOT a permission grant. The RPC trusts only the saved CEO
-- assistant message, exact tenant/user/agent and a previously opted-in member.
-- p_message is also the idempotent task PK (different table).
create function public.admit_jarvis_autopilot_task(
  p_org uuid,p_owner uuid,p_conversation uuid,p_message uuid,
  p_agent uuid,p_title text,p_details text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  setting public.jarvis_autopilot_settings%rowtype;
  employee public.agents%rowtype;
  company public.organizations%rowtype;
  assistant_text text;
  work public.tasks%rowtype;
  snippet text;
  inserted boolean := false;
  today_count bigint;
begin
  if p_org is null or p_owner is null or p_conversation is null or p_message is null or p_agent is null
    or p_title is null or length(p_title) not between 3 and 160 or p_title is distinct from btrim(p_title)
    or p_details is null or length(p_details)>1500 or p_details is distinct from btrim(p_details)
  then raise exception 'invalid_jarvis_handoff' using errcode='22023'; end if;

  -- Lock the user's grant to serialize concurrent daily quotas and revocation.
  select * into setting from public.jarvis_autopilot_settings
    where organization_id=p_org and user_id=p_owner for update;
  if not found or setting.enabled is distinct from true then
    raise exception 'jarvis_not_authorized' using errcode='42501';
  end if;
  perform 1 from public.organization_members
    where organization_id=p_org and user_id=p_owner
      and role in ('owner','admin','manager','member') for share;
  if not found then raise exception 'jarvis_not_authorized' using errcode='42501'; end if;

  select * into company from public.organizations where id=p_org;
  if not found or company.status<>'active' or company.plan not in ('free','pro','business','enterprise')
    or (company.plan<>'free' and coalesce(company.plan_status,'') not in ('active','trialing'))
  then raise exception 'jarvis_plan_inactive' using errcode='42501'; end if;
  select * into employee from public.agents
    where id=p_agent and organization_id=p_org and type<>'ceo';
  if not found or employee.enabled is distinct from true or employee.autonomy<>'auto' then
    raise exception 'jarvis_agent_not_auto' using errcode='42501';
  end if;

  -- Canonical premium-agent catalog, matched by base slug after a downgrade.
  if company.plan='free' and regexp_replace(employee.slug,'-[2-9][0-9]*$','') = any(array[
    'devops-engineer','security-auditor','code-reviewer','qa-engineer','product-manager',
    'ads-manager','influencer-outreach','pr-comms','brand-strategist','procurement',
    'inventory-planner','legal-reviewer','compliance-helper','tax-assistant',
    'financial-planner','invoice-collector','market-researcher','trend-scout',
    'ux-researcher','competitor-analyst','deep-research','site-watchdog',
    'knowledge-librarian','ai-cost-optimizer','ai-gateway-operator',
    'autonomous-coder','seo-specialist','email-marketer','hr-onboarding',
    'recruiter','community-manager'
  ]) then raise exception 'jarvis_premium_not_allowed' using errcode='42501'; end if;

  -- Exact identity: the conversation belongs to this user and was conducted
  -- with a real enabled CEO, never another company's employee or a user reply.
  select m.content into assistant_text from public.messages m
    join public.conversations c on c.id=m.conversation_id
      and c.organization_id=m.organization_id
    join public.agents leader on leader.id=c.agent_id and leader.organization_id=c.organization_id
    where c.id=p_conversation and c.organization_id=p_org and c.user_id=p_owner
      and c.status='active' and leader.type='ceo' and leader.enabled=true
      and m.id=p_message and m.role='assistant' and m.organization_id=p_org;
  if not found then raise exception 'jarvis_source_not_verified' using errcode='42501'; end if;
  snippet := '[[task:'||p_agent::text||']] '||p_title||
    case when p_details='' then '' else E'\n'||p_details end;
  if position(snippet in assistant_text)=0 then
    raise exception 'jarvis_source_not_verified' using errcode='42501';
  end if;

  -- Idempotent ACK recovery must precede quota; never reexecute or charge twice.
  select * into work from public.tasks where id=p_message for update;
  if found then
    if work.organization_id<>p_org or work.created_by is distinct from p_owner
      or work.assigned_agent_id is distinct from p_agent or work.title<>p_title
      or coalesce(work.description,'')<>p_details
      or work.metadata->>'source'<>'jarvis_autopilot_server_v1'
      or work.metadata->>'conversation_id'<>p_conversation::text
      or work.metadata->>'message_id'<>p_message::text
    then raise exception 'jarvis_task_conflict' using errcode='23505'; end if;
    return jsonb_build_object('task_id',work.id,'created',false,'status',work.status);
  end if;

  -- Even a breached Edge caller cannot exceed the owner's standing daily cap.
  select count(*) into today_count from public.tasks
    where organization_id=p_org and created_by=p_owner and created_at>=now()-interval '24 hours'
      and metadata->>'source'='jarvis_autopilot_server_v1';
  if today_count>=setting.max_daily_tasks then
    raise exception 'jarvis_daily_cap' using errcode='22023';
  end if;

  insert into public.tasks(id,organization_id,created_by,assigned_agent_id,title,description,
    priority,status,metadata)
  values(p_message,p_org,p_owner,p_agent,p_title,nullif(p_details,''),'normal','pending',
    jsonb_build_object('source','jarvis_autopilot_server_v1','conversation_id',p_conversation,
      'message_id',p_message,'dispatch_state','new'))
  on conflict (id) do nothing
  returning true into inserted;

  select * into work from public.tasks where id=p_message for update;
  if not found or work.organization_id<>p_org or work.created_by is distinct from p_owner
    or work.assigned_agent_id is distinct from p_agent or work.title<>p_title
    or coalesce(work.description,'')<>p_details or work.metadata->>'source'<>'jarvis_autopilot_server_v1'
    or work.metadata->>'conversation_id'<>p_conversation::text
    or work.metadata->>'message_id'<>p_message::text
  then raise exception 'jarvis_task_conflict' using errcode='23505'; end if;
  return jsonb_build_object('task_id',work.id,'created',coalesce(inserted,false),'status',work.status);
end $$;
revoke all on function public.admit_jarvis_autopilot_task(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.admit_jarvis_autopilot_task(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;

-- Each task is claimed for server dispatch at most once. If HTTP delivery is
-- ambiguous the claim REMAINS; never auto-replay a potentially billed action.
-- Workflow-runner uses its existing cron identity and existing agent-runner.
create function public.claim_due_jarvis_autopilot_tasks(p_limit integer default 3)
returns table(task_id uuid,organization_id uuid,created_by uuid)
language plpgsql security invoker set search_path='' as $$
begin
  if p_limit is null or p_limit<1 or p_limit>5 then
    raise exception 'bad_jarvis_batch' using errcode='22023';
  end if;
  return query
    with eligible as (
      select t.id from public.tasks t
        join public.jarvis_autopilot_settings s
          on s.organization_id=t.organization_id and s.user_id=t.created_by and s.enabled=true
        join public.organizations o on o.id=t.organization_id and o.status='active'
        join public.agents a on a.id=t.assigned_agent_id and a.organization_id=t.organization_id
          and a.enabled=true and a.autonomy='auto'
        join public.organization_members m on m.organization_id=t.organization_id and m.user_id=t.created_by
          and m.role in ('owner','admin','manager','member')
      where t.status='pending' and t.run_claim is null
        and t.metadata->>'source'='jarvis_autopilot_server_v1'
        and t.metadata->>'dispatch_state'='new'
        and o.plan in ('free','pro','business','enterprise')
        and (o.plan='free' or o.plan_status in ('active','trialing'))
      order by t.created_at,t.id for update of t skip locked limit p_limit
    )
    update public.tasks t
      set metadata=t.metadata||jsonb_build_object('dispatch_state','claimed',
        'dispatch_claimed_at',now(),'dispatch_claim_id',gen_random_uuid())
      from eligible e where t.id=e.id
      returning t.id,t.organization_id,t.created_by;
end $$;
revoke all on function public.claim_due_jarvis_autopilot_tasks(integer) from public,anon,authenticated;
grant execute on function public.claim_due_jarvis_autopilot_tasks(integer) to service_role;

commit;
