# FIRBO integrated release — 6 October 2026

**Read the final LIVE entry below. Earlier sections are the authoring checkpoint;
their pending schema, CI, graphics and VPS statements have been superseded.**

Owner instruction in the direct session: complete the agreed work, preserve both contributors, retain every outstanding gate and remember the decisions across sessions. Continue the master plan; never merge CI-only PR13.

## Current accepted inputs

- Claude: f6442b754eb26019c16f4aa40c50a15d6e73c14b.
- Codex parity: ce421e3121f49b0ba0aa6ea8cc0a2ad69a7a7a6a.
- PR30 runtime: 39645cec5bf5b7954c212e3e8bf49ef2a55c3454, all nine current workflow families successful.
- PR39 graphics: 9167cf4b26a99450f74fab72e6c6b570b142cbd5, all nine workflows successful.
- PR43 accounting/egress: 05e890422aa0ae2e3542c964b8e5fa9487301de5, all eleven workflows successful.
- Both newer input branches merged with separate parents and no conflicts into codex/firbo-integrated-release-20261006. No branch overwritten.

## LIVE: month rollover fix completed

- Production project bfeinnsorgjycivozcau was queried directly. The old function still filtered unresolved costs to their creation month.
- Applied the exact accepted PR31 SQL once, with atomic guards against a changed live function or an existing migration of the same name.
- Live migration identity: **20261006205256_inference_reservation_rollover**.
- Source fixture: supabase/migrations/20261006144554_inference_reservation_rollover.sql. This is the same semantic migration: **do not replay it under the older timestamp**.
- Read-back confirms the unresolved-month filter is removed, settled monthly accounting remains, empty search_path remains, and anon/authenticated cannot execute while service_role can.
- Real database regressions ran inside exception-backed subtransactions. Prior-month reserved and reconcile_required liabilities both denied new spending above the budget. Forced subtransaction rollback restored every temporary budget/ledger change. Complete ledger and agent-budget digests before/after matched.
- Production had 24 settled inference records and zero unresolved records at this check. The live code bug was present, but this check did not find an actual outstanding old-month charge or establish provider invoice totals.
- Security Advisor remained unchanged: six intentional RLS/no-policy INFO tables, eight existing authenticated-definer WARN findings and one existing leaked-password WARN. No new finding from this replacement.

## Combined local verification

- Frontend: 537 tests passed, TypeScript and Vite production build passed.
- Engine/runtime: 62 runtime repair cases and 32 engine contract cases passed in the existing isolated dependency environment.
- Pinned MCP: 17 tests passed, including synthetic real local TLS deadlines.
- Ruff: all checks passed; 1446 files already formatted.
- Strict Edge TypeScript passed.
- Initial Python run used an environment missing fastapi; re-run with the existing complete isolated environment passed.
- Initial rendered browser run lacks the Playwright Chromium executable. Do not weaken assertions; require real Chromium in the exact-head CI. Non-rendered Node result recorded after completion.
- Final combined-head CI, preview acceptance and production releases are recorded in subsequent entries; parent CI is not combined acceptance.

## Current production reconciliation

Fresh firboai.app read resolved to production dpl_DpTKgffcbmnYj3At3xJh9jSnJQRR, source PR43 05e89042. This supersedes the earlier PR30 frontend identity; do not roll back its source accidentally.

Complete deployed files were read before any function deployment:
agent-runner v90 (13 files), agent-chat v38 (8), mission-runner v28 (4), server-jarvis v14 (3). Candidate relative imports were independently traversed. The runner additionally needs inference-accounting.ts and runner-inference-accounting.ts.

Runner attempt schema is absent at this checkpoint. Server pricing/output bounds have not been verified. MCP pinned service is not provisioned. No live runner/MCP cutover is accepted merely because the combined frontend builds.

## Ordered remaining acceptance

