# FIRBO Mem0 current-row publication boundary — 2026-10-08

## Changed

- Added a default-disabled source contract between already-accounted extraction/embedding results and a future Mem0/vector index publication.
- Only a trusted private server context using the service role can construct a command. Company, actor, agent, memory, expected content-bound revision and operation identities are copied before any asynchronous boundary.
- Both settled receipts are recomputed against the exact source text, extracted text, models, dimensions, memory ID and revision. Changed prose cannot reuse old provider receipts.
- The future store supplies one atomic operation only. Its reviewed DB implementation must lock and re-read the authoritative memory plus publication identity, enforce organization/agent scope, compare the current revision, then publish or delete in one transaction.
- Correction races return `stale`; deletion/expiry may remove the index; duplicate publication is accepted only when the DB reports the same current and published revision.
- Unknown DB outcomes are reconciliation-required and never retried by this boundary.

## Tested

- Executable fake-store cases cover disabled configuration, untrusted contexts, cross-company/agent/revision attempts, receipt replay after source or extraction changes, vector and cost bounds, success, idempotency, deletion/expiry, delete-only reconciliation, correction races, authorization denial, lost responses, malformed receipts and mutation across awaits.
- The dedicated workflow runs Node 22.22 tests and strict TypeScript 7.0.2.
- Existing retrieval and transport-accounting modules remain unchanged.

## Passed

- Exact local and CI results are recorded in the PR after the final candidate is tested.

## Failed / limitations

- This is an interface and executable policy contract, not a database implementation. It cannot prove that a future callback really uses one transaction; the real RPC and PostgreSQL concurrency tests remain mandatory.
- No migration, RPC, RLS policy, grant, table, SDK, Mem0 service, vector store, network request, provider call, customer data, publication or deletion is created.
- `service_role` bypasses RLS and therefore must remain private. A future function must be in a non-exposed schema, use an empty `search_path`, revoke default `PUBLIC` execution, grant only the required service role, and schema-qualify every object.
- Current Supabase guidance notes that table grants and RLS are separate. New tables may not be Data API-exposed automatically, and no public exposure is wanted for this boundary.
- PostgreSQL 15.19/17.11 upgrade checks and self-hosted Supabase gateway changes are deployment concerns; this source-only contract changes neither.

## Remains

1. Map the contract to the existing authoritative FIRBO memory schema after a fresh schema/permission read. Generate any candidate migration through the Supabase CLI rather than inventing an applied identity.
2. Implement a private service-only atomic RPC with row locks, empty `search_path`, explicit grants/revokes, current-revision recomputation and idempotent publication/deletion receipts.
3. Prove cross-company denial, correction/delete/expiry races and ambiguous response recovery under real PostgreSQL isolation levels before merge or live use.
4. Select and pin a self-hosted Mem0/vector-store bundle and independently verify its actual metadata-filter behavior.
5. Verify real extraction/embedding capabilities, dimensions and prices, then compare retrieval quality with FIRBO Memory/Knowledge before any default-disabled consumer release.

Official guidance reviewed on 2026-10-07 UTC:
- Supabase RLS and service-role behavior: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase database-function security: https://supabase.com/docs/guides/database/functions
- Supabase vector columns and metadata filtering: https://supabase.com/docs/guides/ai/vector-columns
- Supabase breaking changes: https://supabase.com/changelog?types=breaking-change
