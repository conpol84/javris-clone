-- Production performance hardening from the live Supabase advisors.
-- Additive indexes only; policy rewrites preserve the existing authorization
-- predicates while evaluating auth.uid() once per statement instead of per row.

create index if not exists knowledge_sources_created_by_idx
  on public.knowledge_sources(created_by);
create index if not exists knowledge_sources_integration_id_idx
  on public.knowledge_sources(integration_id);
create index if not exists org_provider_keys_created_by_idx
  on public.org_provider_keys(created_by);
create index if not exists report_feedback_organization_id_idx
  on public.report_feedback(organization_id);
create index if not exists report_feedback_user_id_idx
  on public.report_feedback(user_id);
create index if not exists skills_agent_id_idx
  on public.skills(agent_id);
create index if not exists skills_organization_agent_idx
  on public.skills(organization_id, agent_id);
create index if not exists skills_created_by_idx
  on public.skills(created_by);
create index if not exists workflow_runs_started_by_idx
  on public.workflow_runs(started_by);
create index if not exists workflow_runs_task_id_idx
  on public.workflow_runs(task_id);
create index if not exists workflow_runs_workflow_id_idx
  on public.workflow_runs(workflow_id);
create index if not exists workflows_created_by_idx
  on public.workflows(created_by);

drop policy if exists "writers delete own" on public.report_feedback;
create policy "writers delete own" on public.report_feedback
  for delete using (user_id = (select auth.uid()));

drop policy if exists "writers insert own" on public.report_feedback;
create policy "writers insert own" on public.report_feedback
  for insert with check (
    user_id = (select auth.uid())
    and private.has_role(organization_id, array['owner','admin','manager','member']::text[])
  );

drop policy if exists "writers update own" on public.report_feedback;
create policy "writers update own" on public.report_feedback
  for update
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and private.has_role(organization_id, array['owner','admin','manager','member']::text[])
  );
