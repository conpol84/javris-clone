-- Reconcile the hybrid knowledge-search function with the intended least-privilege ACL.
-- Supabase projects may carry a direct anon EXECUTE grant in addition to PUBLIC,
-- so revoke both explicitly and retain only signed-in users plus server-side service_role.

revoke execute on function public.match_knowledge(uuid, text, vector, integer) from public;
revoke execute on function public.match_knowledge(uuid, text, vector, integer) from anon;
grant execute on function public.match_knowledge(uuid, text, vector, integer) to authenticated, service_role;
