"""Actual task/connector RPC races in the disposable firbo_test CI database."""

from __future__ import annotations

import json
import os
import selectors
import subprocess
import time
import uuid

PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
OWNER = "aaaaaaaa-0701-4701-8701-aaaaaaaaaaaa"
ORG = "11111111-0701-4701-8701-111111111111"
AGENT = "33333333-0701-4701-8701-333333333333"
DEVICE = "77777777-0701-4701-8701-777777777777"
SERVICE = 'set local role service_role; set local request.jwt.claims=\'{"role":"service_role"}\';'
AUTHENTICATED = f'set local role authenticated; set local request.jwt.claims=\'{{"role":"authenticated","sub":"{OWNER}"}}\';'


def sql(query: str) -> str:
    return subprocess.check_output(
        PSQL + ["-c", query], text=True, stderr=subprocess.PIPE
    ).strip()


def service(query: str) -> str:
    return sql(f"begin; {SERVICE} {query}; commit;")


def task(status: str = "pending") -> str:
    identifier = str(uuid.uuid4())
    sql(f"""insert into public.tasks(id,organization_id,assigned_agent_id,title,status,result)
      values('{identifier}','{ORG}','{AGENT}','Synthetic run protocol race','{status}',
      '{{"report":"original"}}');""")
    return identifier


def claim(identifier: str) -> str:
    return json.loads(
        service(f"select public.claim_task_run('{ORG}','{identifier}','{OWNER}')")
    )["run_claim"]


def publish(
    identifier: str, token: str, status: str = "completed", actions: str = "[]"
) -> str:
    return f"select public.publish_task_run('{ORG}','{identifier}','{token}','{{\"report\":\"published\"}}','{actions}','{status}')"


def start(name: str) -> subprocess.Popen:
    return subprocess.Popen(
        PSQL,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "PGAPPNAME": name},
    )


def send(proc: subprocess.Popen, query: str) -> None:
    proc.stdin.write(query + "\n")
    proc.stdin.flush()


def ready(proc: subprocess.Popen) -> None:
    # The first transaction emits only this one row (work happens in DO blocks).
    with selectors.DefaultSelector() as reader:
        reader.register(proc.stdout, selectors.EVENT_READ)
        if (
            not reader.select(timeout=10)
            or proc.stdout.readline().strip() != "run_ready"
        ):
            if proc.poll() is not None:
                raise AssertionError(proc.stderr.read())
            raise AssertionError("first transaction did not reach the protocol lock")


def wait_for_lock(proc: subprocess.Popen, name: str) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if (
            sql(
                f"select count(*) from pg_stat_activity where application_name='{name}' and wait_event_type='Lock'"
            )
            == "1"
        ):
            return
        if proc.poll() is not None:
            raise AssertionError(
                f"second transaction did not contend: {proc.stderr.read()}"
            )
        time.sleep(0.025)
    raise AssertionError("second transaction never waited on the protocol lock")


