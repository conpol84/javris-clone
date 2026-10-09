-- Covering indexes for composite (organization_id, x_id) foreign keys.
create index agent_tools_org_agent_idx on public.agent_tools (organization_id, agent_id);
create index approvals_org_agent_idx on public.approvals (organization_id, agent_id);
create index approvals_org_task_idx on public.approvals (organization_id, task_id);
create index audit_log_org_agent_idx on public.audit_log (organization_id, agent_id);
create index conversations_org_agent_idx on public.conversations (organization_id, agent_id);
create index knowledge_chunks_org_source_idx on public.knowledge_chunks (organization_id, source_id);
create index memories_org_agent_idx on public.memories (organization_id, agent_id);
create index messages_org_conversation_idx on public.messages (organization_id, conversation_id);
create index model_routes_org_agent_idx on public.model_routes (organization_id, agent_id);
create index tasks_org_agent_idx on public.tasks (organization_id, assigned_agent_id);
create index usage_events_org_agent_idx on public.usage_events (organization_id, agent_id);
create index workflow_steps_org_agent_idx on public.workflow_steps (organization_id, agent_id);
create index workflow_steps_org_workflow_idx on public.workflow_steps (organization_id, workflow_id);

-- Platform-provided event-trigger function must not be callable through the Data API.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;
