# FIRBO inference accounting — stage 1 release

Released 6 October 2026. This is not a claim that global accounting is complete
or that real signed-in/provider acceptance has been performed.

## Changed

- `agent-chat` now requires a client-generated UUID for each turn. The web app
  and the existing inbound channel bridge create it before invoking chat.
- A private request ledger reserves a conservative maximum cost before any
  provider request. A private per-company lock serializes the company daily
  limit; the agent row serializes its hourly and monthly limits.
- The estimate uses at most one input token per UTF-8 byte, the actual configured
  input/output prices and every direct fallback that may be attempted. Free and
  company-owned-key requests reserve $0 but still consume request-rate quota.
- Settlement writes the `usage_events` row and resolves the reservation in one
  database transaction. The usage row is unique per ledger request, so a lost
  response cannot create a second charge record.
- Provider failures keep the reservation in `reconcile_required`; known local
  failures before a provider call release it. An actual cost above the estimate
  is stored honestly as `settled_overrun` and logged rather than hidden.
- The table and all four `SECURITY DEFINER` RPCs are denied to `PUBLIC`, `anon`
  and `authenticated`; only `service_role` can execute the RPCs. Functions pin
  an empty search path and schema-qualify every relation.

## Tested / passed locally

- 92 actual `agent-chat` / `agent-runner` handler tests with mocked database and
  provider transports, including reservation, duplicate suppression, failure
  reconciliation, pre-provider release and atomic-settlement response parsing.
- 561 non-rendered FIRBO Node tests.
- 490 frontend tests, including the browser client request UUID.
- Strict Edge TypeScript and the frontend production build.
- `git diff --check` and Python syntax for the PostgreSQL race harness.

## PostgreSQL acceptance gate

The workspace lifecycle workflow adds a real PostgreSQL 17 target that loads the
actual migration and checks:

- function/table ACLs;
- budget admission with active reservations;
- idempotent reservation and settlement;
- one usage row per request;
- zero-cost Free/BYOK semantics;
- fail-closed ambiguous results and visible estimate overruns;
- company/agent binding and hourly limits; and
- simultaneous 75-cent reservations against a $1 budget under both READ
  COMMITTED and SERIALIZABLE isolation.

This workspace has no PostgreSQL client or container runtime. Exact-head CI run
`37436471240` supplied independent PostgreSQL 17 evidence and passed the actual
migration, assertions and all four races before merge or production migration.

## Released evidence

- PR #23 merged with both histories preserved at
  `fe9de7b257fc9e48c44cf0b8c1dfe0ae5c326a50`; the accepted source tree is
  `009cdba5d9def9cecc4d03580ff0e6334fb85353`.
- The safe order was preserved: compatible web/channel callers, migration once,
  then the matching chat function. The migration ledger is `20261006083523`.
- `channel-inbound` v9 and `agent-chat` v38 are ACTIVE. Every deployed chat file
  matches accepted source exactly. Anonymous chat POST returns HTTP 401.
- Vercel deployment `dpl_EKo9oCXqxyCZpSQpjzxQUBHUQbqp` is READY from the
  accepted PR head with `withLatestCommit:false`; `firboai.app` serves the new
  caller and its deployment-scoped 30-minute error/fatal scan is empty.
- Post-release catalog checks show zero ledger/usage rows, direct table access
  denied to anon/authenticated/service_role, RPC execution limited to
  service_role and empty function search paths.

No legitimate signed-in chat was invoked for release verification. Therefore the
real provider cost receipt and reconciliation state remain acceptance gates, not
inferences from served source or CI.

## Remains

- Move `agent-runner`, `mission-runner`, speech and every other inference route
  onto the same ledger with route-specific upper bounds.
- Add an authorized reconciliation workflow for `reconcile_required` rows and
  monitoring for stale reservations/overruns.
- Add covering indexes for the ledger's `(organization_id, agent_id)` and
  `user_id` foreign-key paths; Supabase reports these as performance follow-ups.
- Prove a real signed-in chat and provider cost receipt after coordinated
  release, then test a second real company. Synthetic PostgreSQL companies do
  not satisfy real-customer isolation.
- Complete Free entitlement, cross-route accounting and every other open master
  plan gate. Stage 1 is not the global ledger exit criterion.
