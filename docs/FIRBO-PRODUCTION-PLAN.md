# Firbo + OmniRoute — production unification plan

Owner authorization: continue from U1 and start implementation, 2026-10-03.
Working branch: `codex/firbo-unified-gateway`. Existing draft PR: #9, targeting
`claude/omniroute-engine`, not the old OpenJarvis `main`.
Starting head: `8c10f3a8b672bfceaa0c478fb4192ac9ff5badd2`.

## Product and safety rules

One existing Firbo frontend (`javris-clone/frontend` on Vercel), one identity and
company/task data system (Supabase), and OmniRoute as the model engine on the
existing Hostinger VPS. Separate deployments are acceptable; separate unlinked
identities, routing decisions and usage records are not the intended product.

Preserve all existing navigation and unrelated pages. No other sports-product
infrastructure is in scope. Do not replace production just because CI is green.
No new paid service, provider call, credential rotation, database migration,
agent-setting update, or Hostinger restart is authorized by an automated test.
This implementation does not require or request passwords/tokens in chat.

## Delivery stages and acceptance criteria

| Stage | Work | Acceptance / release gate |
|---|---|---|
| U1: Native controls | Existing candidate: Firbo login for native gateway administration, provider/model views and guarded simple-combo edits | Implemented in PR #9; real matching Hostinger backend still needs verification |
| U2: Shared text routing | One gateway selector/client for chat and tasks, selected-agent rollout, visible route traces, fail-closed budget reads, failure/persistence regression tests; dependency gate | Mocked handler tests and type checks must pass; no automatic production routing change |
| U3: Actual hosting and recovery | Identify authorized VPS, running code/images, exact preview origin and credentials by name only; isolated backend install; backup plus restore and rollback rehearsal | New frontend/backend contract and real account work together; restore succeeds; no wildcard preview CORS |
| U4: Full execution and accounting | Trace one bounded task/chat request through gateway; verify combo fallback; move mission planner/synthesizer and voice policy; durable per-company request ledger and atomic budget reservations | Actual gateway records correlate; no hidden direct-provider bypass; timeout/partial-write recovery does not duplicate work; provider costs reconciled rather than assumed |
| U5: Complete operations and screens | Native provider lifecycle/OAuth, key management, scoped usage/quotas; reconcile database migrations; fix MCP/scheduler findings; real-account/mobile/microphone/integration tests; monitoring | Page/feature matrix backed by evidence; second test company cannot access first company's data; fresh database rebuild and backup recovery succeed |
| U6: Production release | Reviewed dependency remediation, end-to-end pass, exact release manifest, controlled promotion and observation | Explicit go/no-go record; reproducible rollback; no unresolved launch blockers |

Every stage reports changed, tested, passed, failed, remains. Continue from the
latest checkpoint; do not restart the audit without a new concrete reason.

## U2 implementation in this changeset

- New server-only `_shared/gateway-routing.ts`, used by `agent-chat` and `agent-runner`.
- `FIRBO_TEXT_ROUTING_MODE` accepts `legacy` (default), `canary`, or `gateway`.
- Canary mode selects only server-configured agent UUIDs. It is not a substitute
  for tenant authorization: each handler first validates the user/cron identity,
  company membership and agent ownership with the existing checks.
- Selected requests make exactly one text-completion request to an allowlisted
  gateway origin. Provider fallback belongs to the OmniRoute combo; the legacy
  direct-provider fallback loop is not entered for those requests.
- Explicit direct-provider model selections are NOT silently remapped. Migrate
  them intentionally after reviewing the gateway catalogue.
- Valid HTTPS origin/base path, inference credential, allowlisted model, and
  explicit finite nonnegative estimated cost rates are required. A known equal
  management/inference key is rejected; actual gateway key scopes still need a
  live permissions check.
- Response size is bounded while reading, JSON/text/usage shapes are checked,
  redirects rejected, and cancellation/deadline applies through body reading.
- Trace includes a server-generated request ID, requested routing profile,
  upstream-reported model when valid, outcome and elapsed time. It never contains
  gateway credentials, provider error bodies, prompts or model answers.
- The trace deliberately marks internal gateway fallback `unverified`. A model
  name differing from a combo name does not prove fallback occurred. Gateway
  retention of `x-request-id` must be verified on the deployed version.
