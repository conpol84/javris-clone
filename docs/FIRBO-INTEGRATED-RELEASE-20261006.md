# FIRBO integrated release — 6 October 2026

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