def race(
    label: str,
    isolation: str,
    first: str,
    second: str,
    expected: str | None,
    check_before_release=None,
) -> str:
    name = "run_protocol_" + uuid.uuid4().hex
    a, b = start(name + "_a"), start(name + "_b")
    try:
        send(a, f"begin isolation level {isolation}; {first}; select 'run_ready';")
        ready(a)
        if check_before_release:
            check_before_release()
        send(b, f"begin isolation level {isolation}; {second}; commit;")
        b.stdin.close()
        wait_for_lock(b, name + "_b")
        send(a, "commit;\n\\q")
        a.stdin.close()
        if a.wait(timeout=10) != 0:
            raise AssertionError(a.stderr.read())
        code = b.wait(timeout=10)
        output, error = b.stdout.read().strip(), b.stderr.read()
        if expected is None:
            if code != 0:
                raise AssertionError(error)
        elif code == 0 or expected not in error:
            raise AssertionError(f"expected {expected}, received {error}")
        print(f"PASS {isolation}: {label}", flush=True)
        return output
    finally:
        for proc in (a, b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()


def competing_claims(isolation: str) -> None:
    t = task()
    first = f"{SERVICE} do $$ begin perform public.claim_task_run('{ORG}','{t}','{OWNER}'); end $$"
    second = f"{SERVICE} select public.claim_task_run('{ORG}','{t}','{OWNER}')"
    race("one winner for competing model claims", isolation, first, second, "40001")
    assert (
        sql(
            f"select status='running' and run_claim is not null from public.tasks where id='{t}'"
        )
        == "t"
    )


def competing_publications(isolation: str) -> None:
    t = task()
    token = claim(t)
    first = f"{SERVICE} do $$ begin perform public.publish_task_run('{ORG}','{t}','{token}','{{\"report\":\"published\"}}','[]','completed'); end $$"
    race(
        "one winner for duplicate publication",
        isolation,
        first,
        f"{SERVICE} {publish(t, token)}",
        "40001",
    )
    assert (
        sql(
            f"select status='completed' and run_claim is null and result->>'report'='published' from public.tasks where id='{t}'"
        )
        == "t"
    )


def active_job_before_claim(isolation: str) -> None:
    t = task("blocked")
    job = sql(
        f"insert into public.connector_jobs(organization_id,device_id,task_id,kind,status) values('{ORG}','{DEVICE}','{t}','read','queued') returning id"
    )
    # Represents a sibling failure while a real job claim is in progress.
    first = f"{SERVICE} update public.connector_jobs set status='running' where id='{job}'; update public.tasks set status='failed' where id='{t}'"
    second = f"{SERVICE} select public.claim_task_run('{ORG}','{t}','{OWNER}')"
    expected = "23514" if isolation == "read committed" else "40001"
    race(
        "running sibling prevents a new model claim", isolation, first, second, expected
    )
    assert (
        sql(
            f"select status='failed' and run_claim is null from public.tasks where id='{t}'"
        )
        == "t"
    )
    assert (
        sql(f"select status='running' from public.connector_jobs where id='{job}'")
        == "t"
    )


def new_dependency_before_claim(isolation: str, dependency: str) -> None:
    t = task()
    if dependency == "job":
        insert = f"insert into public.connector_jobs(organization_id,device_id,task_id,kind,status) values('{ORG}','{DEVICE}','{t}','read','queued')"
    else:
        insert = f"insert into public.approvals(organization_id,task_id,agent_id,action,status) values('{ORG}','{t}','{AGENT}','file_read','pending')"
    expected = "23514" if isolation == "read committed" else "40001"
    race(
        f"new {dependency} blocks an overlapping inference claim",
        isolation,
        f"{SERVICE} {insert}",
        f"{SERVICE} select public.claim_task_run('{ORG}','{t}','{OWNER}')",
        expected,
    )
    assert (
        sql(
            f"select status='pending' and run_claim is null from public.tasks where id='{t}'"
        )
        == "t"
    )


def recover_before_publish(isolation: str) -> None:
    t = task()
    token = claim(t)
    # Only synthetic timestamps are aged; restore the real trigger immediately.
    sql(
        f"alter table public.tasks disable trigger tasks_updated_at; update public.tasks set started_at=now()-interval '1 hour',updated_at=now()-interval '1 hour' where id='{t}'; alter table public.tasks enable trigger tasks_updated_at;"
    )
    first = f"{AUTHENTICATED} do $$ begin perform public.manage_task('{ORG}','{t}','running','recover'); end $$"
    race(
        "recovery invalidates late model output",
        isolation,
        first,
        f"{SERVICE} {publish(t, token)}",
        "40001",
    )
    assert (
        sql(
            f"select status='blocked' and run_claim is null and result->>'reconcile_required'='true' and result->>'report'='original' from public.tasks where id='{t}'"
        )
        == "t"
    )


def publish_before_recover(isolation: str) -> None:
    t = task()
    token = claim(t)
    sql(
        f"alter table public.tasks disable trigger tasks_updated_at; update public.tasks set started_at=now()-interval '1 hour',updated_at=now()-interval '1 hour' where id='{t}'; alter table public.tasks enable trigger tasks_updated_at;"
    )
    first = f"{SERVICE} do $$ begin perform public.publish_task_run('{ORG}','{t}','{token}','{{\"report\":\"published\"}}','[]','completed'); end $$"
    second = (
        f"{AUTHENTICATED} select public.manage_task('{ORG}','{t}','running','recover')"
    )
    race(
        "completed publication wins over stale recovery",
        isolation,
        first,
        second,
        "40001",
    )
    assert (
        sql(
            f"select status='completed' and run_claim is null and result->>'report'='published' and not result ? 'reconcile_required' from public.tasks where id='{t}'"
        )
        == "t"
    )


def visibility_and_fast_receipt() -> None:
    t = task()
    token = claim(t)
    actions = (
        '[{"action":"file_read","payload":{"path":"synthetic-only"},"risk":"low"}]'
    )
    first = f"{SERVICE} do $$ begin perform public.publish_task_run('{ORG}','{t}','{token}','{{\"report\":\"published\"}}','{actions}','awaiting_approval'); end $$"

    def hidden() -> None:
        assert (
            sql(
                f"select status='running' and run_claim='{token}' and result->>'report'='original' from public.tasks where id='{t}'"
            )
            == "t"
        )
        assert sql(f"select count(*) from public.approvals where task_id='{t}'") == "0"

    # A device may act only after the publication commits. Wait on the parent
    # as a visibility gate, then use the actual decision and receipt RPCs.
    second = f"""{SERVICE} do $$ declare a uuid; j uuid; published jsonb; begin
      select result into published from public.tasks where id='{t}' for update;
      if published->>'report' is distinct from 'published' then raise exception 'report_not_ready'; end if;
      select id into a from public.approvals where task_id='{t}' and status='pending';
      j := (public.connector_decide_execution(a,'{OWNER}','{DEVICE}','approved',null,null,'read','{{"path":"synthetic-only"}}')->>'job_id')::uuid;
      update public.connector_jobs set status='running' where id=j;
      perform public.connector_finish_execution(j,'{DEVICE}','{ORG}',true,'{{"content":"synthetic-only"}}',null,repeat('a',64));
      end $$"""
    race(
        "report/queue invisible until commit, fast real receipt preserves report",
        "read committed",
        first,
        second,
        None,
        hidden,
    )
    assert (
        sql(
            f"select status='completed' and run_claim is null and result->>'report'='published' and jsonb_array_length(result->'execution_receipts')=1 from public.tasks where id='{t}'"
        )
        == "t"
    )
    try:
        service(publish(t, token))
    except subprocess.CalledProcessError as error:
        if "40001" not in error.stderr:
            raise AssertionError(error.stderr) from error
    else:
        raise AssertionError("late model publication overwrote the completed receipt")


if __name__ == "__main__":
    if (
        os.environ.get("PGDATABASE") != "firbo_test"
        or sql("select current_database()") != "firbo_test"
    ):
        raise SystemExit(
            "Run protocol races require the disposable firbo_test database"
        )
    sql(f"""set firbo.seeding='on';
      insert into auth.users(id) values('{OWNER}');
      insert into public.organizations(id,name,slug) values('{ORG}','Synthetic run races','synthetic-run-races');
      insert into public.organization_members(organization_id,user_id,role) values('{ORG}','{OWNER}','owner');
      insert into public.agents(id,organization_id,name,slug) values('{AGENT}','{ORG}','Synthetic run agent','synthetic-race-agent');
      insert into public.connector_devices(id,organization_id,created_by,name,paired) values('{DEVICE}','{ORG}','{OWNER}','Synthetic paired race device',true);
      set firbo.seeding='off';""")
    try:
        for level in ("read committed", "repeatable read", "serializable"):
            competing_claims(level)
            competing_publications(level)
            active_job_before_claim(level)
            new_dependency_before_claim(level, "job")
            new_dependency_before_claim(level, "approval")
            recover_before_publish(level)
            publish_before_recover(level)
        visibility_and_fast_receipt()
    finally:
        sql(
            f"delete from public.organizations where id='{ORG}'; delete from auth.users where id='{OWNER}';"
        )