| Work | Required next evidence |
|---|---|
| Runner accounting | Apply the reviewed additive ledger once; deploy exact dependencies only after pricing/output configuration is verified; reject unbudgeted calls; independent provider usage/invoice checks |
| Chat/mission/shared bundles | Exact-source dependency read-back, anonymous denial and authorized acceptance |
| MCP service | HTTPS ingress, origin allowlist, dedicated credential, supervised installation and harmless approved real MCP call before MCP deployment |
| VPS actual execution | Install current guarded temperature workaround on both existing services; exact native tool receipts; useful file plus read-back and receipt |
| Paired Mac | Update existing Connector without re-pairing; local consent, click/fill/scroll/read/snapshot/upload/download, Stop and offline tests |
| Business acceptance | CEO -> meeting -> delegation -> useful result; Knowledge ingestion/retrieval, Skills, Workflows and approvals |
| Provider connections | Real Google/Microsoft consent/refresh/revoke; authorized channel destinations/content; no fabricated connected states |
| Cost monitor | Authorized operator use; admin/customer UI; unresolved liabilities remain reserved until evidence resolves them |
| Customer isolation | Real second customer across data, roles, routes, artifacts and devices |
| Design/voice/mobile | Publish verified graphics controls; complete reference composition, real mobile, language/voice/media checks and performance |
| Operations | Encrypted off-host backup, isolated restore that boots, monitoring, load and rollback rehearsal |
| Final assessment | Evidence-based completed/failed/unverified inventory and production assessment |

External components: preserve Mark-LV as functional/visual reference without copying noncommercial code/assets. TalkingHead, Pipecat and whisper.cpp remain evaluation candidates, not installed integration claims. Existing Playwright remains the browser execution basis. Keep FreeLLMAPI installed. OS microphone/consent and unavailable VPS terminal access remain real owner actions, not synthetic acceptance.

## Final LIVE identities and acceptance

Changed:
- PR44: https://github.com/conpol84/javris-clone/pull/44 (merged).
- Accepted runtime source: `d30b24742bd02271526f735b56f1d83558559286`;
  combined tree: `396ffae7870d60294a083b5e88bb5583a811bf41`.
- Shared merge: `d749e63e8a34f9346834f6c13469c7f5e3cd0d61`.
  The final checkpoint commit adds documentation only, without another deployment.
- Preview `dpl_BKu7vjKh3Se56xqKyPYayG8q4C4v` accepted before production.
- Production `dpl_EgkUQpS3G5qkSKB9iuCGbJW3RFaD`, READY, firboai.app,
  project `prj_tNGCKDtXfH6ohh9i4UbqPkL53KJa`,
  team `team_MeaZI1Z6JWuUXbVh6DIbedLn`, exact accepted source.
  Previous production `dpl_DpTKgffcbmnYj3At3xJh9jSnJQRR` retained as rollback identity.
- Agent-chat v39 (8 files; verify_jwt false with existing custom authentication);
  mission-runner v29 (4 files; verify_jwt true);
  server-jarvis v15 (3 files; verify_jwt true). Complete bundle byte comparisons passed.
  Agent-runner v90 and MCP v19 were not cut over.

Migration identity mapping — already applied on `bfeinnsorgjycivozcau`:

| Accepted source file | Actual live migration identity |
|---|---|
| 20261006144554_inference_reservation_rollover.sql | 20261006205256_inference_reservation_rollover |
| 20261006154856_inference_runner_attempt_ledger.sql | 20261006205845_inference_runner_attempt_ledger |

These are semantically identical reviewed migrations. Never replay them using
the source timestamps. Fresh live guards and complete function/dependency reads
preceded each mutation. Runner ledger read-back confirmed both private tables'
RLS, no direct anon/authenticated privileges, and service_role-only RPCs with
empty search_path. Rollback-backed real probes verified duplicate admission,
single dispatch, cancellation denial and reconcile_required propagation without
retaining a task, attempt, usage or inference probe row.

