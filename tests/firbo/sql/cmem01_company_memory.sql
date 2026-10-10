\set ON_ERROR_STOP on
-- Standalone disposable PostgreSQL fixture; never uses production data.
CREATE SCHEMA auth;
CREATE SCHEMA private;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$fn$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.organizations(id uuid PRIMARY KEY);
CREATE TABLE public.organization_members(organization_id uuid,user_id uuid,role text,
 PRIMARY KEY(organization_id,user_id));
CREATE TABLE public.memories(id uuid PRIMARY KEY,organization_id uuid,user_id uuid,metadata jsonb);
CREATE FUNCTION private.is_member(p_org uuid) RETURNS boolean LANGUAGE sql STABLE
 SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.organization_members m WHERE m.organization_id=p_org
 AND m.user_id=(SELECT auth.uid()))
$fn$;
GRANT USAGE ON SCHEMA public,auth,private TO authenticated,anon;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon;
GRANT EXECUTE ON FUNCTION private.is_member(uuid) TO authenticated,anon;
INSERT INTO auth.users VALUES
 ('20000000-0000-0000-0000-000000000001'),
 ('20000000-0000-0000-0000-000000000002'),
 ('20000000-0000-0000-0000-000000000003');
INSERT INTO public.organizations VALUES
 ('10000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.organization_members VALUES
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','owner'),
 ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','member'),
 ('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','owner');
INSERT INTO public.memories VALUES
 ('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',null,'{"source":"learned"}'),
 ('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002',null,'{"source":"learned"}'),
 ('30000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','{"source":"manual"}');
\ir ../../../supabase/migrations/20261010011500_company_memory_owner_review.sql

-- Owner-reviewed publication works and records immutable provenance.
INSERT INTO public.company_memory_publications
(organization_id,source_memory_id,content,memory_type,importance,approved_by)
VALUES ('10000000-0000-0000-0000-000000000001',
'30000000-0000-0000-0000-000000000001',
'Owner reviewed the product launch date against evidence.','decision',0.9,
'20000000-0000-0000-0000-000000000001');
DO $test$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.company_memory_publications
  (organization_id,source_memory_id,content,memory_type,approved_by)
  VALUES ('10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000002',
   'Attempted foreign organization publication.','fact',
   '20000000-0000-0000-0000-000000000001');
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'foreign source published'; END IF;
 denied:=false;
 BEGIN
  INSERT INTO public.company_memory_publications
  (organization_id,source_memory_id,content,memory_type,approved_by)
  VALUES ('10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000003',
   'Attempted another users manual note publication.','fact',
   '20000000-0000-0000-0000-000000000001');
 EXCEPTION WHEN check_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'private note auto-published'; END IF;
END
$test$;
DO $test$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  INSERT INTO public.company_memory_publications
   (organization_id,source_memory_id,content,memory_type,approved_by)
  VALUES ('10000000-0000-0000-0000-000000000001',
   '30000000-0000-0000-0000-000000000001',
   'Duplicate publication prohibited for one source.','fact',
   '20000000-0000-0000-0000-000000000001');
 EXCEPTION WHEN unique_violation THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'duplicate promotion'; END IF;
END
$test$;

SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
DO $test$
DECLARE denied boolean:=false;
BEGIN
 IF (SELECT count(*) FROM public.company_memory_publications) <> 1 THEN
  RAISE EXCEPTION 'member could not read approved company memory'; END IF;
 BEGIN
  INSERT INTO public.company_memory_publications
   (organization_id,content,memory_type,approved_by)
  VALUES ('10000000-0000-0000-0000-000000000001','Unauthorized publication.','fact',
   '20000000-0000-0000-0000-000000000002');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'member can self-approve'; END IF;
 denied:=false;
 BEGIN
  UPDATE public.company_memory_publications SET content='Tampered'
   WHERE organization_id='10000000-0000-0000-0000-000000000001';
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'member can edit published memory'; END IF;
END
$test$;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.company_memory_publications) <> 0 THEN
  RAISE EXCEPTION 'cross-company read leaked'; END IF;
END
$test$;
RESET ROLE;
SET ROLE anon;
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.company_memory_publications) <> 0 THEN
  RAISE EXCEPTION 'anonymous data leak'; END IF;
END
$test$;
RESET ROLE;
UPDATE public.company_memory_publications
 SET revoked_at=now(),revoked_by='20000000-0000-0000-0000-000000000001'
 WHERE organization_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SET request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
DO $test$
BEGIN
 IF (SELECT count(*) FROM public.company_memory_publications) <> 0 THEN
  RAISE EXCEPTION 'revoked fact remains visible'; END IF;
END
$test$;
RESET ROLE;
DO $test$
DECLARE denied boolean:=false;
BEGIN
 BEGIN
  UPDATE public.company_memory_publications SET content='Mutated after revoke'
   WHERE organization_id='10000000-0000-0000-0000-000000000001';
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'revoked publication mutated'; END IF;
 IF (SELECT count(*) FROM public.memories)<>3 THEN
  RAISE EXCEPTION 'original private or learned records were lost'; END IF;
END
$test$;
SELECT 'CMEM-01 tenant, immutable approval, revocation and source guard PASS' AS result;
