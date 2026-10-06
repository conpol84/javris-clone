# Accounting continuation: unresolved month-boundary exposure

Status: isolated candidate, not applied to production. This is a prerequisite
from the accepted runner design, not the completed runner adapter.

Published draft: https://github.com/conpol84/javris-clone/pull/31 on
`codex/firbo-accounting-rollover-20261006`. Initial remote implementation head
`a35901b95c3f37bcc917dc245b155d4cec5b62e6` has the identical tree
`568cd1629deb5791dab73c8a19aabaf3fbb1bd75` to local `a2de7472`.
All five changed files were read back byte-for-byte. The PR initially targeted
PR #29's branch; it now targets the shared Claude branch used by the repository's
full CI. No merge is authorized by that target change. Remote workflows had not
started at the initial readback; their absence is not a test pass.

## Current activity and preservation

Read on 6 October 2026: shared Claude remains
`f6442b754eb26019c16f4aa40c50a15d6e73c14b`; remote Codex parity remains
`ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`.
PR #29 is still draft/open at `fd9ebd4c542ba945c8ff4237ac847ea5bea46b30`,
tree `ac91d7cec9ee4bba53a0b23a5832102bec23b7a7`, identical to local
`68fe576b6cc4860af274b7bfd52b41a21a6b22f5` used as this candidate's base.
All seven PR #29 workflows now completed successfully at that exact head:
37473349144, 37473349277, 37473349161, 37473348932, 37473349036,
37473349370 and 37473349115. This does not certify a real provider or device.

The direct session is preparing OpenJarvis execution receipts in separate
`codex/firbo-server-receipts-20261006`, observed local head `d1d98613`.
It modifies runner/server/UI paths; this stage modifies none of those files.
That work is now draft PR #30, first observed remote head `ee2c8044`;
the direct-session local branch has since advanced to `c0cd0e4b`. Do not assume
the first remote receipt candidate is the final release source.
Preserve and reconcile that work before any combined release. Leave FreeLLMAPI
installed until its replacement as the owner requested. PR #13 stays CI-only.

## Changed

- New CLI-generated migration `20261006144554_inference_reservation_rollover.sql`
  replaces only `firbo_reserve_inference`. Existing applied migrations remain
  untouched and must never be replayed against production.
- Outstanding `reserved` and `reconcile_required` amounts count regardless of
  creation month. Previously those liabilities silently fell out of the budget
  when the UTC month changed.
- Settled usage still counts in its recorded UTC month. Pre-dispatch releases
  cease reserving budget. The existing RPC signature, chat/mission source
  allowlist, organization-before-agent locks, quotas, RLS and grants are unchanged.
- No agent-runner source admission, pricing change, automated reconciliation,
  background dispatch, provider call, device job or migration application.

## Tested / passed

- Local source comparison proves the only functional admission change is removal
  of the creation-month predicate on unresolved reservations.
- Existing private partial index `(agent_id, created_at) WHERE status IN
  ('reserved','reconcile_required')` supports the agent-scoped open-liability scan;
  no new index or table is required.
- CI now first runs the regression on the previous function and requires the
  specific `rollover lost unresolved liability` failure, then applies the new
  migration in disposable PostgreSQL and requires it to pass.
- New regression matrix: 16 timezone/status/old-source/new-source combinations,
  exact budget equality, denied-request no-write behavior, late/duplicate
  settlement, resolved old usage, pre-dispatch release, Free/BYOK rolling quotas,
  service-role-only RPC access and empty search_path.
- Existing six accounting races are retained; six more cover old reserved and
  ambiguous liabilities plus old-reservation settlement under READ COMMITTED
  and SERIALIZABLE. Serialization failures are safe denials, not dispatch retries.

## Failed / limitations

- PostgreSQL is not installed in this execution workspace. Executable database
  assertions and races must pass in the existing PostgreSQL 17.6 CI service before
  acceptance; local source/lint checks alone are insufficient.
- This candidate's remote CI is pending at authoring. The PR #29 green results
  above belong to its parent, not this migration.
- No production state or live bundles were reread in this bounded source stage.

## Remains

Record this candidate's exact head and final PostgreSQL/CI outcome. Reconcile any
new direct-session/Claude changes, inspect applied migrations and release only
after the appropriate combined-source gates. No backend redeploy is needed for
this source candidate alone.

Continue PR #28's claim-aware runner implementation: task/claim-bound admission,
durable dispatch and ambiguity, logical-run versus attempt quota semantics,
retry/repair/polish/vision/image/server/search accounting, including Tavily,
duplicate legacy-event removal, cancellation/publication races, safe monitoring
and executable fake-transport handler gates. This patch closes only the common
month-rollover reservation gap; it does not complete those contracts.

Mac approval/acknowledgement, real provider receipts, OAuth, second customer,
restore, monitoring and every other master-plan acceptance gate remain open.
