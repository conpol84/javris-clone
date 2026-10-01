-- Default AI "employees" for every new organization, with least-privilege tool sets.
-- Tool names match OpenJarvis' ToolRegistry so the backend can enforce them.
create or replace function private.seed_default_agents(org uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  policy text := E'\n\nRules: never send emails/messages, modify code in production, or spend money without first queueing the action for human approval (queue_action). Cite sources. Be concise and report results as structured summaries.';
  a record;
  v_agent_id uuid;
  t text;
begin
  for a in
    select * from (values
      ('CEO Agent','ceo','ceo','Company command: reviews the whole business, creates tasks and delegates to specialist agents.',
        'You are the CEO/Orchestrator agent of this company. Break the user''s goals into tasks, delegate each to the right specialist agent, review their results, and report a consolidated summary with open decisions for the human.',
        array['think','memory_search','memory_retrieve','memory_store','knowledge_search','record_decision','agent_list','agent_spawn','agent_send','queue_action','db_query']),
      ('Research Agent','research','research','Web research, competitor intelligence and market analysis reports.',
        'You are the Research agent. Investigate the question thoroughly using the web, verify claims across sources, and produce a clear report with findings, evidence and links.',
        array['think','web_search','http_request','browser_navigate','browser_extract','pdf_extract','memory_search','memory_store','knowledge_search','file_write']),
      ('Sales Agent','sales','sales','Finds and qualifies leads, researches companies and drafts personalised outreach.',
        'You are the Sales agent. Identify and qualify leads that match the company''s ideal customer profile, research each company, and draft personalised outreach. You only DRAFT messages; sending always requires human approval.',
        array['think','web_search','browser_navigate','browser_extract','memory_search','memory_store','knowledge_search','channel_send','queue_action','calendar_search']),
      ('Marketing Agent','marketing','marketing','Content, campaigns, content calendar and competitor monitoring.',
        'You are the Marketing agent. Plan and draft content, campaigns and a content calendar aligned with the brand, and monitor competitors. Publishing always requires human approval.',
        array['think','web_search','browser_navigate','browser_extract','image_generate','memory_search','memory_store','knowledge_search','queue_action','file_write']),
      ('Operations Agent','operations','operations','Tasks, deadlines, reminders, workflows and internal reports.',
        'You are the Operations agent. Keep tasks, deadlines and workflows on track, prepare internal reports, and flag anything overdue or blocked.',
        array['think','calendar_search','calendar_upcoming','channel_list','channel_send','memory_search','memory_store','knowledge_search','db_query','queue_action']),
      ('Finance Agent','finance','finance','Revenue, expenses, invoices and monthly reports (read-only by default).',
        'You are the Finance agent. Analyse revenue, expenses and invoices, produce monthly reports and raise alerts on anomalies. You are read-only: never move money or change records.',
        array['think','calculator','db_query','file_read','pdf_extract','memory_search','knowledge_search','queue_action']),
      ('Developer Agent','developer','developer','GitHub issues, code analysis, PR review and deployment info.',
        'You are the Developer agent. Inspect code, analyse issues, review pull requests and report deployment status. Never push to protected branches or deploy to production without human approval.',
        array['think','file_read','git_status','git_diff','git_log','browser_navigate','http_request','memory_search','knowledge_search','queue_action'])
    ) as v(name, slug, type, description, prompt, tools)
  loop
    insert into public.agents (organization_id, name, slug, type, description, system_prompt)
    values (org, a.name, a.slug, a.type, a.description, a.prompt || policy)
    on conflict (organization_id, slug) do nothing
    returning id into v_agent_id;

    if v_agent_id is not null then
      foreach t in array a.tools loop
        insert into public.agent_tools (organization_id, agent_id, tool_name) values (org, v_agent_id, t)
        on conflict on constraint agent_tools_agent_id_tool_name_key do nothing;
      end loop;
    end if;
  end loop;
end $$;
revoke all on function private.seed_default_agents(uuid) from public, anon, authenticated;

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  org_id uuid;
begin
  if uid is null then
    raise exception 'authentication required' using errcode = '28000';
  end if;
  insert into public.organizations (name, slug) values (p_name, p_slug) returning id into org_id;
  insert into public.organization_members (organization_id, user_id, role) values (org_id, uid, 'owner');
  update public.profiles set default_organization_id = coalesce(default_organization_id, org_id) where id = uid;
  perform private.seed_default_agents(org_id);
  return org_id;
end $$;
