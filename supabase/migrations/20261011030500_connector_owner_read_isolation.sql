-- FIRBO Stage 9 / Master #52: personal computer rows must be private to their authenticated owner.
-- Source-only, staged until explicit owner-approved DB rollout. SERVICE_ROLE remains the trusted runner path.
-- Existing broad policies leaked coworker device capabilities and job params/results to same-company managers.
-- Fail closed on unknown SELECT/ALL policies: PostgreSQL combines PERMISSIVE policies using OR.
BEGIN;

DO $rls_guard$
DECLARE extra text;
BEGIN
  SELECT string_agg(tablename || ':' || policyname, ', ' ORDER BY tablename, policyname)
    INTO extra
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename IN ('connector_devices', 'connector_jobs')
     AND cmd IN ('SELECT', 'ALL')
     AND policyname NOT IN (
       'managers read devices', 'managers read jobs',
       'connector_devices_owner_select', 'connector_jobs_owner_select'
     );
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'unreviewed_connector_read_policy: %', extra USING ERRCODE = '42501';
  END IF;
END
$rls_guard$;

ALTER TABLE public.connector_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers read devices" ON public.connector_devices;
DROP POLICY IF EXISTS "managers read jobs" ON public.connector_jobs;
DROP POLICY IF EXISTS connector_devices_owner_select ON public.connector_devices;
DROP POLICY IF EXISTS connector_jobs_owner_select ON public.connector_jobs;

-- No company-level manager bypass. Unassigned/legacy rows fail closed until explicitly reconciled.
CREATE POLICY connector_devices_owner_select ON public.connector_devices
  FOR SELECT TO authenticated
  USING (created_by = (SELECT auth.uid()) AND private.is_member(organization_id));

CREATE POLICY connector_jobs_owner_select ON public.connector_jobs
  FOR SELECT TO authenticated
  USING (
    created_by = (SELECT auth.uid())
    AND private.is_member(organization_id)
    AND EXISTS (
      SELECT 1 FROM public.connector_devices AS d
       WHERE d.id = connector_jobs.device_id
         AND d.organization_id = connector_jobs.organization_id
         AND d.created_by = (SELECT auth.uid())
    )
  );

COMMIT;
