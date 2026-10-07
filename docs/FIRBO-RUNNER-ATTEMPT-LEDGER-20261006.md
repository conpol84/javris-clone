# FIRBO runner attempt ledger — source candidate

Status: SOURCE CANDIDATE ONLY, 6 October 2026. No production migration,
Edge deployment, provider request, device job, permission or frontend release.

This stage continues `FIRBO-RUNNER-ACCOUNTING-DESIGN-20261006.md`. It combines
OpenJarvis receipt PR #30 head `1cfc4e3a8e80f0d2e95955b3507881fb03171a8b`
and accounting-rollover PR #31 head
`58a418861e660cdb83ca75772b0db27d7afa2d7b`. Both are parents of the local
candidate; neither active branch was rewritten. PR #31's final two pending
workflows were independently re-read and both succeeded.

## Changed

- Added CLI-generated migration
  `20261006154856_inference_runner_attempt_ledger.sql`.
- Added private, RLS-enabled, direct-access-revoked logical-run and attempt
  records. Task UUIDs deliberately have no FK so deletion cannot cascade away
  accounting evidence; agent deletion is restricted while evidence exists.
- Added service-role-only `firbo_reserve_runner_inference` and
  `firbo_begin_runner_dispatch` RPCs with an empty search path.
- Admission takes the shared company accounting lock, then agent and task. It
  validates current membership, enabled assigned agent, exact task claim,
  ordinal, payload SHA-256, route and output cap in one transaction.
- The plan's daily quota counts one logical runner claim, while hourly limits
  and the fixed 16-attempt ceiling count transport attempts. Free/BYOK remains
  zero Firbo cost but still consumes attempt capacity. Zero limits deny work.
- Only the atomic `admitted -> dispatching` transition grants transport
  permission. Duplicate delivery may reuse the same receipt but only one caller
  receives `dispatch_allowed=true`.
- Existing settlement/ambiguity/release RPCs synchronize the attempt state.
  Settlement before dispatch and release after dispatch fail closed.
- Task publication, cancellation, recovery and deletion are blocked while an
  attempt is admitted, dispatching or awaiting reconciliation. Settled and
  proven pre-dispatch released evidence remains after task deletion.
- Added a typed helper that canonicalizes/fingerprints payloads, parses the new
  receipts and reuses the shared settlement contract. The live runner does not
  import it yet.

## Tested / passed locally

- Five executable helper tests: canonical fingerprint, exact claim bindings,
  fail-closed admission, single-winner dispatch and shared settlement RPCs.
- Existing focused Edge entrypoint selection plus the new helper: 101 tests,
  zero failures.
- Strict Edge TypeScript passed, including the new helper.
- Ruff 0.16.7 check and format passed for the expanded concurrency suite.
- `pglast` parsed all 27 migration statements; Git diff whitespace check passed.

## PostgreSQL CI gates added

- ACL, RLS, fixed search path and table-retention assertions.
- Exact request-key/ordinal/payload idempotency and conflict assertions.
- Dispatch-before-settlement, release-before-dispatch and late-settlement rules.
- Logical-run versus attempt quota behavior and budget rollover compatibility.
- READ COMMITTED and SERIALIZABLE races for chat-versus-runner budget,
  duplicate dispatch and publication versus unresolved receipt.

These gates use PostgreSQL 17.6 in CI. This workspace has no PostgreSQL server,
so they are not claimed passed until the exact candidate head completes CI.

## Failed / limitations

- No local PostgreSQL runtime was available. Static parsing is not database
  execution and does not replace the exact-head CI gate.
- The live `agent-runner` still uses its legacy aggregate usage insert and
  preflight reads. The new adapter is not activated, so production behavior is
  intentionally unchanged.
- Image generation/vision, server tasks and potentially billed search are not
  covered by this model-attempt ledger. No full runner-spend claim is made.

## Remains

1. Pass exact-head PostgreSQL and full relevant CI, repair any real SQL/race
   failure without weakening assertions, and preserve both parent histories.
2. Adapt every `callModel` attempt: reserve, begin dispatch, settle or mark
   ambiguous; stop escalation after ambiguity; keep each retry/repair/polish
   attempt separate.
3. Remove the legacy aggregate usage insert only for adapted calls, then prove
   no duplicate request/cost counting with executable fake transports.
4. Add explicit image/vision/server/search accounting or keep each route named
   as unadapted. Add authorized read-only reconciliation monitoring.
5. Reconcile fresh live dependencies before any migration application or
   runner deployment. Do not apply this candidate migration yet.
