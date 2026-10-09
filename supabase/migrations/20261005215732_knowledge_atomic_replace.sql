-- Keyword passages and source readiness must change together. This RPC is only
-- callable by the server's service role after the Edge Function verifies the
-- actor's organization membership. It never accepts row organization/source IDs.
create or replace function public.replace_knowledge_chunks(
  p_org uuid, p_source uuid, p_actor uuid, p_chunks jsonb
) returns integer
language plpgsql security invoker set search_path = '' as $$
declare
  chunk jsonb;
  passage_count integer;
begin
  if p_org is null or p_source is null or jsonb_typeof(p_chunks) is distinct from 'array' then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  passage_count := jsonb_array_length(p_chunks);
  if passage_count < 1 or passage_count > 400 then
    raise exception 'invalid_chunks' using errcode = '22023';
  end if;
  for chunk in select value from jsonb_array_elements(p_chunks) loop
    if jsonb_typeof(chunk) is distinct from 'object'
      or jsonb_typeof(chunk->'title') is distinct from 'string'
      or char_length(chunk->>'title') > 200
      or jsonb_typeof(chunk->'content') is distinct from 'string'
      or char_length(btrim(chunk->>'content')) < 1
      or char_length(chunk->>'content') > 2000
      or jsonb_typeof(chunk->'chunk_index') is distinct from 'number'
      or (chunk->>'chunk_index') !~ '^[0-9]{1,3}$'
      or (chunk ? 'metadata' and jsonb_typeof(chunk->'metadata') is distinct from 'object')
      or (chunk ? 'url' and jsonb_typeof(chunk->'url') <> 'null' and (
        jsonb_typeof(chunk->'url') is distinct from 'string'
        or char_length(chunk->>'url') > 2000
        or (chunk->>'url') !~ '^https?://[^[:space:]]+$'
      )) then
      raise exception 'invalid_chunks' using errcode = '22023';
    end if;
    if (chunk->>'chunk_index')::integer > 399 then
      raise exception 'invalid_chunks' using errcode = '22023';
    end if;
  end loop;

  -- Replacement, deletion and other replacements contend on the same source.
  perform 1 from public.knowledge_sources
    where organization_id = p_org and id = p_source for update;
  if not found then
    raise exception 'source_not_found' using errcode = 'P0002';
  end if;
  -- Recheck the verified actor at commit time. FOR SHARE prevents a concurrent
  -- membership revocation from completing between this check and replacement.
  perform 1 from public.organization_members
    where organization_id = p_org and user_id = p_actor and role in ('owner','admin','manager') for share;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.knowledge_chunks where organization_id = p_org and source_id = p_source;
  insert into public.knowledge_chunks (organization_id, source_id, title, url, content, chunk_index, metadata)
    select p_org, p_source, value->>'title', value->>'url', value->>'content',
      (value->>'chunk_index')::integer, coalesce(value->'metadata', '{}'::jsonb)
    from jsonb_array_elements(p_chunks);
  update public.knowledge_sources
    set status = 'ready', item_count = passage_count, last_synced_at = now(), last_error = null, updated_at = now()
    where organization_id = p_org and id = p_source;
  return passage_count;
end $$;
revoke all on function public.replace_knowledge_chunks(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.replace_knowledge_chunks(uuid, uuid, uuid, jsonb) to service_role;
