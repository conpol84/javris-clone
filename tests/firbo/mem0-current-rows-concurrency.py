from __future__ import annotations

import os
import threading
from contextlib import closing

import psycopg
from psycopg import errors

DSN = os.environ["DATABASE_URL"]
ORG = "00000000-0000-0000-0000-000000000201"
ACTOR = "00000000-0000-0000-0000-000000000101"
AGENT = "00000000-0000-0000-0000-000000000301"
MEMORY = "00000000-0000-0000-0000-000000000401"
CALL = "select content from public.read_mem0_current_rows(%s, %s, %s, %s::uuid[])"


def reader_connection() -> psycopg.Connection:
    connection = psycopg.connect(DSN)
    connection.execute("set role service_role")
    return connection


def assert_membership_lock() -> None:
    with (
        closing(reader_connection()) as reader,
        closing(psycopg.connect(DSN)) as writer,
    ):
        assert reader.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchone() == (
            "company-current",
        )
        writer.execute("set lock_timeout = '250ms'")
        try:
            writer.execute(
                "delete from public.organization_members where organization_id = %s and user_id = %s",
                (ORG, ACTOR),
            )
        except errors.LockNotAvailable:
            writer.rollback()
        else:
            raise AssertionError(
                "membership revocation was not blocked by the reader transaction"
            )
        reader.rollback()


def assert_agent_lock() -> None:
    with (
        closing(reader_connection()) as reader,
        closing(psycopg.connect(DSN)) as writer,
    ):
        reader.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchall()
        writer.execute("set lock_timeout = '250ms'")
        try:
            writer.execute(
                "update public.agents set enabled = false where id = %s", (AGENT,)
            )
        except errors.LockNotAvailable:
            writer.rollback()
        else:
            raise AssertionError(
                "agent disablement was not blocked by the reader transaction"
            )
        reader.rollback()


def assert_memory_lock_and_fresh_read() -> None:
    with (
        closing(reader_connection()) as reader,
        closing(psycopg.connect(DSN)) as writer,
    ):
        assert reader.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchone() == (
            "company-current",
        )
        writer.execute("set lock_timeout = '250ms'")
        try:
            writer.execute(
                "update public.memories set content = 'corrected', updated_at = statement_timestamp() where id = %s",
                (MEMORY,),
            )
        except errors.LockNotAvailable:
            writer.rollback()
        else:
            raise AssertionError(
                "memory correction was not blocked by the reader transaction"
            )
        reader.commit()

        writer.execute(
            "update public.memories set content = 'corrected', updated_at = statement_timestamp() where id = %s",
            (MEMORY,),
        )
        writer.commit()
        assert reader.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchone() == (
            "corrected",
        )
        reader.rollback()


def assert_concurrent_readers() -> None:
    barrier = threading.Barrier(3)
    results: list[str] = []

    def read_once() -> None:
        with closing(reader_connection()) as connection:
            barrier.wait(timeout=5)
            row = connection.execute(CALL, (ORG, ACTOR, AGENT, [MEMORY])).fetchone()
            results.append(row[0])
            connection.rollback()

    threads = [threading.Thread(target=read_once), threading.Thread(target=read_once)]
    for thread in threads:
        thread.start()
    barrier.wait(timeout=5)
    for thread in threads:
        thread.join(timeout=5)
        assert not thread.is_alive()
    assert results == ["corrected", "corrected"]


if __name__ == "__main__":
    assert_membership_lock()
    assert_agent_lock()
    assert_memory_lock_and_fresh_read()
    assert_concurrent_readers()
    print("mem0 current-row concurrency passed")
