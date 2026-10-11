-- FIRBO Master #52 owner/computer privacy real PostgreSQL acceptance.
-- Runs only in an ISOLATED disposable GitHub CI PostgreSQL, never against user production.
\set ON_ERROR_STOP on

CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, auth, private TO authenticated, anon, service_role;

CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $fn$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$fn$;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;

CREATE TABLE private.fixture_members (
  organization_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL,
  PRIMARY KEY (organization_id, user_id)
);
INSERT INTO private.fixture_members VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','member'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','manager'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004','owner');

CREATE FUNCTION private.is_member(p_org uuid) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM private.fixture_members m
    WHERE m.organization_id = p_org AND m.user_id = auth.uid()
  )
$fn$;
CREATE FUNCTION private.has_role(p_org uuid, p_roles text[]) RETURNS boolean
LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM private.fixture_members m
    WHERE m.organization_id = p_org AND m.user_id = auth.uid()
      AND m.role = ANY(p_roles)
  )
$fn$;
GRANT SELECT ON private.fixture_members TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_member(uuid), private.has_role(uuid,text[]) TO authenticated;

CREATE TABLE public.connector_devices (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, created_by uuid,
  paired boolean NOT NULL DEFAULT true
);
CREATE TABLE public.connector_jobs (
  id uuid PRIMARY KEY, organization_id uuid NOT NULL, device_id uuid NOT NULL REFERENCES public.connector_devices(id),
  created_by uuid, params jsonb DEFAULT '{}'::jsonb, result jsonb
);
ALTER TABLE public.connector_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.connector_devices, public.connector_jobs TO authenticated, anon, service_role;

-- Reproduce the real broad manager policies observed read-only on the FIRBO database.
CREATE POLICY "managers read devices" ON public.connector_devices
 FOR SELECT TO authenticated
 USING (private.has_role(organization_id, ARRAY['owner','admin','manager']::text[]));
CREATE POLICY "managers read jobs" ON public.connector_jobs
 FOR SELECT TO authenticated
 USING (private.has_role(organization_id, ARRAY['owner','admin','manager']::text[]));

INSERT INTO public.connector_devices (id,organization_id,created_by) VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000004'),
 ('30000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001',NULL);
INSERT INTO public.connector_jobs (id,organization_id,device_id,created_by) VALUES
 ('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
 ('40000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),
 ('40000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000004'),
 ('40000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004',NULL),
 -- A spoofed creator on someone else's actual device must not become visible.
 ('40000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001');

SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000003';
DO $old$
BEGIN
  IF (SELECT count(*) FROM public.connector_devices) <> 3 OR
     (SELECT count(*) FROM public.connector_jobs) <> 4 THEN
    RAISE EXCEPTION 'fixture did not reproduce the existing same-company manager leak';
  END IF;
END $old$;
RESET ROLE;

-- Run the exact migration twice for idempotent release/read-back behavior.
\ir ../../../supabase/migrations/20261011030500_connector_owner_read_isolation.sql
\ir ../../../supabase/migrations/20261011030500_connector_owner_read_isolation.sql

DO $policy$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='public'
        AND tablename IN ('connector_devices','connector_jobs')
        AND cmd IN ('SELECT','ALL')) <> 2 THEN
    RAISE EXCEPTION 'unexpected SELECT/ALL policy count';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
        AND tablename='connector_devices' AND policyname='connector_devices_owner_select')
    OR NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
        AND tablename='connector_jobs' AND policyname='connector_jobs_owner_select') THEN
    RAISE EXCEPTION 'owner-only policies missing after migration';
  END IF;
END $policy$;

SET ROLE authenticated;
SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000001';
DO $alice$
BEGIN
  IF (SELECT count(*) FROM public.connector_devices) <> 1 OR
     (SELECT count(*) FROM public.connector_jobs) <> 1 THEN
    RAISE EXCEPTION 'Alice saw coworker/legacy/mismatched device or job';
  END IF;
END $alice$;

SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000002';
DO $bob$
BEGIN
  IF (SELECT count(*) FROM public.connector_devices) <> 1 OR
     (SELECT count(*) FROM public.connector_jobs) <> 1 THEN
    RAISE EXCEPTION 'Bob cannot see exact owned device/job or sees another owner';
  END IF;
END $bob$;

SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000003';
DO $manager$
BEGIN
  IF EXISTS (SELECT 1 FROM public.connector_devices) OR
     EXISTS (SELECT 1 FROM public.connector_jobs) THEN
    RAISE EXCEPTION 'company manager can still read coworker computer or job';
  END IF;
END $manager$;

SET request.jwt.claim.sub = '20000000-0000-0000-0000-000000000004';
DO $carol$
BEGIN
  IF (SELECT count(*) FROM public.connector_devices) <> 1 OR
     (SELECT count(*) FROM public.connector_jobs) <> 1 THEN
    RAISE EXCEPTION 'second company owner leaked or lost rows';
  END IF;
END $carol$;
RESET ROLE;

SET ROLE anon;
DO $anon$
BEGIN
  IF EXISTS (SELECT 1 FROM public.connector_devices) OR
     EXISTS (SELECT 1 FROM public.connector_jobs) THEN
    RAISE EXCEPTION 'anonymous user can read private connector rows';
  END IF;
END $anon$;
RESET ROLE;

SET ROLE service_role;
DO $service$
BEGIN
  IF (SELECT count(*) FROM public.connector_devices) <> 4 OR
     (SELECT count(*) FROM public.connector_jobs) <> 5 THEN
    RAISE EXCEPTION 'trusted service-role execution path was broken';
  END IF;
END $service$;
RESET ROLE;

SELECT 'FIRBO owner-only connector RLS real PostgreSQL PASS' AS acceptance;