Tested / passed:
- All 11 exact-head workflow families passed: frontend, lifecycle/PostgreSQL,
  pinned MCP, ownership, voice rollout, voice compatibility, server receipts,
  security SAST, M2 mobile, devices/adapters and Computer Manager.
- Local: 537 frontend, 633 distinct non-rendered Node, 62 runtime/server Python,
  32 engine contract and 17 egress cases; production build, strict Edge TS,
  full Ruff check/format (1446 files).
- PostgreSQL CI: all 18 READ COMMITTED/SERIALIZABLE concurrency races and
  reconciliation monitor read-only/unchanged-ledger tests passed.
- Real CI Chromium: graphics controls at 1280 and 390 widths passed pause/resume,
  lightweight mode, voice independence, reduced motion and bounds. Screenshots
  inspected: cyan particle head, segmented rings and working control labels.
  This is rendered harness evidence, not full reference/physical-phone acceptance.
- Public domain read-back HTTP 200; source/deployment identity verified;
  served connector SHA256 `84b40bfd71bf4b4a0b28baf4737e72dc99613fcc290997781ce464d56e626c92`;
  browser SHA256 `2166612cec8fa1cc9b8e45433623a09625c4058e884e9a0a23f5c530df1d37a3`.
- All three updated Edge functions returned anonymous HTTP 401.

Failed / corrected / limits:
- Local initial Python dependency environment was incomplete; correct isolated
  environment passed. Local rendered browser lacked Chromium; unchanged real
  Chromium CI passed. Git CLI push lacked credentials; authenticated GitHub
  connector created the identical combined tree, preserving all merge parents.
- Security Advisor after the ledger: 8 intentional locked-table/no-policy INFO,
  the same 8 authenticated-definer and 1 leaked-password WARN, no new WARN/ERROR.
- VPS repair already completed by the owner in the other session: backup
  `/var/backups/firbo-tools-9wapfud6`, `native_execution_verified:true`,
  `full_parity_complete:false`. Owner-reported, not independently rerun here.
  The useful artifact/delivery/read-back gate remains open; do not reinstall.
- Real database inventory: 5 devices, 1 paired/online, no browser_task capability,
  no unresolved inference request and no retained runner probe attempt.

Remains / concrete next actions:
1. Verify `FIRBO_SERVER_PRICE_IN_PER_M`, `FIRBO_SERVER_PRICE_OUT_PER_M` and
   `FIRBO_SERVER_MAX_OUTPUT_TOKENS` against the actual billed route. No invented
   free price; do not disable existing server_task by deploying absent config.
   Then exact runner bundle cutover and independent provider usage/receipt checks.
2. Provision the dedicated pinned HTTPS MCP service, credential and origin
   allowlist on authorized VPS ingress; perform harmless approved real MCP
   acceptance before deploying the Edge MCP cutover. This session has no callable
   VPS terminal/SSH capability.
3. Run `tools/mac/FIRBO-Mac-Browser-Update.command` on the already paired Mac.
   It retains existing pairing, uses pinned live asset hashes and installs the
   browser runtime. Local owner consent, Stop/offline and actual click/fill/
   scroll/read/snapshot/upload/download acceptance remain.
4. Obtain the useful VPS artifact and read it back with a correlated receipt.
   Continue real Google/Microsoft consent/refresh/revoke, authorized messaging
   tests, second-customer isolation, Knowledge/Skills/Workflows and delegation.
5. Complete final cyan HUD reference composition, real mobile and language/
   voice/media acceptance, encrypted off-host backup and booting isolated
   restore, monitoring/load/rollback rehearsal and final production assessment.

Do not mark the master plan complete. Keep FreeLLMAPI installed; TalkingHead,
Pipecat and whisper.cpp remain evaluated candidates. Preserve Mark-LV licensing
and existing permissions. No computer permission auto-enable or Mac re-pair.
