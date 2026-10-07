# FIRBO server-execution accounting — 6 October 2026

## Changed

- Separate source-only candidate continues exact PR40 `5360e576`, which already
  preserves PR38 accounting and current PR30 `ad12f115`. Active contributor
  branches are not rewritten; PR39 design remains separate.
- The agent-runner OpenJarvis `server_task` chat request now uses the existing
  claim-bound runner attempt ledger: exact payload fingerprint, conservative
  reservation, single durable dispatch transition and atomic settlement.
- A ledger request ID is sent as `x-firbo-request-id`. Admin and customer
  sandbox routes remain distinct (`openjarvis:admin` / `openjarvis:sandbox`).
- Settlement requires bounded aggregated token usage and a valid reported model
  from the server. Missing or malformed post-dispatch usage is retained as
  `reconcile_required`; no automatic retry, fallback or task publication occurs.
- Release configuration must explicitly provide input/output price per million
  tokens and a maximum output-token bound. Explicit zero rates are allowed for a
  verified self-hosted/no-metered-fee route. Missing or blank bounds disable the
  tool instead of allowing an unaccounted request.

## Tested / passed locally

- Focused real-entrypoint tests use executable fake database/server transports;
  no provider or VPS request is made. They prove successful reservation,
  dispatch correlation and settlement, customer/admin isolation, exact cost,
  denied-admission zero dispatch, missing-usage ambiguity, no publication after
  ambiguity and fail-closed missing pricing.
- Shared receipt parser tests cover valid aggregate usage, malformed models,
  negative/infinite/unbounded token or rate values and zero-rate support.
- 113 combined server/actual-entrypoint tests pass. The focused server selection
  passes 10 cases; all 627 non-rendered FIRBO Node tests also pass.
- All 528 frontend tests, strict isolated Edge/full frontend TypeScript,
  production frontend build and Git diff checks pass. Existing large-chunk build
  warnings are unchanged; no frontend source changed in this stage.

## Failed / limits

- No local PostgreSQL exists. This stage adds no schema or migration: it depends
  on the already source-tested, not-live runner attempt ledger in its parent.
  Exact-head CI must still run the existing PostgreSQL 17.6 lifecycle/race gate.
- Token cost uses explicit server-route price configuration and the server's
  aggregated token receipt. It does not claim independent provider invoice
  reconciliation or infrastructure/GPU-cost accounting.
- The operator-only reconciliation monitor in PR40 is not a customer/admin UI.
  No live query, migration, deployment, provider call, VPS/Mac/device job,
  permission or secret change occurred.

## Remains

- Publish an isolated draft and require every exact-head workflow, including
  server fake transports and PostgreSQL lifecycle/races, before release review.
- Re-read live dependencies, applied migration identities and pricing/source
  configuration before any combined migration or runner deployment.
- Network-pinned egress/SSRF closure, authorized customer/admin reconciliation,
  provider invoice checks and all prior real VPS/Mac/account/customer/restore/
  monitoring gates remain. FreeLLMAPI stays installed; PR13 stays CI-only.
