-- Applied live on 2026-10-05; recorded here so Git matches production history.
-- Revoke both PUBLIC and direct anon grants; preserve authenticated and server access.
revoke execute on function public.match_knowledge(uuid, text, vector, integer) from public;
revoke execute on function public.match_knowledge(uuid, text, vector, integer) from anon;
grant execute on function public.match_knowledge(uuid, text, vector, integer) to authenticated, service_role;
