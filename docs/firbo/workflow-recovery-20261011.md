# FIRBO workflow recovery — 11 October 2026

Master tracker: [Issue #52](https://github.com/conpol84/javris-clone/issues/52).
Implementation: [Draft PR #159](https://github.com/conpol84/javris-clone/pull/159), stacked on #158 -> #157 -> #156. Preserve this ancestry. No merge, production deployment, database mutation, paid inference, provider action or user-device command was performed for this checkpoint.

## Product contract retained

FIRBO AI is ONE personal JARVIS-style assistant across Chat and Voice. Existing Supabase tasks, workflows and metered agent-runner remain authoritative. VPS/OpenJarvis/OmniRoute are the permanent execution infrastructure; personal computers are optional authorized workers. This repair does not introduce a second CEO, task store, queue service or executor. TradeAthletes, PickFantasy and PlayersFX are out of scope.

## Changed

1. A workflow waiting for approval no longer advances to the next specialist or fails just because the human has not answered within the execution timeout. Explicit approval still uses the existing approval system.
2. A completed step needs a usable persisted result. Missing/empty/malformed output, reported errors, reconciliation flags, explicitly unsuccessful results and contradictory computer receipts do not become input to the next agent.
3. Transition uses a conditional UPDATE of the existing workflow run, matching tenant, run ID, current status, current step and old task ID. Only the winning scheduler creates the next task. The transition temporarily clears task_id; competing ticks wait. A lost acknowledgement is not replayed. An abandoned transition is marked review-required after the existing timeout.
4. Old pending workflow tasks are no longer blindly dispatched again after a few minutes. They require reconciliation because an absent response does not prove that a paid tool/model call never started.
5. Dispatch reads the existing task ledger after HTTP. A 2xx response alone does not mean a task completed. Saved running/terminal states survive a lost or malformed HTTP response.
6. Abandoned JARVIS one-shot dispatch claims can become blocked/review-required without executing again. Updates match exact owner, tenant, server origin, claimed timestamp/state, pending status, no runner claim and no existing result. Running work, saved results and accounting evidence are not overwritten. Zero affected rows are not logged as saved receipts.
7. Queue/read errors no longer masquerade as a healthy empty scheduler or deleted task. Reading may be retried; execution is not silently replayed.
8. The existing Chat/Talk task receipt helper now flags incomplete or contradictory terminal results for review. It preserves the saved status and uses existing translated labels, without new navigation or an invented second assistant. Saved report text means content is available, not that an external file was independently hashed.

## Evidence and limits

### Actual-handler tests

`tests/firbo/workflow-recovery.test.mjs` loads the actual Edge handler. Only Auth/SDK/HTTP are synthetic. Its SDK applies query predicates, conditional updates and row counts, including races and lost acknowledgements. It denies real provider/network access.

The initial 32-case test batch against unchanged #158 reproduced 26 failures and 6 passes. With the repair those 32 passed. The expanded current backend batch contains 35 passing local cases. Existing workflow lifecycle, Edge entrypoint, server execution, accounting/bundle and connected-app suites are also included in CI rather than replaced.

### PostgreSQL

`tests/firbo/workflow-transition-postgres.py` executes five conditional-update protocol checks in concurrent real PostgreSQL sessions: one winning transition, no lost-ACK replay, foreign-tenant denial, cancellation wins and preservation of existing execution/accounting receipts. It uses a minimal isolated schema and cannot run unless the dedicated synthetic/local database guards are set. This is a PostgreSQL protocol test, not a claim of full authenticated production E2E.

CI separately retains the original PR156 migration + RLS + one-shot queue fixture. No migration is applied to FIRBO by this workflow.

### Frontend

The shared task-result helper has normal pending/running/approval tests, personal identity checks and fifteen malformed/contradictory terminal-result cases. The whole frontend Vitest suite and TypeScript/Vite/Tauri build run in CI. Local direct Node checks of the helper are additional smoke checks, not a substitute for Vitest/build.

### Revision discipline

At intermediate commit `b24df475ab57da71f7e993fd8fb23b7eecb7d932`, workflow run `38105211616` completed all three jobs successfully: backend regressions, PostgreSQL protocol/original Autopilot SQL, full frontend tests/build. Later UI/test/documentation commits require their own exact-head CI verification. Use the final PR head and final Master Issue comment, not this intermediate result, for sign-off.

The dedicated workflow checks out `github.event.pull_request.head.sha` (or `github.sha` for pushes). Green CI is still not production acceptance.

## Important live-access correction

The connected Supabase `list_projects` response omitted FIRBO and returned only unrelated products. That omission is NOT proof of denied project access.

Direct `get_project("bfeinnsorgjycivozcau")`, `list_migrations`, `list_edge_functions` and read-only SQL succeeded in this session. The target is `javris-clone`, organization `nkkorsdiuntkyhxwnxmk`, ACTIVE_HEALTHY, PostgreSQL `17.11.0.002`, eu-west-1. No manual reconnection was needed. Do not query/mutate unrelated product databases as a substitute.

Read-only live reconciliation found:

- `20261009213234_sgmem01_private_memory_rls` and `20261010011341_cmem01_company_memory_owner_review` in the live migration ledger.
- PR156 migration `20261011004820_jarvis_server_autopilot` is NOT installed. Its settings table, admission RPC and claim RPC do not exist live yet.
- Live Edge metadata: workflow-runner v15, agent-runner v102, agent-chat v51, connector v41, integrations v37, computer-dispatch v5. Version numbers alone do not establish source-byte equality.
- Zero workflows and zero workflow runs at the read-only checkpoint. No production execution acceptance can be inferred from those empty tables.
- Both connector_devices and connector_jobs still have authenticated SELECT policies admitting owner/admin/manager at organization scope, without a personal creator predicate. PR153 application guards do not fix that database boundary. Personal device/job RLS is a separate required release gate.

No owner identity or device was reassigned. No queued/running user work was cancelled. No tokens or private provider contents were fetched for this checkpoint.

## Ordered next work — do not restart broad audits

| Priority | Master stage | Remaining deliverable / acceptance |
| --- | --- | --- |
| 1 | 0 / 9 | Final exact-head CI and source readback; implement and test personal device/job RLS against actual live columns and existing role policy. Preserve ownerless records without automatic reassignment. |
| 2 | 3 / 4 / 6 | Reconcile all pending SQL/Edge dependencies in an authorized isolated environment, then controlled backend-first rollout with rollback. Keep both JARVIS frontend/server flags OFF until the complete contract passes. |
| 3 | 1 / 2 / 3 / 4 | Authenticated CEO -> specialist -> existing metered runner -> existing VPS executor -> useful file -> independent readback/hash -> same task/conversation receipt. Close browser during execution; exercise Stop, lost ACK, restart, offline worker and accounting. Never claim artifact success from HTTP or report prose. |
| 4 | 5 / 9 | Actual per-user authorized provider reads and writes through existing Integrations adapters, delegated scopes, consent, refresh/revocation and provider receipts. Metadata inventory is not provider access. Existing non-manager self-service limitations remain. |
| 5 | 6 / 7 | One CEO identity and durable memory across new/resumed Chat and Voice sessions; real specialist delegation/result synthesis; real voice input/output and error recovery. Keep company memory review and private scope rules. |
| 6 | 7 / 8 | Whole-product JARVIS HUD page QA, all supported locales/RTL, reports/presentations and real mobile/device/audio performance. PR155 priority-page tests are not a completed audit of every page. |
| 7 | 10 / 11 | Encrypted database/config/volume off-host backups, isolated restore/runbook, alerts, load/concurrency/failure drills; two real users/tenants; source/schema/Edge/VPS/website parity and final useful-work acceptance before production-ready declaration. |

## Operational caveats retained

This release candidate intentionally chooses review over uncertain duplicate execution. It does not magically resume arbitrary interrupted side effects. A bounded stale-claim scan (20 rows/tick) skips malformed timestamps; those require operator investigation rather than guessed execution state. Running tasks remain governed by existing runner/claim/Stop/accounting reconciliation. A long approval wait is intentionally not an execution timeout.

No provider permissions are broadened, no task result is fabricated and no release flag is enabled by these code changes. The owner should not have to install an old standalone candidate patch: the actual integrated work is in PR159.