- Task results persist this trace; both handlers emit structured scoped log
  entries and return the trace. No new database columns or migration are added.
- Cost remains an explicit configured ESTIMATE, not a provider invoice. Missing
  usage fails with a reconciliation requirement; it is not counted as free.
- Budget-query failures stop inference. Failed usage/message/approval/result
  persistence is not presented as a successful completed task. Ambiguous task
  outcomes require reconciliation before rerunning through this handler.
- Existing proposal/approval and scheduled-shift authentication paths are kept.
  The task web timeout now clears its timer and aborts remaining fetches.
- New advisory workflow reports all dependencies and production-only scope and
  exits nonzero on high/critical findings. It never runs `npm audit fix`.

## Configuration for a future isolated canary — NOT applied

Set server-side in the candidate Supabase environment only, after validating
against the actual deployed gateway. Never use VITE_* names for these secrets.

| Name | Purpose |
|---|---|
| FIRBO_TEXT_ROUTING_MODE | `legacy` until deployment gates pass; then `canary` for selected agents |
| FIRBO_GATEWAY_CANARY_AGENTS | Comma-separated verified agent UUIDs; empty selects nobody |
| FIRBO_GATEWAY_ORIGIN | Exact trusted HTTPS origin; default `https://gateway.firboai.app` |
| OMNIROUTE_BASE_URL | Matching origin with optional `/v1`; normalized to one `/v1` |
| OMNIROUTE_API_KEY | Inference-only credential, never a management/browser key |
| FIRBO_GATEWAY_DEFAULT_MODEL | Default `firbo-economy` for agents set to `auto` |
| FIRBO_GATEWAY_ALLOWED_MODELS | Default `firbo-economy,firbo-quality`; explicit operator allowlist |
| OMNIROUTE_PRICE_IN_PER_M / OMNIROUTE_PRICE_OUT_PER_M | Reviewed estimate rates; missing rates block selected requests |

No values have been changed by this stage. Rollback of routing selection is to
`legacy`; do not retry ambiguous requests until their gateway outcome and costs
are reconciled. Old functions and their exact deployed versions must also be
captured before deploying any replacement.

## Verified locally in U2

- 43 shared gateway selection/transport/timeout/validation tests passed.
- 40 tests of the actual chat/task handler source passed using mocked SDK/auth,
  database and inference transport. Includes valid cron identity, wrong-secret
  rejection, company checks, budget failures, no direct fallback, approval rules,
  legacy compatibility and persistence failures.
- Existing 26 U1 Python/ASGI tests passed.
- Isolated strict TypeScript check passed, using an explicitly labeled SDK stub.
  This is not a full Deno + real SDK type/runtime integration check.

GitHub CI and registry advisory results will be recorded separately after the
changes are committed. These tests performed no real provider call or DB write.

## Open blockers and limits

Hostinger execution access remains unavailable. The existing backend candidate
has not been deployed there, and no real gateway completion has been verified.
Do not promote the preview alone; its native controls need the matching backend.

U2 does not claim full unification: mission planner/synthesizer, audio STT/TTS,
legacy Python inference/playground paths and external integrations still need
consolidation or an explicit approved exception. `gateway` mode applies only to
the two handlers changed here. The `legacy` branch deliberately preserves prior
routing and therefore still needs its own security/compatibility review.

The existing database schema has no durable per-request usage/retry ledger. Task
markers and structured logs are interim safeguards, not atomic exactly-once
accounting. Customer-writable fields/RLS and concurrent requests require a
separate server-owned ledger and budget reservation design before public launch.
Gateway failures may still incur provider costs: reconcile before retrying.

Baseline U1 CI reported 13 dependency advisories (9 high). The current registry
report must be reviewed before claiming those counts are resolved. Repository
visibility was previously public, contrary to the old handover; it is unchanged.
Migrations, key rotation, MCP, shifts, backups and monitoring remain tracked in
the previous audit and U1 verification record.

## Documentation consulted

- Supabase Edge Function environment variables: https://supabase.com/docs/guides/functions/secrets
- OmniRoute architecture: https://github.com/diegosouzapw/OmniRoute/wiki/Architecture
- Own repository/function definitions and the read-only live table-column check.
- Supabase changelog markdown fetch was attempted but the web reader rejected
  its markdown content type; no changelog review success is claimed.
