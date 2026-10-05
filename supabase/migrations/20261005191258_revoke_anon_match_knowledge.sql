-- Applied live on 2026-10-05; recorded here so Git matches the production migration history.
-- Company knowledge search is for signed-in members and the server only, never anonymous callers.
revoke execute on function public.match_knowledge(uuid, text, vector, integer) from public;
revoke execute on function public.match_knowledge(uuid, text, vector, integer) from anon;
grant execute on function public.match_knowledge(uuid, text, vector, integer) to authenticated, service_role;
