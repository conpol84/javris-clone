#!/usr/bin/env python3
"""Operator-only, organization-scoped ledger snapshot. Never repairs or releases.

Use an existing authorized database operator connection through standard libpq
PG* environment/pgpass settings. No DSN, key or password is accepted in argv.
This is not an authenticated web endpoint and grants no database privileges.
"""

import argparse
import json
import subprocess
import sys
import uuid


def query(organization: str, limit: int = 100, stale_minutes: int = 60) -> str:
    org = str(uuid.UUID(organization))
    if not 1 <= limit <= 200 or not 1 <= stale_minutes <= 10080:
        raise ValueError("invalid_monitor_bounds")
    return f"""BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
WITH scoped AS (
  SELECT id, source, status, reserved_usd, actual_usd, own_key, created_at, resolved_at
  FROM private.inference_requests
  WHERE organization_id = '{org}'::uuid
    AND (status IN ('reserved','reconcile_required') OR (
      resolved_at >= date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      AND resolved_at < (date_trunc('month', now() AT TIME ZONE 'UTC')
        + interval '1 month') AT TIME ZONE 'UTC'))
), pending AS (
  SELECT id AS request_id, source, status, reserved_usd,
    greatest(0, floor(extract(epoch FROM now()-created_at)))::bigint AS age_seconds
  FROM scoped WHERE status IN ('reserved','reconcile_required')
  ORDER BY created_at, id LIMIT {limit}
)
SELECT jsonb_build_object(
  'contract', 'firbo-accounting-monitor/v1',
  'organization_id', '{org}', 'observed_at', now(),
  'read_only', current_setting('transaction_read_only') = 'on',
  'open_count', count(*) FILTER (WHERE status IN ('reserved','reconcile_required')),
  'reserved_count', count(*) FILTER (WHERE status = 'reserved'),
  'reconcile_required_count', count(*) FILTER (WHERE status = 'reconcile_required'),
  'potential_liability_usd', coalesce(sum(reserved_usd) FILTER
    (WHERE status IN ('reserved','reconcile_required')), 0),
  'stale_open_count', count(*) FILTER (WHERE status IN ('reserved','reconcile_required')
    AND created_at <= now()-interval '{stale_minutes} minutes'),
  'settled_month_count', count(*) FILTER
    (WHERE status IN ('settled','settled_overrun')),
  'platform_settled_month_usd', coalesce(sum(actual_usd) FILTER
    (WHERE status IN ('settled','settled_overrun') AND NOT own_key), 0),
  'unknown_settled_cost_count', count(*) FILTER
    (WHERE status IN ('settled','settled_overrun') AND actual_usd IS NULL),
  'overrun_month_count', count(*) FILTER (WHERE status = 'settled_overrun'),
  'detail_limit', {limit}, 'details',
    coalesce((SELECT jsonb_agg(pending) FROM pending), '[]'::jsonb)
) FROM scoped;
ROLLBACK;
"""


def snapshot(sql: str, run=subprocess.run) -> dict:
    result = run(
        ["psql", "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=sql,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    if result.returncode:
        # Database errors can contain endpoints, role names or supplied secrets.
        raise RuntimeError("monitor_query_failed")
    data = json.loads(result.stdout)
    if (
        not isinstance(data, dict)
        or data.get("contract") != "firbo-accounting-monitor/v1"
        or data.get("read_only") is not True
    ):
        raise RuntimeError("invalid_monitor_receipt")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", required=True)
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--stale-minutes", type=int, default=60)
    parser.add_argument(
        "--sql-only",
        action="store_true",
        help="Print the read-only query; connect to nothing",
    )
    args = parser.parse_args()
    try:
        sql = query(args.organization, args.limit, args.stale_minutes)
        if args.sql_only:
            print(sql, end="")
        else:
            print(json.dumps(snapshot(sql), sort_keys=True))
        return 0
    except (ValueError, RuntimeError, OSError, subprocess.TimeoutExpired):
        print(
            json.dumps({"ok": False, "reason": "monitor_unavailable"}), file=sys.stderr
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
