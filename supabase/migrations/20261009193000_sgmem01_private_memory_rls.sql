-- FIRBO SG-MEM-01 DRAFT: authenticated memory isolation. Not deployed.
-- Existing NULL owner records remain inaccessible to authenticated clients.
-- Service-role queries require independent user/organization checks.
-- Back up current policies and rehearse with two tenants before applying.
BEGIN;
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "members read" ON public.memories;
DROP POLICY IF EXISTS "writers insert" ON public.memories;
DROP POLICY IF EXISTS "writers update" ON public.memories;
DROP POLICY IF EXISTS "managers delete" ON public.memories;
CREATE POLICY "sgmem01 owner select" ON public.memories FOR SELECT TO authenticated
 USING (user_id = (SELECT auth.uid()) AND private.is_member(organization_id));
CREATE POLICY "sgmem01 owner insert" ON public.memories FOR INSERT TO authenticated
 WITH CHECK (user_id = (SELECT auth.uid())
   AND private.has_role(organization_id, ARRAY['owner','admin','manager','member']));
CREATE POLICY "sgmem01 owner update" ON public.memories FOR UPDATE TO authenticated
 USING (user_id = (SELECT auth.uid()) AND private.is_member(organization_id))
 WITH CHECK (user_id = (SELECT auth.uid())
   AND private.has_role(organization_id, ARRAY['owner','admin','manager','member']));
CREATE POLICY "sgmem01 owner delete" ON public.memories FOR DELETE TO authenticated
 USING (user_id = (SELECT auth.uid())
   AND private.has_role(organization_id, ARRAY['owner','admin','manager']));
COMMIT;
