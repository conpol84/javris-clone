"""Build disposable stock-PostgreSQL fixtures from the actual source migrations.

Tenancy, table constraints and RLS are kept verbatim. Only pgvector features
unused by these lifecycle tests are removed; embeddings become inert text.
Billing/cron/storage/provider integrations are not loaded or claimed tested.
"""

from __future__ import annotations

import argparse
import re
from pathlib import Path


def section(source: str, start: str, end: str) -> str:
    return source.split(start, 1)[1].split("\n", 1)[1].split(end, 1)[0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("target", choices=("skills", "tasks"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    migrations = Path(__file__).resolve().parents[2] / "supabase" / "migrations"

    def read(name: str) -> str:
        return (migrations / name).read_text()

    bootstrap = (
        Path(__file__).resolve().parent / "people" / "postgres-fixture.sql"
    ).read_text()
    bootstrap += """
create function auth.role() returns text language sql stable as $$
 select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',current_user::text)
$$;
grant usage on schema auth to service_role;
"""
    core = read("20261001000001_core_tenancy.sql").replace(
        "create extension if not exists vector with schema extensions;", ""
    )
    agents = read("20261001000002_agents_chat_memory_knowledge.sql")
    agents = agents.split("-- Semantic search", 1)[0]
    agents = agents.replace("extensions.vector(1536)", "text")
    agents = re.sub(
        r"^create index .* using hnsw .*;\n", "", agents, flags=re.MULTILINE
    )
    parity = read("20261005120000_jarvis_parity.sql")
    parts = [bootstrap, core, agents]
    if args.target == "skills":
        parts.append(section(parity, "-- 2. Skills", "-- 3. Workflows"))
    else:
        parts.append(read("20261001000003_tasks_workflows_usage.sql"))
        audit = read("20261001000006_agent_controls_audit_team.sql")
        parts.append(
            audit.split(
                "-- ---------------------------------------------------------------- org creation",
                1,
            )[0]
        )
        parts.append(section(parity, "-- 3. Workflows", "-- 4. Feedback"))
    parts.append(
        "grant select,insert,update,delete on all tables in schema public to authenticated,service_role;\n"
    )
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text("\n".join(parts))
    print(f"Built {args.target} lifecycle fixture: {args.output}")


if __name__ == "__main__":
    main()
