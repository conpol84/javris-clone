-- Candidate only. No transport, provider, publication, or live consumer.
-- Must be applied after the current-row reader candidate in a reviewed release.
create or replace function public.mem0_canonical_revision(
  p_id uuid, p_organization_id uuid, p_agent_id uuid,
  p_content text, p_updated_at timestamptz, p_expires_at timestamptz
)
returns text
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  updated_iso text;
  expires_iso text;
  material text;
begin
  if p_id is null or p_organization_id is null or p_content is null
    or p_updated_at is null or not isfinite(p_updated_at)
    or extract(year from p_updated_at at time zone 'UTC') not between 1 and 9999
    or (p_expires_at is not null and (not isfinite(p_expires_at)
      or extract(year from p_expires_at at time zone 'UTC') not between 1 and 9999)) then
    raise exception using errcode = '22023', message = 'mem0_revision_invalid';
  end if;
  updated_iso := to_char(p_updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  expires_iso := case when p_expires_at is null then null else
    to_char(p_expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end;
  -- Each scalar is JSON-escaped by PostgreSQL; separators have no spaces,
  -- exactly matching JSON.stringify([id,org,agent,content,updated,expires]).
  material := '[' || to_json(p_id::text)::text || ',' || to_json(p_organization_id::text)::text
    || ',' || coalesce(to_json(p_agent_id::text)::text, 'null')
    || ',' || to_json(p_content)::text || ',' || to_json(updated_iso)::text
    || ',' || coalesce(to_json(expires_iso)::text, 'null') || ']';
  return encode(sha256(convert_to(material, 'UTF8')), 'hex');
end
$$;

create or replace function public.read_mem0_current_revisions(
  p_organization_id uuid, p_actor_user_id uuid, p_agent_id uuid, p_memory_ids uuid[]
)
returns table (id uuid, revision text)
language sql
volatile
security invoker
set search_path = ''
as $$
  select memory.id, public.mem0_canonical_revision(memory.id, memory.organization_id,
    memory.agent_id, memory.content, memory.updated_at, memory.expires_at)
  from public.read_mem0_current_rows(p_organization_id, p_actor_user_id, p_agent_id, p_memory_ids) memory
  -- Any non-null deletion marker is deleted, including empty strings/false.
  -- Match the retrieval boundary; no helper can widen an authoritative scope.
  where memory.metadata -> 'deleted_at' is null or memory.metadata -> 'deleted_at' = 'null'::jsonb;
$$;

revoke all on function public.mem0_canonical_revision(uuid,uuid,uuid,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.read_mem0_current_revisions(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
grant execute on function public.mem0_canonical_revision(uuid,uuid,uuid,text,timestamptz,timestamptz) to service_role;
grant execute on function public.read_mem0_current_revisions(uuid,uuid,uuid,uuid[]) to service_role;
