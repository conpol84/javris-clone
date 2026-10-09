-- SG-MEM-01 staged isolation assertions. Run in an isolated, disposable database.
-- Existing business production data MUST NOT be used for these fixtures.
BEGIN;
CREATE TEMP TABLE sgmem_fixture (
  organization text NOT NULL,
  owner_id text,
  reader_id text NOT NULL,
  reader_org text NOT NULL,
  reader_member boolean NOT NULL,
  is_visible boolean GENERATED ALWAYS AS (owner_id = reader_id AND reader_member AND organization = reader_org) STORED
);
INSERT INTO sgmem_fixture (organization, owner_id, reader_id, reader_org, reader_member) VALUES
 ('A','alice','alice','A',true),
 ('A','alice','bob','A',true),
 ('A',NULL,'alice','A',true),
 ('A','alice','alice','B',true),
 ('A','alice','alice','A',false),
 ('B','alice','alice','A',true),
 ('B','carol','carol','B',true);
DO $$
DECLARE seen boolean[];
BEGIN
 SELECT array_agg(is_visible ORDER BY ctid) INTO seen FROM sgmem_fixture;
 IF seen IS DISTINCT FROM ARRAY[true,false,false,false,false,false,true] THEN
   RAISE EXCEPTION 'SG-MEM-01 ownership visibility fixture failed: %', seen;
 END IF;
END $$;
ROLLBACK;

-- After candidate migration deployment in a separate environment, additionally:
-- 1. Run two real authenticated JWT clients in organization A and B.
-- 2. SELECT/INSERT/UPDATE/DELETE across owner, member, manager, admin.
-- 3. Verify organization_id reassignment is prohibited by a trusted DB invariant.
-- 4. Verify an owner cannot manufacture company-wide visibility with metadata alone.
-- 5. Verify service-role paths are scoped independently of RLS.
