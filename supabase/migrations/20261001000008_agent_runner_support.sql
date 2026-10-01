-- Agent runner (Edge Function) reads usage per agent per month / hour for budget and circuit-breaker checks.
create index if not exists usage_events_agent_created_idx on public.usage_events (agent_id, created_at desc);
