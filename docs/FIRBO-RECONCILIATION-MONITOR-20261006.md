# Read-only inference reconciliation monitor — 6 October 2026

## Changed

- Separate candidate preserves exact PR38 `21a9c7ad` and newer PR30 `ad12f115`
  as merge parents. PR39 design remains separate. No contributor is rewritten.
- Adds an operator CLI for a single explicitly selected organization. It uses
  existing libpq PG* / private pgpass authorization; no DSN/key/password argv,
  web endpoint, table grants, schema change or customer access is added.
- One repeatable-read, read-only transaction reports pending count/reserved
  liability across all months, reconciliation-required/stale counts, platform
  settlement totals per UTC month, Free/BYOK request counts through the settled
  count, and a bounded oldest-first request-ID/status/age list. Actual missing
  settlement costs are separately flagged, not silently certified as zero.
- It never retries providers, releases reservations, repairs rows or settles
  costs. Diagnostic age is not expiry or proof that a request can be released.
- Query timeout, no-password prompt, psqlrc disabled, suppressed database error
  text and explicit read-only receipt validation. No prompts/model names/request
  keys/payload hashes/reconciliation prose/customer secrets are emitted.

## Tested / passed locally

- Five executable offline process-boundary tests (bounds/injection, command,
  scoping/contents, safe errors and fail-closed receipt).
- SQL-only generation, Ruff 0.16.7 and Git diff checks. No connection/provider call made.

## Failed / limits

- This runtime has no local PostgreSQL. Actual PostgreSQL 17.6 remains an
  exact-head CI gate, not a local passed claim.
- The database operator must already be authorized to read the private ledger.
  Existing anon/authenticated/service_role cannot read it and are not granted
  access. This is an operator diagnostic, not the final admin/customer UI/API.
- No live query, migration, deployment, provider call, task/device operation,
  permission change or automatic reconciliation occurred.

## Usage after acceptance

With an existing authorized private database connection, run:

```sh
python3 tools/firbo-accounting-monitor.py --organization <organization-uuid>
```

Use `--sql-only` to inspect without connecting. Never put a password or URL into
shell arguments. `--limit` is 1–200; `--stale-minutes` is 1–10080 (default 60).
An unavailable/unauthorized/malformed query fails closed with a generic message.

## Remains

- Require CI proving cross-month unresolved rows, monthly settled costs,
  company isolation, Free/BYOK counts, full totals despite detail cap, empty
  company, denied private access and before/after ledger digest equality.
- Later add an authorized company/admin RPC/handler/UI with explicit role and
  tenant gates; do not expose this private SQL or privileged connection publicly.
- Server-execution accounting, egress/SSRF closure and combined release/live
  schema reconciliation; real VPS/Mac/provider/customer/recovery acceptance.
  FreeLLMAPI stays installed; PR13 stays CI-only. Master plan remains open.
