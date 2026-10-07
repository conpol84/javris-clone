# FIRBO Mem0 authoritative current-row reader — 2026-10-08

## Changed

- Added a CLI-generated candidate migration for one private, service-role-only RPC over the existing `public.memories` table.
- The RPC rechecks and locks current organization membership, the enabled target agent, and each returned memory row.
- Results preserve requested order and include only the current organization plus company-wide or target-agent memories.
- Expired, deleted, blank, oversized, foreign-tenant, and other-agent rows are withheld.
- Inputs are bounded to 1–64 unique non-null memory IDs.

## Tested

- Real PostgreSQL 17.6 fixture and authorization assertions.
- `anon` and `authenticated` cannot execute the RPC; `service_role` can.
- Tenant, actor, agent, expiry, deletion, content-bound, ordering, duplicate and empty-input gates.
- Concurrent revocation, agent disablement, correction, fresh read and parallel reader behavior.

## Passed

- Candidate source and executable tests are isolated from existing FIRBO runtime consumers.
- The function uses `security invoker`, an empty `search_path`, explicit schema qualification and explicit revoke/grant statements.
- Row locks prevent a successful reader transaction from racing past committed membership, agent, correction or deletion changes.

## Failed

- The first PostgreSQL run correctly exposed that row-locking needs `UPDATE` as well as `SELECT`; the fixture now models Supabase service-role DML grants explicitly and the unchanged migration passes.
- The next repository run found only Ruff formatting drift in the Python concurrency test; the pinned formatter corrected it without changing the assertions.
- No live migration or production callback was attempted. Those are outside this source-only checkpoint.

## Remains

- Exact-head CI and remote read-back for this candidate.
- Separate design and tests for the atomic publication/delete RPC and any vector-store adapter.
- A pinned self-hosted Mem0/vector-store version, actual filter behavior, real extraction/embedding capabilities and prices, private topology/receipts, and retrieval-quality acceptance.
- Explicit coordination and exact live preflight before any migration application. Mem0 remains uninstalled and default-disabled.
