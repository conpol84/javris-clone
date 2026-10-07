-- Default-disabled Mem0 preparation: authoritative current-row reader.
-- This RPC is deliberately service-role only and does not publish, embed, or
-- contact a Mem0/vector/provider service.

create or replace function public.read_mem0_current_rows(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_agent_id uuid,
  p_memory_ids uuid[]
)
returns table (
  id uuid,
  organization_id uuid,
  agent_id uuid,
  content text,
  updated_at timestamptz,
  expires_at timestamptz,
  metadata jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  requested_count integer;
begin
  if p_organization_id is null or p_actor_user_id is null or p_agent_id is null then
    raise exception using errcode = '22023', message = 'mem0_reader_scope_required';
  end if;

  requested_count := coalesce(cardinality(p_memory_ids), 0);
  if requested_count < 1 or requested_count > 64 then
    raise exception using errcode = '22023', message = 'mem0_reader_invalid_count';
  end if;

  if exists (select 1 from unnest(p_memory_ids) as requested(id) where requested.id is null)
     or (select count(distinct requested.id) from unnest(p_memory_ids) as requested(id)) <> requested_count then
    raise exception using errcode = '22023', message = 'mem0_reader_invalid_ids';
  end if;

  -- The row locks make membership revocation and agent disablement wait until
  -- this transaction has finished consuming the authoritative snapshot.
  perform 1
  from public.organization_members membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_actor_user_id
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'mem0_reader_forbidden';
  end if;

  perform 1
  from public.agents agent
  where agent.organization_id = p_organization_id
    and agent.id = p_agent_id
    and agent.enabled
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'mem0_reader_agent_unavailable';
  end if;

  return query
  select
    memory.id,
    memory.organization_id,
    memory.agent_id,
    memory.content,
    memory.updated_at,
    memory.expires_at,
    memory.metadata
  from unnest(p_memory_ids) with ordinality as requested(id, ordinal)
  join public.memories memory on memory.id = requested.id
  where memory.organization_id = p_organization_id
    and (memory.agent_id is null or memory.agent_id = p_agent_id)
    and (memory.expires_at is null or memory.expires_at > statement_timestamp())
    and nullif(btrim(memory.metadata ->> 'deleted_at'), '') is null
    and char_length(btrim(memory.content)) between 1 and 4000
  order by requested.ordinal
  for share of memory;
end
$$;

revoke all on function public.read_mem0_current_rows(uuid, uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.read_mem0_current_rows(uuid, uuid, uuid, uuid[]) to service_role;
