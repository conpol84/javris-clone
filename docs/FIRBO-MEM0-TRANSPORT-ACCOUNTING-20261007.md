# FIRBO Mem0 transport/accounting contract — 2026-10-07

## Changed

- Added a default-disabled source contract for preparing one authoritative FIRBO memory for a future Mem0 index write.
- Extraction and embedding are independent attempts with different request keys, payload hashes, reservations, dispatch transitions, settlements and receipts.
- Configuration requires explicit routes, models, token caps, embedding dimensions, HTTPS pricing evidence and a recent verification timestamp. Cost is computed from that configuration instead of trusting provider prose.
- Admission failure performs zero transport calls. Any unknown state after durable dispatch is reconciliation-required; there is no retry, fallback or release-after-dispatch path.
- Invalid extracted text or vectors are withheld from publication. This module deliberately contains no publication operation.

## Tested

- Executable fake-ledger and fake-transport cases cover disabled/malformed configuration, stale pricing, capability/dimension/token bounds, canonical payload identity, two separate successful receipts, denied/duplicate admission, unknown dispatch, transport failure, invalid usage, settlement ambiguity, invalid extracted text/vector and authenticated-context bounds.
- The dedicated workflow runs Node 22.22 tests and strict TypeScript 7.0.2.

## Passed

- Local exact results are recorded in the PR checkpoint after the final source is tested.

## Failed / limitations

- No Mem0 SDK/service/vector store is installed or called.
- No provider, embedding or extraction request is made; configured test prices are synthetic fixtures, not FIRBO production prices.
- No database RPC, migration, RLS policy, live consumer, indexing, deletion/correction job or atomic publication transaction is implemented.
- The contract does not prove an actual vector store's metadata-filter behavior, retrieval quality, installed bytes, private ingress/egress or provider invoice.

## Remains

1. Select and pin a supported self-hosted Mem0/vector-store bundle and verify its actual filter behavior against adversarial cross-company/correction/deletion/expiry cases.
2. Verify real extraction and embedding capabilities, dimensions, prices and token bounds; then add the required service-only ledger source/RPC in a separately reviewed migration.
3. Add an authenticated current-row reader and atomic publication/delete policy tied to the authoritative memory revision.
4. Provision private service ingress/egress, supervision and log suppression; verify installed bytes and harmless zero-customer-data receipts.
5. Compare retrieval quality with FIRBO's existing Memory/Knowledge path before any default-disabled live consumer release.

Official Supabase guidance reviewed for this source stage: pgvector filtered queries may return fewer rows with approximate indexes unless iterative search is used; RLS and grants must both enforce tenant access; vector dimensions must match the embedding model. No schema change is made here.
