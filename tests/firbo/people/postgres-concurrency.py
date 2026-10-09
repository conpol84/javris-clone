"""Real PostgreSQL competing owner removals, in a disposable CI database only."""

import os
import selectors
import subprocess
import time
import uuid

PSQL = ["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose"]
FIRST = "aaaaaaaa-0111-4111-8111-aaaaaaaaaaaa"
SECOND = "bbbbbbbb-0222-4222-8222-bbbbbbbbbbbb"


def sql(query: str) -> str:
    return subprocess.check_output(PSQL + ["-c", query], text=True).strip()


def session(name: str) -> subprocess.Popen:
    return subprocess.Popen(
        PSQL,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env={**os.environ, "PGAPPNAME": name},
    )


def ready(proc: subprocess.Popen) -> None:
    with selectors.DefaultSelector() as reader:
        reader.register(proc.stdout, selectors.EVENT_READ)
        if (
            not reader.select(timeout=10)
            or proc.stdout.readline().strip() != "owner_ready"
        ):
            raise AssertionError("first owner transaction did not reach the lock")


def race(isolation: str, kind: str) -> None:
    org = str(uuid.uuid4())
    name = "owner_guard_" + uuid.uuid4().hex
    sql(f"""insert into public.organizations(id,name,slug)
        values('{org}','Synthetic race','race-{uuid.uuid4().hex}');
        insert into public.organization_members(organization_id,user_id,role)
        values('{org}','{FIRST}','owner'),('{org}','{SECOND}','owner');""")
    if kind == "delete":
        statement = "delete from public.organization_members"
    else:
        statement = "update public.organization_members set role='manager'"
    a, b = session(name + "_a"), session(name + "_b")
    try:
        a.stdin.write(
            f"begin isolation level {isolation};\n{statement} where organization_id='{org}' and user_id='{FIRST}';\nselect 'owner_ready';\n"
        )
        a.stdin.flush()
        ready(a)
        b.stdin.write(
            f"begin isolation level {isolation};\n{statement} where organization_id='{org}' and user_id='{SECOND}';\ncommit;\n"
        )
        b.stdin.close()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if (
                sql(
                    f"select count(*) from pg_stat_activity where application_name='{name}_b' and wait_event_type='Lock'"
                )
                == "1"
            ):
                break
            if b.poll() is not None:
                raise AssertionError("second owner did not contend on the parent lock")
            time.sleep(0.05)
        else:
            raise AssertionError("second owner never waited on the parent lock")
        a.stdin.write("commit;\n\\q\n")
        a.stdin.close()
        if a.wait(timeout=10) != 0:
            raise AssertionError(a.stderr.read())
        if b.wait(timeout=10) == 0:
            raise AssertionError("both owner removals committed")
        error = b.stderr.read()
        expected = "23514" if isolation == "read committed" else "40001"
        if expected not in error:
            raise AssertionError(f"expected {expected}, received {error}")
        if (
            sql(
                f"select count(*) from public.organization_members where organization_id='{org}' and role='owner'"
            )
            != "1"
        ):
            raise AssertionError("the race lost its final owner")
        print(f"PASS {isolation}: competing owner {kind}", flush=True)
    finally:
        for proc in (a, b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        sql(f"delete from public.organizations where id='{org}'")


if __name__ == "__main__":
    sql(f"insert into auth.users(id) values('{FIRST}'),('{SECOND}')")
    try:
        for isolation in ("read committed", "repeatable read", "serializable"):
            for kind in ("demotion", "delete"):
                race(isolation, kind)
    finally:
        sql(f"delete from auth.users where id in ('{FIRST}','{SECOND}')")
