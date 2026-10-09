-- Owner/admin diagnostic only. It never releases, settles or retries inference.
-- Keep privileged access private; the exposed RPC runs as the invoking role.
create function private.firbo_accounting_snapshot(
  p_org uuid, p_limit integer default 20, p_stale_minutes integer default 60
)
returns jsonb language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_month timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_result jsonb;
begin
  if v_user is null or not exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = v_user and role in ('owner','admin')
  ) then
    raise exception using errcode = '42501', message = 'accounting_snapshot_forbidden';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 200
     or p_stale_minutes is null or p_stale_minutes < 1 or p_stale_minutes > 10080 then
    raise exception using errcode = '22023', message = 'invalid_accounting_snapshot_bounds';
  end if;

  with scoped as (
    select id, source, status, reserved_usd, actual_usd, own_key, created_at, resolved_at
    from private.inference_requests
    where organization_id = p_org and (
      status in ('reserved','reconcile_required') or (
        status in ('settled','settled_overrun') and resolved_at >= v_month
        and resolved_at < v_month + interval '1 month'))
  ), pending as (
    select id as request_id, source, status, reserved_usd,
      greatest(0, floor(extract(epoch from now() - created_at)))::bigint as age_seconds,
      created_at
    from scoped where status in ('reserved','reconcile_required')
    order by created_at, id limit p_limit
  )
  select jsonb_build_object(
    'contract', 'firbo-accounting-snapshot/v1', 'organization_id', p_org,
    'observed_at', now(), 'month_start', v_month, 'read_only', true,
    'open_count', count(*) filter (where status in ('reserved','reconcile_required')),
    'reserved_count', count(*) filter (where status = 'reserved'),
    'reconcile_required_count', count(*) filter (where status = 'reconcile_required'),
    'potential_liability_usd', coalesce(sum(reserved_usd) filter
      (where status in ('reserved','reconcile_required')), 0),
    'stale_open_count', count(*) filter (where status in ('reserved','reconcile_required')
      and created_at <= now() - make_interval(mins => p_stale_minutes)),
    'stale_minutes', p_stale_minutes,
    'settled_month_count', count(*) filter (where status in ('settled','settled_overrun')),
    'platform_settled_month_usd', coalesce(sum(actual_usd) filter
      (where status in ('settled','settled_overrun') and not own_key), 0),
    'unknown_settled_cost_count', count(*) filter
      (where status in ('settled','settled_overrun') and actual_usd is null),
    'byok_settled_month_count', count(*) filter
      (where status in ('settled','settled_overrun') and own_key),
    'zero_cost_settled_month_count', count(*) filter
      (where status in ('settled','settled_overrun') and not own_key and actual_usd = 0),
    'overrun_month_count', count(*) filter (where status = 'settled_overrun'),
    'detail_limit', p_limit, 'details', coalesce((
      select jsonb_agg(jsonb_build_object(
        'request_id', request_id, 'source', source, 'status', status,
        'reserved_usd', reserved_usd, 'age_seconds', age_seconds
      ) order by created_at, request_id) from pending
    ), '[]'::jsonb)
  ) into v_result from scoped;
  return v_result;
end $$;

revoke all on function private.firbo_accounting_snapshot(uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function private.firbo_accounting_snapshot(uuid,integer,integer) to authenticated;

create function public.firbo_accounting_snapshot(
  p_org uuid, p_limit integer default 20, p_stale_minutes integer default 60
)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select private.firbo_accounting_snapshot(p_org, p_limit, p_stale_minutes) $$;
revoke all on function public.firbo_accounting_snapshot(uuid,integer,integer)
  from public, anon, authenticated, service_role;
grant execute on function public.firbo_accounting_snapshot(uuid,integer,integer) to authenticated;

comment on function public.firbo_accounting_snapshot(uuid,integer,integer) is
  'Read-only recorded inference snapshot for current company owner/admin; unresolved age is not expiry or permission to release.';
