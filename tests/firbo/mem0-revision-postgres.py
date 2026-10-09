"""Real PostgreSQL/Node interoperability and scoped transaction tests; no provider."""

import json
import os
import subprocess
from contextlib import closing

import psycopg
from psycopg import errors

DSN = os.environ["DATABASE_URL"]
ORG = "00000000-0000-0000-0000-000000000201"
ACTOR = "00000000-0000-0000-0000-000000000101"
AGENT = "00000000-0000-0000-0000-000000000301"
MEMORY = "00000000-0000-0000-0000-000000000401"
CALL = (
    "select id, revision from public.read_mem0_current_revisions(%s,%s,%s,%s::uuid[])"
)
HASH = (
    "select public.mem0_canonical_revision(%s,%s,%s,%s,%s::timestamptz,%s::timestamptz)"
)

vectors = json.loads(
    subprocess.check_output(
        ["node", "tests/firbo/mem0-revision-vectors.mjs"], text=True
    )
)
with psycopg.connect(DSN) as connection:
    connection.execute("set role service_role")
    for zone in ["UTC", "Asia/Nicosia", "America/New_York"]:
        connection.execute("select set_config('TimeZone',%s,true)", (zone,))
        for row in vectors:
            actual = connection.execute(
                HASH,
                (
                    row["id"],
                    row["organization_id"],
                    row["agent_id"],
                    row["content"],
                    row["updated_at"],
                    row["expires_at"],
                ),
            ).fetchone()[0]
            assert actual == row["revision"], (zone, row, actual)
    for value in ["infinity", "-infinity", "10000-01-01T00:00:00Z", "0001-01-01 BC"]:
        try:
            with connection.transaction():
                connection.execute(HASH, (MEMORY, ORG, None, "fact", value, None))
        except errors.InvalidParameterValue:
            pass
        else:
            raise AssertionError("out-of-range timestamp admitted")
print(
    f"PASS {len(vectors) * 3} actual Node/PostgreSQL SHA comparisons across 3 session timezones"
)

for role in ["anon", "authenticated"]:
    with psycopg.connect(DSN) as connection:
        connection.execute("set role " + role)
        for sql, args in [
            (HASH, (MEMORY, ORG, None, "fact", "2026-10-08T09:00:00Z", None)),
            (CALL, (ORG, ACTOR, AGENT, [MEMORY])),
        ]:
            try:
                with connection.transaction():
                    connection.execute(sql, args)
            except errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError(role + " executed service-only function")
with psycopg.connect(DSN) as connection:
    connection.execute("set role service_role")
    ids = ["00000000-0000-0000-0000-" + str(n).zfill(12) for n in range(401, 407)]
    result = connection.execute(CALL, (ORG, ACTOR, AGENT, ids)).fetchall()
    assert [str(row[0]) for row in result] == ids[:2]
    for actor, agent in [
        ("00000000-0000-0000-0000-000000000102", AGENT),
        (ACTOR, "00000000-0000-0000-0000-000000000304"),
    ]:
        try:
            with connection.transaction():
                connection.execute(CALL, (ORG, actor, agent, [MEMORY]))
        except (errors.InsufficientPrivilege, errors.NoDataFound):
            pass
        else:
            raise AssertionError("unauthorized scope admitted")
print(
    "PASS service-only EXECUTE, authenticated membership/enabled-agent, company/own-agent, expiry/deletion filtering"
)

for isolation in ["read committed", "serializable"]:
    for column, value in [
        ("metadata", json.dumps({"deleted_at": ""})),
        ("metadata", json.dumps({"deleted_at": False})),
        ("expires_at", "2000-01-01T00:00:00Z"),
    ]:
        with psycopg.connect(DSN) as writer:
            with writer.transaction():
                writer.execute(
                    "update public.memories set " + column + "=%s where id=%s",
                    (value, MEMORY),
                )
                writer.execute("set local role service_role")
                assert (
                    writer.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchall() == []
                )
            # Restore fixture without retaining a deletion/expiry mutation.
            writer.execute("reset role")
            writer.execute(
                "update public.memories set metadata='{}',expires_at=null where id=%s",
                (MEMORY,),
            )
    with (
        closing(psycopg.connect(DSN)) as reader,
        closing(psycopg.connect(DSN)) as writer,
    ):
        reader.execute("set transaction isolation level " + isolation)
        reader.execute("set role service_role")
        before = reader.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchone()[1]
        writer.execute("set lock_timeout='250ms'")
        for statement, args in [
            (
                "update public.memories set content=%s where id=%s",
                ("correction-" + isolation, MEMORY),
            ),
            ("delete from public.memories where id=%s", (MEMORY,)),
            (
                "delete from public.organization_members where organization_id=%s and user_id=%s",
                (ORG, ACTOR),
            ),
            ("update public.agents set enabled=false where id=%s", (AGENT,)),
        ]:
            try:
                writer.execute(statement, args)
            except errors.LockNotAvailable:
                writer.rollback()
                writer.execute("set lock_timeout='250ms'")
            else:
                raise AssertionError("reader did not hold authoritative row/scope lock")
        reader.commit()
        writer.execute(
            "update public.memories set content=%s where id=%s",
            ("correction-" + isolation, MEMORY),
        )
        writer.commit()
        after = reader.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchone()[1]
        assert before != after
        reader.rollback()
print(
    "PASS READ COMMITTED/SERIALIZABLE correction/delete/member-revoke/agent-disable locking and fresh revision read"
)
