"""Prove that two Edge instances cannot reserve the same remaining budget."""

from __future__ import annotations

import json
import os
import selectors
import subprocess
import time
import uuid

PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
USER = "aaaaaaaa-0815-4815-8815-aaaaaaaaaaaa"
SERVICE = 'set local role service_role; set local request.jwt.claims=\'{"role":"service_role"}\';'


def sql(query: str) -> str:
    return subprocess.check_output(
        PSQL + ["-c", query], text=True, stderr=subprocess.PIPE
    ).strip()


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


def wait_ready(proc: subprocess.Popen) -> None:
    with selectors.DefaultSelector() as reader:
        reader.register(proc.stdout, selectors.EVENT_READ)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if not reader.select(timeout=1):
                continue
            if proc.stdout.readline().strip() == "reservation_ready":
                return
    raise AssertionError("first reservation did not reach the organization lock")


def wait_lock(proc: subprocess.Popen, app: str) -> None:
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if (
            sql(
                f"select count(*) from pg_stat_activity where application_name='{app}' and wait_event_type='Lock'"
            )
            == "1"
        ):
            return
        if proc.poll() is not None:
            raise AssertionError(proc.stderr.read())
        time.sleep(0.025)
    raise AssertionError("second reservation did not contend on the organization lock")


def race(
    isolation: str, source: str = "agent-chat", rollover_status: str | None = None
) -> None:
    suffix = uuid.uuid4().hex
    org = str(uuid.uuid4())
    agent = str(uuid.uuid4())
    first_key, second_key = str(uuid.uuid4()), str(uuid.uuid4())
    sql(
        f"insert into public.organizations(id,name,slug) values('{org}','Race {suffix[:8]}','race-{suffix[:12]}');"
        f"insert into public.organization_members values('{org}','{USER}','owner',now());"
        f"insert into public.agents(id,organization_id,name,slug,monthly_budget_usd) values('{agent}','{org}','Race agent','race-agent',1.00);"
    )
    app = "accounting_" + suffix
    a, b = start(app + "_a"), start(app + "_b")

    def call(key: str, route: str) -> str:
        return (
            f"select public.firbo_reserve_inference('{org}','{USER}','{agent}','{route}',"
            f"'{key}',0.750000,60,100)"
        )

    try:
        age = ""
        if rollover_status is not None:
            assert rollover_status in ("reserved", "reconcile_required")
            age = (
                "reset role; update private.inference_requests "
                "set created_at=(date_trunc('month',now() at time zone 'utc') "
                f"at time zone 'utc')-interval '40 days',status='{rollover_status}' "
                f"where organization_id='{org}'; {SERVICE} "
            )
        send(
            a,
            f"begin isolation level {isolation}; {SERVICE} {call(first_key, 'agent-chat')}; {age} select 'reservation_ready';",
        )
        wait_ready(a)
        send(
            b,
            f"begin isolation level {isolation}; {SERVICE} {call(second_key, source)}; commit;",
        )
        b.stdin.close()
        wait_lock(b, app + "_b")
        send(a, "commit;\n\\q")
        a.stdin.close()
        if a.wait(timeout=10) != 0:
            raise AssertionError(a.stderr.read())
        code = b.wait(timeout=10)
        out, err = b.stdout.read().strip(), b.stderr.read()
        if isolation == "serializable" and code != 0:
            if "40001" not in err:
                raise AssertionError(err)
        else:
            if code != 0:
                raise AssertionError(err)
            result = json.loads(out.splitlines()[-1])
            if (
                result.get("ok") is not False
                or result.get("reason") != "budget_exceeded"
            ):
                raise AssertionError(result)
        if (
            sql(
                f"select count(*) from private.inference_requests where organization_id='{org}' and status in ('reserved','reconcile_required')"
            )
            != "1"
        ):
            raise AssertionError(
                "more than one reservation crossed the budget boundary"
            )
        print(
            f"PASS {isolation}: one winner for concurrent chat/{source} budget reservations (rollover={rollover_status})",
            flush=True,
        )
    finally:
        for proc in (a, b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()


def settlement_handoff(isolation: str, rollover: bool = False) -> None:
    suffix = uuid.uuid4().hex
    org = str(uuid.uuid4())
    agent = str(uuid.uuid4())
    initial_key, next_key = str(uuid.uuid4()), str(uuid.uuid4())
    sql(
        f"insert into public.organizations(id,name,slug) values('{org}','Settle {suffix[:8]}','settle-{suffix[:12]}');"
        f"insert into public.organization_members values('{org}','{USER}','owner',now());"
        f"insert into public.agents(id,organization_id,name,slug,monthly_budget_usd) values('{agent}','{org}','Settle agent','settle-agent',1.00);"
    )
    initial = json.loads(
        sql(
            f"begin; {SERVICE} select public.firbo_reserve_inference('{org}','{USER}','{agent}','agent-chat',"
            f"'{initial_key}',0.750000,60,100); commit;"
        )
    )
    request_id = initial["request_id"]
    if rollover:
        sql(
            "update private.inference_requests "
            "set created_at=(date_trunc('month',now() at time zone 'utc') "
            "at time zone 'utc')-interval '40 days',status='reconcile_required' "
            f"where id='{request_id}'"
        )
    app = "accounting_settle_" + suffix
    a, b = start(app + "_a"), start(app + "_b")
    try:
        send(
            a,
            f"begin isolation level {isolation}; {SERVICE} select public.firbo_settle_inference('{request_id}','test:model',100,50,0.750000,100,false); select 'reservation_ready';",
        )
        wait_ready(a)
        send(
            b,
            f"begin isolation level {isolation}; {SERVICE} select public.firbo_reserve_inference('{org}','{USER}','{agent}','agent-chat','{next_key}',0.500000,60,100); commit;",
        )
        b.stdin.close()
        wait_lock(b, app + "_b")
        send(a, "commit;\n\\q")
        a.stdin.close()
        if a.wait(timeout=10) != 0:
            raise AssertionError(a.stderr.read())
        code = b.wait(timeout=10)
        out, err = b.stdout.read().strip(), b.stderr.read()
        if isolation == "serializable" and code != 0:
            if "40001" not in err:
                raise AssertionError(err)
        else:
            if code != 0:
                raise AssertionError(err)
            result = json.loads(out.splitlines()[-1])
            if (
                result.get("ok") is not False
                or result.get("reason") != "budget_exceeded"
            ):
                raise AssertionError(result)
        if (
            sql(
                f"select count(*) from public.usage_events where inference_request_id='{request_id}'"
            )
            != "1"
        ):
            raise AssertionError("settlement handoff lost or duplicated usage")
        if (
            sql(
                f"select count(*) from private.inference_requests where organization_id='{org}' and status='reserved'"
            )
            != "0"
        ):
            raise AssertionError("reservation admitted between settlement aggregates")
        print(
            f"PASS {isolation}: settlement cannot disappear between budget aggregates (rollover={rollover})",
            flush=True,
        )
    finally:
        for proc in (a, b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()


for level in ("read committed", "serializable"):
    race(level)
    race(level, "mission-runner")
    settlement_handoff(level)
    race(level, "mission-runner", "reserved")
    race(level, "mission-runner", "reconcile_required")
    settlement_handoff(level, rollover=True)
