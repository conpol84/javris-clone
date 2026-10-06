"""Disposable PostgreSQL acceptance only; requires the accounting CI lane."""

import importlib.util
import os
import subprocess
from pathlib import Path

if os.environ.get("FIRBO_LIFECYCLE_TARGET") != "accounting":
    raise SystemExit("synthetic_accounting_ci_required")

spec = importlib.util.spec_from_file_location(
    "monitor", Path(__file__).parents[3] / "tools/firbo-accounting-monitor.py"
)
monitor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(monitor)
org = "12121212-0815-4815-8815-121212121212"
other = "13131313-0815-4815-8815-131313131313"
agent = "14141414-0815-4815-8815-141414141414"
other_agent = "15151515-0815-4815-8815-151515151515"


def psql(sql):
    return subprocess.run(
        ["psql", "-X", "--no-password", "-qAt", "-v", "ON_ERROR_STOP=1", "-f", "-"],
        input=sql,
        text=True,
        capture_output=True,
        timeout=10,
        check=True,
    ).stdout.strip()


psql(f"""
INSERT INTO public.organizations(id,name,slug) VALUES
('{org}','Monitor synthetic','monitor-synthetic'),
('{other}','Monitor other','monitor-other');
INSERT INTO public.agents(id,organization_id,name,slug) VALUES
('{agent}','{org}','Monitor agent','monitor-agent'),
('{other_agent}','{other}','Other monitor agent','other-monitor-agent');
INSERT INTO private.inference_requests
(organization_id,agent_id,source,request_key,status,reserved_usd,actual_usd,own_key,created_at,resolved_at)
VALUES
('{org}','{agent}','agent-chat',gen_random_uuid(),'reserved',.25,NULL,false,now()-interval '8 months',NULL),
('{org}','{agent}','mission-runner',gen_random_uuid(),'reconcile_required',.50,NULL,false,now()-interval '6 months',NULL),
('{org}','{agent}','agent-chat',gen_random_uuid(),'reserved',0,NULL,false,now(),NULL),
('{org}','{agent}','agent-chat',gen_random_uuid(),'settled',.20,.20,false,now()-interval '2 months',now()),
('{org}','{agent}','agent-chat',gen_random_uuid(),'settled',.90,.90,true,now(),now()),
('{org}','{agent}','agent-chat',gen_random_uuid(),'settled',0,0,false,now(),now()),
('{org}','{agent}','agent-chat',gen_random_uuid(),'settled',1,1,false,now()-interval '8 months',now()-interval '7 months'),
('{other}','{other_agent}','agent-chat',gen_random_uuid(),'reserved',99,NULL,false,now(),NULL);
""")
digest_sql = "SELECT md5(string_agg(row_to_json(r)::text, ',' ORDER BY r.id)) FROM private.inference_requests r;"
before = psql(digest_sql)
result = monitor.snapshot(monitor.query(org, limit=1))
assert result["read_only"] is True
assert result["open_count"] == 3
assert result["reserved_count"] == 2
assert result["reconcile_required_count"] == 1
assert result["potential_liability_usd"] == 0.75
assert result["stale_open_count"] == 2
assert result["settled_month_count"] == 3
assert result["platform_settled_month_usd"] == 0.20
assert result["unknown_settled_cost_count"] == 0
assert len(result["details"]) == 1
assert result["details"][0]["reserved_usd"] == 0.25
assert psql(digest_sql) == before
empty = monitor.snapshot(monitor.query("16161616-0815-4815-8815-161616161616"))
assert empty["open_count"] == 0 and empty["details"] == []
for role in ["anon", "authenticated", "service_role"]:
    denied = monitor.query(org).replace(
        "SET LOCAL statement_timeout",
        f"SET LOCAL ROLE {role};\nSET LOCAL statement_timeout",
    )
    try:
        monitor.snapshot(denied)
    except RuntimeError as error:
        assert str(error) == "monitor_query_failed"
    else:
        raise AssertionError(f"private monitor unexpectedly readable by {role}")
assert psql(digest_sql) == before
print(
    "PASS monitor: cross-month liability, current-month settlement, Free/BYOK, bounded details, empty org, client/service-role denial, unchanged ledger"
)
