# Agent-runner accounting: bounded next implementation stage

Status: DESIGN ONLY. Reviewed 6 October 2026 against shared source
`f6442b754eb26019c16f4aa40c50a15d6e73c14b` (PR #27). No runtime,
database, provider, device, or deployment changes accompany this document.
Historical Codex parity head remains `ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a`.
Direct-session FreeLLMAPI installation takes priority and is outside this stage.

## Source findings

The shared runner includes Claude's v88 work. The existing ledger accepts only
agent-chat and mission-runner. Widening the TypeScript source union alone would
not enable agent-runner: the SQL constraint and reservation RPC also reject it.

The runner currently reads aggregate usage before claiming the task, then writes
aggregate usage after model work. These preflight reads are not atomic admission
against parallel chat, mission, or runner spend. Its call counter counts logical
loop operations rather than every transport attempt. Neither counter is a safe
idempotency key or billing receipt.

| Source path | Accounting consequence |
| --- | --- |
| `callModel`: Free, gateway, direct/BYOK | Reserve and settle at the transport attempt boundary |
| `callOnce`: unusable-response retry | A valid provider response can be billable even if its text is unusable |
| `callLoop`: economy-to-quality escalation | The first timeout may have spent money; a second route needs separate admission |
| `finishCutOff`, JSON repair, polish | Each actual request needs its own receipt; preserve existing time limits |
| `analyze_image` | Separate model call outside callModel; currently adds tokens/cost to the aggregate |
| `generate_image`, `server_task`, gateway search | Separate execution paths; no claim of complete runner cost coverage until their contracts are reviewed |
| `publish_task_run` | Claim-bound result/approval publication; must remain the sole publication authority |

Sources: `supabase/functions/agent-runner/index.ts`, `_shared/agent-loop.ts`,
`_shared/inference-accounting.ts`, migrations `20261006081517`,
`20261006092215`, `20261005222500`, `20261006010000`, and `20261006023507`.

## Proposed database contract

Add a new migration; do not edit or replay the applied migrations. Keep existing
chat/mission call signatures and permissions compatible. A runner-specific
service-role-only admission RPC must validate the current company, actor,
assigned enabled agent, task status and run_claim in the same transaction as
reservation. Merely calling the generic RPC after a separate task read is not
sufficient. Add durable private task/claim/attempt bindings with uniqueness on
the company, task, claim and attempt ordinal. A request key cannot be reused for
another agent, actor, claim, route or payload fingerprint.

Use server-generated UUID keys persisted before dispatch. Concurrent delivery
of the same attempt must return its existing receipt without permission to call
the provider again. A crash after admission must not be recovered by allocating
a fresh key. A fresh task claim cannot bypass unresolved spend from the prior
claim. Retain evidence when tasks are deleted; select the retention/FK behavior
explicitly rather than cascading away outstanding reservations.

The common company accounting lock must serialize runner admission with chat
and mission admission. Preserve the existing company-before-agent accounting
lock order. Review all task/approval/connector lock paths before introducing
task locks: claim/publication and connector operations use different existing
paths. Do not nest publication inside admission or hold a transaction across a
network call. Prove the complete lock graph with real PostgreSQL cancellation,
claim, publication and admission races before adopting the new order.

Settlement must still be allowed for a request sent before cancellation or
membership revocation: rejecting its receipt would hide real spend. This does
not permit further inference, task publication, or device work. Those operations
must recheck current authorization and claim ownership.

## Attempt lifecycle and bounds

1. Claim using the existing task protocol. Build the bounded request and select
   the exact route with current permissions. Count every transport attempt,
   including retry, escalation, repair and continuation.
2. Admit the attempt atomically and persist its payload fingerprint, requested
   route, output cap and conservative reservation. Do not store prompts or keys
   in accounting logs. Use a bounded server-owned attempt ceiling in addition to
   existing wall-clock and loop limits; derive its chosen value from the complete
   retry graph and test normal reports, slides and repairs before activation.
3. Persist a dispatch transition guarded by the claim. Dispatch at most once.
   Database dispatch and provider execution are not one transaction; a crash
   between them is uncertain unless a supported provider idempotency/receipt
   contract proves the outcome. Do not advertise exactly-once network execution.
4. Settle each response atomically into its own linked usage event, even if its
   content is unusable. Keep provider-reported and estimated cost distinguishable.
   Reject malformed or missing required usage instead of inventing verified zero.
5. On an uncertain transport/receipt/settlement outcome, retain the reservation,
   mark reconciliation required and prevent further spend/approvals for that run.
   Release only when the durable state proves no dispatch occurred. A zero-cost
   Free/BYOK route still consumes request capacity and can have an uncertain result.
6. Aggregate the run's settled receipts for the report. Remove the runner's legacy
   aggregate usage insert for adapted calls, otherwise both money and request
   counts are duplicated. Do not remove accounting for any unadapted tool route.
7. Publish with the original claim through publish_task_run. Settlement success
   followed by publication failure must never reissue inference or double-charge.
   Preserve useful report material as blocked where the existing protocol allows;
   never overwrite a newer run or synthesize device acknowledgements.

Reserve using the actual capped payload and route rates. OpenAI direct currently
allows 8000 output tokens, while other direct/gateway requests use 4000. A single
constant would under-reserve OpenAI. Free/BYOK need zero FIRBO cost plus an attempt
count, not an exemption from admission. OmniRoute/FreeLLMAPI internal fallbacks
require a bounded aggregate receipt or worst-case reserve contract; an outer
HTTP request is not proof that only one upstream request occurred.

Preserve BYOK's single-provider rule. Preserve economy/quality routing, the
remaining-time report budget, research retention and current AppleScript approval
behavior. Continuing automatically after an ambiguous timeout is incompatible
with fail-closed accounting: retain the research and report a blocked outcome;
allow escalation only after the previous attempt's cost/outcome is resolved.

Quota semantics need an explicit compatibility decision before runtime release.
The ledger counts inference attempts; the old runner records one aggregate row
per run. Applying HOURLY_RUN_LIMIT=20 per attempt can shorten multi-step tasks.
Keep task-run counts and inference-attempt counts distinguishable, verify product
plan semantics, and do not silently raise allowances or relabel calls as runs.
Preserve the plan-derived daily cap and SQL maximum 100000; zero denies admission,
and invalid limits fail closed. Do not restore the old fixed daily default 100.

## Required gates before candidate release

| Layer | Required assertions |
| --- | --- |
| Real PostgreSQL | Concurrent chat/mission/runner admission cannot exceed a shared budget or quota; both READ COMMITTED and SERIALIZABLE |
| Identity/idempotency | Duplicate delivery sends once; wrong company, actor, agent, task or stale claim fails; ordinal/payload conflict fails |
| Task lifecycle races | Claim, cancellation, reassignment, deletion and publication cannot admit stale work or deadlock; late receipts remain recordable |
| Handler execution | Inject fake transports and count dispatches; reservation failure, malformed RPC and duplicate response yield zero dispatches |
| Retry graph | Unusable paid reply settles; resolved escalation admits separately; uncertain timeout stops; repair/polish each get receipts |
| Failure recovery | Lost admission/settlement/publication response cannot double-spend; no release after dispatch; unresolved attempts block replay |
| Quotas | Free/BYOK consume counts with zero FIRBO cost; legacy events counted once; no extra aggregate event; plan and zero-limit behavior |
| Tools | Vision/image/server/search coverage stated explicitly; no full-coverage claim for callModel-only adaptation |
| Permissions | Private RLS, empty search_path and service-role RPC grants retained; no broader device or customer server permissions |
| Regression | Claude's report retention, quality routing, desktop approval behavior and Codex's claim-bound job guards remain |

Extend `tests/firbo/accounting/postgres-assertions.sql`,
`mission-assertions.sql` and `postgres-concurrency.py`; add executable runner
handler tests, not just source-string checks. Existing frontend accounting tests
do not certify this backend. Run current task/connector protocol gates too.

## Reconciliation monitoring scope

Start with a server-side read-only, paginated report of unresolved reservations:
company, task/claim, receipt ID, age, reserved amount, safe reason and route.
Authorize current company roles on every request; platform-wide visibility must
use existing platform-admin authorization. Do not expose private tables or
service credentials. Avoid prompts, keys and raw provider error bodies.

Distinguish stale pre-dispatch records, ambiguous dispatched requests,
settled-overrun receipts and settled receipts missing a published task result.
An alert must not trigger another provider request or clear a reservation.
Actual settlement/release requires authoritative evidence and an audited,
idempotent decision. Retention or a month boundary is not evidence of zero spend;
the existing month-filtered reservation query needs explicit rollover tests.
External notifications require approved destinations/content.

## Stage checkpoint

- Changed: this design and acceptance matrix only, on an isolated branch based on
  PR #27. No edits to the concurrent installer or shared runtime.
- Tested: source/contract review at the exact base; document references and Git
  diff checks. No new executable runtime or PostgreSQL acceptance is claimed.
- Passed: identified every main model retry path, the separate image paths, the
  source allowlist barrier, legacy aggregation and task-claim publication boundary.
- Failed / limits: no new provider, signed-in account, Mac, VPS or live-function
  verification. Proposed admission/dispatch/monitoring contracts are unimplemented.
- Remains: implement the schema-bound adapter and tests in a separate candidate;
  reconcile all current live dependencies and migration identities, pass the
  combined exact-head gates, then release. Do not redeploy an older runner.

Direct-session reports already reconciled mission-runner v28 and corrected the
Mac updater through PR #26; PR #27 supplies the non-root FreeLLMAPI installer.
Those source changes are present here, but no new production assertion follows
from this design review. Host installation, provider keys, real OmniRoute calls,
Mac acceptance and the broader master plan remain independently gated.
PR #13 remains CI-only and must never be merged.
