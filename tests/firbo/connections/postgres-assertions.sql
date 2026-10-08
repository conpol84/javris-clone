-- Each assertion throws on failure; real PostgreSQL privileges and transactions.
do $$begin
 if has_table_privilege('authenticated','public.firbo_connection_states','SELECT') then raise exception 'state_read_leak';end if;
 if has_table_privilege('anon','public.integration_secrets','SELECT') then raise exception 'secret_read_leak';end if;
 if has_function_privilege('authenticated','public.firbo_save_connection(uuid,uuid,text,text,jsonb,text,text)','EXECUTE') then raise exception 'rpc_open';end if;
end$$;
set role service_role;
insert into public.integrations(organization_id,kind,name) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','legacy_future_app','Keep me');
delete from public.integrations where kind='legacy_future_app';
do $$declare v_id uuid;blocked boolean=false;begin
 begin perform public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','traccar','Bad','{}','fake_token_value',null);exception when others then blocked=true;end;
 if not blocked then raise exception 'foreign_user_accepted';end if;
 v_id:=public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','traccar','Fleet','{}','fake_token_value',null);
 if not exists(select 1 from public.integration_secrets where integration_id=v_id) then raise exception 'secret_not_saved';end if;
 if not public.firbo_acquire_connection_refresh(v_id,'dddddddd-dddd-4ddd-8ddd-dddddddddddd') then raise exception 'lease_not_acquired';end if;
 if public.firbo_acquire_connection_refresh(v_id,'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee') then raise exception 'double_lease';end if;
 delete from public.integrations where public.integrations.id=v_id;
 if exists(select 1 from public.integration_secrets where integration_id=v_id) then raise exception 'orphan_secret';end if;
end$$;
insert into public.firbo_connection_states(state_hash,organization_id,user_id,kind,name,return_origin,verifier,status,expires_at)
values(repeat('a',64),'cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','youtube','YouTube','https://firbo.example.com','verifier','exchanging',now()+interval '10 minutes');
do $$declare v_id uuid;blocked boolean=false;begin
 v_id:=public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','youtube','YouTube','{}','fake_token_value',repeat('a',64));
 if not exists(select 1 from public.firbo_connection_states where state_hash=repeat('a',64) and status='completed' and verifier is null and integration_id=v_id) then raise exception 'state_not_finalized';end if;
 begin perform public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','youtube','Replay','{}','fake_token_value',repeat('a',64));exception when others then blocked=true;end;
 if not blocked then raise exception 'state_replay';end if;
 blocked=false;
 begin perform public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','quickbooks','No state','{}','fake_token_value',null);exception when others then blocked=true;end;
 if not blocked then raise exception 'missing_state';end if;
end$$;
select public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','traccar','Fleet','{}','fake_token_value',null);
do $$declare blocked boolean=false;begin
 begin perform public.firbo_save_connection('cccccccc-cccc-4ccc-8ccc-cccccccccccc','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','traccar','Over cap','{}','fake_token_value',null);exception when others then blocked=true;end;
 if not blocked then raise exception 'quota_overrun';end if;
 if (select count(*) from public.integrations)<>2 or (select count(*) from public.integration_secrets)<>2 then raise exception 'partial_or_quota_write';end if;
end$$;
reset role;
select 'FIRBO_CONNECTIONS_POSTGRES_ASSERTIONS_PASSED' as result;
