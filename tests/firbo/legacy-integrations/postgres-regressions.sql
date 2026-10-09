-- Real PostgreSQL guarantees: RPC grants, atomic rollback, role/quota checks and cascade.
-- Run after postgres-fixture.sql, the original integrations migration and the new RPC migration.
begin;
grant usage on schema public, auth to service_role;
grant all on all tables in schema public, auth to service_role;
do $$ begin
  if has_function_privilege('anon', 'public.firbo_save_legacy_integration(uuid,uuid,text,text,jsonb,text)', 'execute')
     or has_function_privilege('authenticated', 'public.firbo_save_legacy_integration(uuid,uuid,text,text,jsonb,text)', 'execute') then
    raise exception 'Browser roles can execute service-only persistence';
  end if;
end $$;

create function public.synthetic_reject_secret() returns trigger language plpgsql as $$ begin
  if new.secret::jsonb ? 'reject' then raise exception 'synthetic_secret_failure'; end if;
  return new;
end $$;
create trigger synthetic_secret_failure before insert on public.integration_secrets
  for each row execute function public.synthetic_reject_secret();

set local role service_role;
do $$ declare saved jsonb; before_count integer; message text; begin
  saved := public.firbo_save_legacy_integration(
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'webhook', 'Synthetic connection', '{"host":"synthetic.example.test"}', '{"token":"synthetic-token"}'
  );
  if saved->>'status' <> 'active' or saved ? 'secret'
     or not exists (select 1 from public.integration_secrets where integration_id = (saved->>'id')::uuid) then
    raise exception 'Successful persistence did not commit both records safely';
  end if;
  select count(*) into before_count from public.integrations;
  begin
    perform public.firbo_save_legacy_integration(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      'webhook', 'Rejected secret', '{}', '{"reject":"synthetic"}'
    );
    raise exception 'Expected secret write failure';
  exception when others then
    get stacked diagnostics message = message_text;
    if message <> 'synthetic_secret_failure' then raise; end if;
  end;
  if (select count(*) from public.integrations) <> before_count
     or (select count(*) from public.integration_secrets) <> before_count then
    raise exception 'Failed credentials persistence left an orphan';
  end if;
  begin
    perform public.firbo_save_legacy_integration(
      '11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444',
      'webhook', 'Viewer attempt', '{}', '{"token":"synthetic-token"}'
    );
    raise exception 'Expected forbidden';
  exception when others then
    get stacked diagnostics message = message_text;
    if message <> 'forbidden' then raise; end if;
  end;
  begin
    perform public.firbo_save_legacy_integration(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      'youtube', 'Reserved adapter', '{}', '{"token":"synthetic-token"}'
    );
    raise exception 'Expected bad_kind';
  exception when others then
    get stacked diagnostics message = message_text;
    if message <> 'bad_kind' then raise; end if;
  end;
  perform public.firbo_save_legacy_integration(
    '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
    'webhook', 'Second connection', '{}', '{"token":"synthetic-token"}'
  );
  begin
    perform public.firbo_save_legacy_integration(
      '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
      'webhook', 'Over quota', '{}', '{"token":"synthetic-token"}'
    );
    raise exception 'Expected plan_limit';
  exception when others then
    get stacked diagnostics message = message_text;
    if message <> 'plan_limit' then raise; end if;
  end;
  delete from public.integrations where id = (saved->>'id')::uuid;
  if exists(select 1 from public.integration_secrets where integration_id = (saved->>'id')::uuid) then
    raise exception 'Disconnect left credentials behind';
  end if;
end $$;
reset role;
rollback;
