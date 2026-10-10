-- FIRBO CMEM-01: explicitly owner-reviewed company knowledge, separate from
-- personal memories and quarantined model-learned proposals.
-- Zero existing memory rows are modified, reassigned, or published by migration.
BEGIN;

CREATE TABLE public.company_memory_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_memory_id uuid REFERENCES public.memories(id) ON DELETE RESTRICT,
  content text NOT NULL CHECK (length(btrim(content)) BETWEEN 12 AND 1000),
  memory_type text NOT NULL CHECK (memory_type IN ('company','project','instruction','decision','fact')),
  importance numeric NOT NULL DEFAULT 0.7 CHECK (importance >= 0.1 AND importance <= 1),
  approved_by uuid NOT NULL REFERENCES auth.users(id),
  approved_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  CONSTRAINT publication_revoke_pair CHECK (
    (revoked_at IS NULL AND revoked_by IS NULL)
    OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
  )
);

CREATE INDEX company_memory_active_tenant_priority
 ON public.company_memory_publications(organization_id, importance DESC, approved_at DESC)
 WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX company_memory_active_source
 ON public.company_memory_publications(organization_id,source_memory_id)
 WHERE source_memory_id IS NOT NULL AND revoked_at IS NULL;

-- A service-role function must not cite a legacy proposal belonging to a
-- different tenant or one which was not explicitly tagged 'learned'.
-- Once approved, content, provenance and tenant cannot be edited in place.
-- Revocation is an explicit terminal, audited transition.
CREATE FUNCTION private.company_publication_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog,public
AS $guard$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.source_memory_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.memories m
       WHERE m.id=NEW.source_memory_id AND m.organization_id=NEW.organization_id
         AND m.user_id IS NULL AND m.metadata->>'source'='learned'
    ) THEN
      RAISE EXCEPTION 'unverified_or_foreign_memory_source' USING ERRCODE='23514';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.organization_id,NEW.source_memory_id,NEW.content,NEW.memory_type,
        NEW.importance,NEW.approved_by,NEW.approved_at)
      IS DISTINCT FROM
       (OLD.organization_id,OLD.source_memory_id,OLD.content,OLD.memory_type,
        OLD.importance,OLD.approved_by,OLD.approved_at)
      OR OLD.revoked_at IS NOT NULL
      OR NEW.revoked_at IS NULL OR NEW.revoked_by IS NULL THEN
      RAISE EXCEPTION 'approved_company_memory_immutable' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;
REVOKE ALL ON FUNCTION private.company_publication_guard() FROM PUBLIC;
CREATE TRIGGER company_publication_integrity
BEFORE INSERT OR UPDATE ON public.company_memory_publications
FOR EACH ROW EXECUTE FUNCTION private.company_publication_guard();

ALTER TABLE public.company_memory_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.company_memory_publications FROM PUBLIC,anon,authenticated;
GRANT SELECT ON TABLE public.company_memory_publications TO authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.company_memory_publications TO service_role;

CREATE POLICY "company approved read same tenant" ON public.company_memory_publications
 FOR SELECT TO authenticated
 USING (revoked_at IS NULL AND private.is_member(organization_id));

-- There are deliberately NO authenticated INSERT, UPDATE or DELETE policies.
-- Only server-validated owner/admin publishing via a JWT-checked Edge
-- function may write using service_role. Metadata alone grants no sharing.
COMMIT;
