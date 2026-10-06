# FIRBO inference accounting — stage 1 candidate

Reviewed 6 October 2026. This is a source and automated-test candidate, not a
claim that global accounting is complete or live.

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

This workspace has no PostgreSQL client or container runtime, so that database
gate must pass in exact-head CI before merge or any production migration.

## Release boundary

No SQL, Edge Function or frontend deployment has been performed by this
candidate. A safe eventual rollout must preserve this order:

1. publish clients (`frontend` and `channel-inbound`) that send `request_id`;
2. apply the new migration once;
3. deploy the matching `agent-chat`; and
4. verify exact deployed files, anonymous denial, a legitimate signed-in chat
   receipt and reconciliation state without manufacturing provider work.

If any step after the migration fails, keep the existing agent-chat live until
all callers send the request ID; do not deploy the new handler alone.

## Remains

- Move `agent-runner`, `mission-runner`, speech and every other inference route
  onto the same ledger with route-specific upper bounds.
- Add an authorized reconciliation workflow for `reconcile_required` rows and
  monitoring for stale reservations/overruns.
- Prove a real signed-in chat and provider cost receipt after coordinated
  release, then test a second real company. Synthetic PostgreSQL companies do
  not satisfy real-customer isolation.
- Complete Free entitlement, cross-route accounting and every other open master
  plan gate. Stage 1 is not the global ledger exit criterion.

