-- FIRBO SG-MEM-01 full PostgreSQL RLS behavioral acceptance.
-- Ephemeral test-only database. Never source production data.
\set ON_ERROR_STOP on
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
GRANT USAGE ON SCHEMA auth, private TO authenticated;
GRANT USAGE ON SCHEMA auth TO anon;
CREATE TABLE public.organization_members (
 organization_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL,
 PRIMARY KEY(organization_id,user_id)
);
CREATE TABLE public.memories (
 id uuid PRIMARY KEY,
 organization_id uuid NOT NULL,
 user_id uuid,
 content text NOT NULL
);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$fn$;
CREATE FUNCTION private.is_member(org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT exists (SELECT 1 FROM public.organization_members m WHERE m.organization_id=org AND m.user_id=(SELECT auth.uid()))
$fn$;
CREATE FUNCTION private.has_role(org uuid, roles text[]) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
 SELECT exists (SELECT 1 FROM public.organization_members m WHERE m.organization_id=org AND m.user_id=(SELECT auth.uid()) AND m.role=ANY(roles))
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
GRANT EXECUTE ON FUNCTION private.is_member(uuid),private.has_role(uuid,text[]) TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.memories TO authenticated;
GRANT SELECT ON public.memories TO anon;
INSERT INTO public.organization_members VALUES
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),
('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','member'),
('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','member'),
('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','admin');
INSERT INTO public.memories VALUES
('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','alice'),
('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','bob-a'),
('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001',NULL,'legacy-unowned'),
('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','carol'),
('30000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002','bob-b');
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members read" ON public.memories FOR SELECT TO authenticated USING (private.is_member(organization_id));
CREATE POLICY "writers insert" ON public.memories FOR INSERT TO authenticated WITH CHECK (private.has_role(organization_id,ARRAY['owner','admin','manager','member']));
CREATE POLICY "writers update" ON public.memories FOR UPDATE TO authenticated USING (private.has_role(organization_id,ARRAY['owner','admin','manager','member'])) WITH CHECK (private.has_role(organization_id,ARRAY['owner','admin','manager','member']));
CREATE POLICY "managers delete" ON public.memories FOR DELETE TO authenticated USING (private.has_role(organization_id,ARRAY['owner','admin','manager']));

-- Assert the vulnerable starting policy is accurately reproduced.
SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.memories) <> 3 THEN
  RAISE EXCEPTION 'pre-migration source policy differs from expected broad access';
 END IF;
END
$test$;
RESET ROLE;

-- Execute the REAL migration tracked by the PR, not an illustrative copy.
\ir ../../../supabase/migrations/20261009193000_sgmem01_private_memory_rls.sql
-- Simulate a second deploy/reconciliation; policies and trigger must remain valid.
\ir ../../../supabase/migrations/20261009193000_sgmem01_private_memory_rls.sql

-- No broad legacy policies or permissive catch-all policies may remain.
DO $test$
DECLARE names text[];
BEGIN
 SELECT array_agg(policyname ORDER BY policyname) INTO names
 FROM pg_policies WHERE schemaname='public' AND tablename='memories';
 IF names IS DISTINCT FROM ARRAY[
 'sgmem01 owner delete','sgmem01 owner insert',
 'sgmem01 owner select','sgmem01 owner update'] THEN
  RAISE EXCEPTION 'unexpected memory policies: %',names;
 END IF;
 IF (SELECT count(*) FROM public.memories WHERE user_id IS NULL) <> 1 THEN
  RAISE EXCEPTION 'legacy ownerless memory was lost';
 END IF;
END
$test$;

SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.memories) <> 1 THEN
  RAISE EXCEPTION 'Alice can access another user or legacy memory';
 END IF;
 IF (SELECT content FROM public.memories LIMIT 1) <> 'alice' THEN
  RAISE EXCEPTION 'Alice saw a foreign memory';
 END IF;
END
$test$;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
DO $test$
DECLARE denied boolean := false;
BEGIN
 IF (SELECT count(*) FROM public.memories) <> 2 THEN
  RAISE EXCEPTION 'Bob should see ONLY his own two-tenant memories';
 END IF;
 IF (SELECT count(*) FROM public.memories WHERE user_id IS NULL) <> 0 THEN
  RAISE EXCEPTION 'Bob can see legacy ownerless memory';
 END IF;
 UPDATE public.memories SET content='should-not-update' WHERE id='30000000-0000-0000-0000-000000000001';
 IF FOUND THEN RAISE EXCEPTION 'Bob updated Alice record'; END IF;
 BEGIN
  INSERT INTO public.memories VALUES
   ('30000000-0000-0000-0000-000000000009','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','spoofed');
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-user INSERT was allowed'; END IF;
 denied := false;
 BEGIN
  UPDATE public.memories SET organization_id='10000000-0000-0000-0000-000000000002'
  WHERE id='30000000-0000-0000-0000-000000000002';
 EXCEPTION WHEN insufficient_privilege THEN denied := true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'cross-tenant ownership transfer was allowed'; END IF;
 DELETE FROM public.memories WHERE id='30000000-0000-0000-0000-000000000002';
 IF FOUND THEN RAISE EXCEPTION 'member can DELETE despite managers-only policy'; END IF;
 UPDATE public.memories SET content='own-edit-allowed' WHERE id='30000000-0000-0000-0000-000000000002';
 IF NOT FOUND THEN RAISE EXCEPTION 'Bob cannot update own memory'; END IF;
END
$test$;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.memories) <> 1 THEN
  RAISE EXCEPTION 'Carol can see another user from own company';
 END IF;
END
$test$;
RESET ROLE;
SET ROLE anon;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.memories) <> 0 THEN
  RAISE EXCEPTION 'anon can see memory';
 END IF;
END
$test$;
RESET ROLE;
SELECT 'SG-MEM-01 live-RLS fixture PASS' AS verified;
