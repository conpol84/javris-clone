-- Run after postgres-fixture.sql and the real atomic-replace migration in a
-- disposable database. All assertions and fault injection roll back together.
begin;
create temp table knowledge_results(name text primary key,passed boolean);
insert into public.organization_members(organization_id,user_id,role) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','manager');
insert into public.knowledge_sources(id,organization_id,status,item_count,last_synced_at,metadata) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','ready',1,'2026-01-01T00:00:00Z','{"preserve":"source metadata"}'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd','ready',1,'2026-01-01T00:00:00Z','{}');
insert into public.knowledge_chunks(organization_id,source_id,title,content,vec) values
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Original','Original searchable passage','original-vector-sentinel'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Other company','Other-company passage','other-vector');

create function public.knowledge_test_insert_failure() returns trigger language plpgsql as $$ begin
 if new.content='SYNTHETIC_INSERT_FAILURE' then raise exception 'synthetic insert failure'; end if;
 return new;
end $$;
create trigger knowledge_test_insert_failure before insert on public.knowledge_chunks
 for each row execute function public.knowledge_test_insert_failure();
create function public.knowledge_test_status_failure() returns trigger language plpgsql as $$ begin
 if old.metadata->>'inject_status_failure'='true' and new.status='ready' then raise exception 'synthetic status failure'; end if;
 return new;
end $$;
create trigger knowledge_test_status_failure before update on public.knowledge_sources
 for each row execute function public.knowledge_test_status_failure();

do $$ begin
 begin
  perform public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '[{"title":"New","content":"SYNTHETIC_INSERT_FAILURE","chunk_index":0}]');
  raise exception 'insert failure was unexpectedly ignored';
 exception when raise_exception then if sqlerrm is distinct from 'synthetic insert failure' then raise; end if; end;
 if (select content from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'Original searchable passage'
  or (select vec from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'original-vector-sentinel'
  or (select count(*) from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 1
  or (select item_count from public.knowledge_sources where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 1
  or (select last_synced_at from public.knowledge_sources where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from '2026-01-01T00:00:00Z'::timestamptz
 then raise exception 'failed replacement lost old material or metadata'; end if;
 insert into knowledge_results values('failed insert preserves previous chunks/vectors/readiness',true);
 begin
  perform public.replace_knowledge_chunks('dddddddd-dddd-4ddd-8ddd-dddddddddddd','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '[{"title":"New","content":"Foreign scope","chunk_index":0}]');
  raise exception 'cross-company source accepted';
 exception when no_data_found then if sqlerrm is distinct from 'source_not_found' then raise; end if; end;
 insert into knowledge_results values('cross-company source rejected',true);
 begin
  perform public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','[]');
  raise exception 'empty replacement unexpectedly succeeded';
 exception when invalid_parameter_value then null; end;
 begin
  perform public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '[{"title":"New","content":false,"chunk_index":0}]');
  raise exception 'malformed replacement unexpectedly succeeded';
 exception when invalid_parameter_value then null; end;
 insert into knowledge_results values('empty/malformed replacements rejected before deletion',true);
end $$;
update public.knowledge_sources set metadata=metadata||'{"inject_status_failure":true}',status='indexing' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
 begin
  perform public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '[{"title":"New","content":"Valid new passage","chunk_index":0}]');
  raise exception 'status failure was unexpectedly ignored';
 exception when raise_exception then if sqlerrm is distinct from 'synthetic status failure' then raise; end if; end;
 if (select content from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'Original searchable passage'
  or (select item_count from public.knowledge_sources where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 1
 then raise exception 'failed metadata update was not atomic'; end if;
 insert into knowledge_results values('failed ready metadata rolls back chunk replacement',true);
end $$;
update public.knowledge_sources set metadata=metadata-'inject_status_failure' where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
update public.organization_members set role='viewer' where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
do $$ begin
 begin
  perform public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '[{"title":"Denied","content":"Role was revoked","chunk_index":0}]');
  raise exception 'revoked actor published new material';
 exception when insufficient_privilege then if sqlerrm is distinct from 'forbidden' then raise; end if; end;
 if (select content from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'Original searchable passage' then raise exception 'revoked actor changed material'; end if;
 insert into knowledge_results values('commit-time revoked manager rejected without replacement',true);
end $$;
update public.organization_members set role='manager' where user_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

set local role authenticated;
do $$ begin
 begin
  perform public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
   '[{"title":"Bad","content":"Unauthorized","chunk_index":0}]');
  raise exception 'authenticated caller unexpectedly admitted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.replace_knowledge_chunks(uuid,uuid,uuid,jsonb)','execute')
  or has_function_privilege('authenticated','public.replace_knowledge_chunks(uuid,uuid,uuid,jsonb)','execute')
 then raise exception 'server-only RPC exposed'; end if;
 insert into knowledge_results values('anon/authenticated cannot invoke replacement RPC',true);
end $$;
set local role service_role;
select public.replace_knowledge_chunks('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
 '[{"title":"New one","url":"https://synthetic.example.test","content":"First replacement","chunk_index":0,"metadata":{"keep":true}},{"title":"New two","content":"Second replacement","chunk_index":1}]');
reset role;
do $$ begin
 if (select count(*) from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 2
  or (select count(*) from public.knowledge_chunks where source_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc' and content='Other-company passage') is distinct from 1
  or (select item_count from public.knowledge_sources where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 2
  or (select status from public.knowledge_sources where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from 'ready'
  or (select metadata from public.knowledge_sources where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') is distinct from '{"preserve":"source metadata"}'::jsonb
 then raise exception 'successful replacement has wrong scope or metadata'; end if;
 insert into knowledge_results values('service replacement updates passages/count/status atomically',true);
 insert into knowledge_results values('source metadata and other-company chunks preserved',true);
end $$;
delete from public.knowledge_sources where organization_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
do $$ begin
 if exists(select 1 from public.knowledge_chunks where source_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then raise exception 'source FK cascade missing'; end if;
 insert into knowledge_results values('source deletion cascades passages together',true);
end $$;
select name,passed from knowledge_results order by name;
rollback;
