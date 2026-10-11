"""Real PostgreSQL protocol checks; never run against a FIRBO/customer database.

The Edge handler is covered separately by workflow-recovery.test.mjs. This
checks its conditional UPDATE protocol with actual PostgreSQL concurrency.
"""

import os
import subprocess
from pathlib import Path

DB = "firbo_workflow_recovery_ci"
if os.environ.get("FIRBO_SYNTHETIC_PG") != "1" or os.environ.get("PGDATABASE") != DB:
    raise SystemExit("Refusing non-synthetic database; use the dedicated CI job")
if os.environ.get("PGHOST") not in {"localhost", "127.0.0.1"}:
    raise SystemExit("Refusing non-local PostgreSQL target")

source = Path("supabase/functions/workflow-runner/index.ts").read_text()
assert ".eq('step', run.step).eq('task_id', task.id)" in source
assert ".update({ step: next, task_id: null, updated_at: now })" in source
assert ".eq('status', 'pending').is('run_claim', null).is('result', null)" in source
command = ["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At", "-c"]


def sql(statement: str) -> str:
    result = subprocess.run(command + [statement], text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result.stdout.strip()


org = "22222222-2222-4222-8222-222222222222"
run = "44444444-4444-4444-8444-444444444444"
task = "55555555-5555-4555-8555-555555555555"
foreign = "66666666-6666-4666-8666-666666666666"
schema_sql = f"""
create table workflow_runs (
 id uuid primary key, organization_id uuid not null, task_id uuid,
 step integer not null, status text not null, updated_at timestamptz default now()
);
create table next_tasks (id bigint generated always as identity, run_id uuid, step integer);
insert into workflow_runs(id,organization_id,task_id,step,status)
values ('{run}','{org}','{task}',0,'running');
"""
sql(schema_sql)


def claim(tenant: str = org) -> str:
    return f"""begin;
with winner as (
 update workflow_runs set step=1,task_id=null,updated_at=now()
 where organization_id='{tenant}' and id='{run}' and status='running'
   and step=0 and task_id='{task}' returning id
)
insert into next_tasks(run_id,step) select id,1 from winner;
select pg_sleep(0.15);
commit;"""


# No unique constraint on next_tasks: a broken conditional update would create
# two real tasks, rather than having the test schema hide the duplication.
workers = [
    subprocess.Popen(
        command + [claim()],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    for _ in range(2)
]
for worker in workers:
    _, error = worker.communicate(timeout=20)
    assert worker.returncode == 0, error
assert sql("select count(*) from next_tasks") == "1"
assert sql("select step::text||':'||(task_id is null)::text from workflow_runs") == "1:true"
print("PASS: two concurrent PostgreSQL claimers create exactly one next task")

# Same expected old step/task cannot replay after a lost acknowledgement.
sql(claim())
assert sql("select count(*) from next_tasks") == "1"
print("PASS: lost ACK/repeated old transition cannot replay")

sql(f"update workflow_runs set step=0,task_id='{task}',status='running'")
sql(claim(foreign))
assert sql("select count(*) from next_tasks") == "1"
assert sql("select step from workflow_runs") == "0"
print("PASS: same task/run IDs under a foreign tenant cannot claim")

sql("update workflow_runs set status='cancelled'")
sql(claim())
assert sql("select count(*) from next_tasks") == "1"
assert sql("select status from workflow_runs") == "cancelled"
print("PASS: cancellation prevents a stale scheduler from creating work")

dispatch_sql = """create table dispatch_receipts (
 id integer primary key, status text, run_claim uuid, result jsonb
);
insert into dispatch_receipts values(1,'running','77777777-7777-4777-8777-777777777777',null);
insert into dispatch_receipts values(2,'pending',null,'{"accounting":"preserve"}');
update dispatch_receipts set status='blocked',result='{"reconcile_required":true}'
 where status='pending' and run_claim is null and result is null;
"""
sql(dispatch_sql)
assert sql("select status from dispatch_receipts where id=1") == "running"
assert sql("select result->>'accounting' from dispatch_receipts where id=2") == "preserve"
print("PASS: conditional reconciliation preserves running work and stored accounting")
print("5/5 real PostgreSQL protocol checks passed; no production/provider calls")
