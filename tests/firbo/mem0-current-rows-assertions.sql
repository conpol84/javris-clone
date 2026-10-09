\set ON_ERROR_STOP on

do $$
begin
  if has_function_privilege('anon', 'public.read_mem0_current_rows(uuid,uuid,uuid,uuid[])', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.read_mem0_current_rows(uuid,uuid,uuid,uuid[])', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.read_mem0_current_rows(uuid,uuid,uuid,uuid[])', 'EXECUTE') then
    raise exception 'unexpected execute grants';
  end if;
end
$$;

set role service_role;

do $$
declare
  rows_seen text[];
begin
  select array_agg(row.content order by row.ordinal)
  into rows_seen
  from (
    select result.content, row_number() over () as ordinal
    from public.read_mem0_current_rows(
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000301',
      array[
        '00000000-0000-0000-0000-000000000402'::uuid,
        '00000000-0000-0000-0000-000000000401'::uuid,
        '00000000-0000-0000-0000-000000000403'::uuid,
        '00000000-0000-0000-0000-000000000404'::uuid,
        '00000000-0000-0000-0000-000000000405'::uuid,
        '00000000-0000-0000-0000-000000000406'::uuid
      ]
    ) result
  ) row;
  if rows_seen is distinct from array['agent-current', 'company-current']::text[] then
    raise exception 'scope/filter/order mismatch: %', rows_seen;
  end if;
end
$$;

do $$
begin
  perform * from public.read_mem0_current_rows(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000102',
    '00000000-0000-0000-0000-000000000301',
    array['00000000-0000-0000-0000-000000000401'::uuid]
  );
  raise exception 'foreign actor unexpectedly accepted';
exception when insufficient_privilege then
  if sqlerrm <> 'mem0_reader_forbidden' then raise; end if;
end
$$;

do $$
begin
  perform * from public.read_mem0_current_rows(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000304',
    array['00000000-0000-0000-0000-000000000401'::uuid]
  );
  raise exception 'disabled agent unexpectedly accepted';
exception when no_data_found then
  if sqlerrm <> 'mem0_reader_agent_unavailable' then raise; end if;
end
$$;

do $$
begin
  perform * from public.read_mem0_current_rows(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000301',
    array[]::uuid[]
  );
  raise exception 'empty list unexpectedly accepted';
exception when invalid_parameter_value then
  if sqlerrm <> 'mem0_reader_invalid_count' then raise; end if;
end
$$;

do $$
begin
  perform * from public.read_mem0_current_rows(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000301',
    array[
      '00000000-0000-0000-0000-000000000401'::uuid,
      '00000000-0000-0000-0000-000000000401'::uuid
    ]
  );
  raise exception 'duplicate list unexpectedly accepted';
exception when invalid_parameter_value then
  if sqlerrm <> 'mem0_reader_invalid_ids' then raise; end if;
end
$$;

reset role;
set role authenticated;
do $$
begin
  perform * from public.read_mem0_current_rows(
    '00000000-0000-0000-0000-000000000201',
    '00000000-0000-0000-0000-000000000101',
    '00000000-0000-0000-0000-000000000301',
    array['00000000-0000-0000-0000-000000000401'::uuid]
  );
  raise exception 'authenticated unexpectedly executed RPC';
exception when insufficient_privilege then null;
end
$$;
reset role;

select 'mem0 current-row reader assertions passed' as result;
