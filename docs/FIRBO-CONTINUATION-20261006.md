# Firbo continuation — combined Claude/Codex release

This checkpoint continues the master plan and the earlier 20261005 handoff.
Read the final release entry below before deploying anything.

## Changed

- Combined Codex `44ecae2` with Claude `6f5aa78`. Both are ancestors of candidate
  `7f915df6edf2fbce66b5e09b004e1b25ce6375be`, including task-briefing fix `e9fb240`.
- Preserved Claude's AI employee computer settings/apps/Shortcuts and Codex's
  scoped browser executor, durable receipts, UTF-8 bounds and workspace fixes.
- Fixed two page-test selectors: select the path textbox by its accessible name;
  select the offline Send to computer button independently of Save rules.
  No functional implementation was removed or changed to make tests pass.
- PR #12 was already merged by the other session. New continuation PR #15 targets
  Claude's branch. PR #13 remains CI-only and must never be merged into main.
- Added AGENTS.md and FIRBO-COLLABORATION-RULES.md to retain the owner's instruction
  to preserve both contributors across future sessions.

## Tested / passed

- Local: 166 browser/connector/policy/briefing tests, 465 frontend tests,
  production build, Ruff check/format, and 26 agent-loop tests. Counts describe
  separate overlapping selections, not one total.
- Exact candidate page CI: 84 layout cases and 19 operational cases, zero failed.
  Real Chromium browser workflow also passed, including browser/file operations
  and the denial checks. This is synthetic Linux evidence, not Mac acceptance.
- Live connector v25 matches both source files exactly; agent-runner v76 matches
  all 11 source files exactly. Agent-chat v34 matches all seven files in behavior:
  only the equivalent combining-mark Unicode regex spelling differs.
- All three live functions reject anonymous POSTs with HTTP 401.
- Both browser/policy migrations are already applied. No schema mutation or
  backend deployment was performed during this continuation.
- Preview HTTP 200 and both served browser/connector modules match source bytes.
- Latest device inventory: five records, one paired/online, zero browser_task
  capable devices. Three completed jobs: two browser_open and one list. AI policy
  enabled-device count was zero. Do not pair the working Mac again.

## Failed / corrected

- Candidate 3e07b13 page check failed because its offline-button locator matched
  both Save rules and Send to computer. Corrected in 7f915df; all 19 cases pass.
- The Vercel protected-fetch connector was unavailable. Direct public HTTPS
  read-back succeeded. No authentication bypass or browser fallback was needed.
- Local generated frontend/tsconfig.tsbuildinfo was preserved and not committed.

## Remains — do not mark the master plan complete

1. Update the paired Mac's Connector/browser runtime and obtain actual local
   browser-control acceptance, including local consent/Stop/offline behavior.
2. Complete a real approved useful task and read back its saved artifact, with
   consistent task, computer, activity and voice evidence.
3. Verify AI employee computer execution end-to-end before claiming autonomy
   acceptance. Specific code-review followups: current policy is read into a
   per-run snapshot; confirm changes are honored before later actions; test the
   new agent_task_id relation against cancel/delete/recover/retry guards; test
   suggest-only agents and browser_task actions requiring Inbox approval; verify
   Shortcut Stop/timeout behavior. Existing green tests do not certify these.
   Preserve the features while addressing these cases; do not enable permissions
   automatically to manufacture acceptance.
4. Owner's next priorities, explicitly received during this release: finish the
   current deployment first; then Google/Microsoft OAuth, Telegram/WhatsApp tests,
   and a second customer account to test sandbox isolation. Do not silently
   substitute mock accounts for real acceptance or send messages without the
   owner's explicit test destination/content authorization. Provider login and
   consent remain owner actions where no authorized tool can perform them.
   Also complete Knowledge/Skills/Workflows ingestion/retrieval and provider
   consent/refresh/revoke acceptance; no fabricated connected-provider status.
5. Free atomic budgets/durable accounting, U1/U2/U3 routing and key scopes,
   signed desktop/OS controls/voice/mobile/eight-language acceptance, encrypted
   off-host restore that boots the app, monitoring/load and final assessment.

The remaining master-plan safeguards and the source/automated/rendered/real-device/
LIVE evidence distinctions remain in force. The direct user session takes
priority over any scheduled continuation. Read current Git/live state first.

## Final release entry

- All 20 returned exact-head PR CI runs passed for `7f915df`, including full
  Python/Windows/Rust CI, both page checks, Chromium, Desktop, frontend,
  PostgreSQL lifecycle, ownership and security checks.
- Released the accepted preview as a new production build, keeping its pinned
  source (`withLatestCommit: false`), after re-reading both branch heads.
- Production deployment: `dpl_8eRbAYqUgBuz61P1ZeRs9n2tBv4S`, READY, with
  `firboai.app` alias and source `7f915df6edf2fbce66b5e09b004e1b25ce6375be`.
  The domain lookup independently returned that same deployment and source.
- Public HTTPS read-back: home HTTP 200; ComputersPage-B5HBYy8-.js contains both
  the AI employee settings and the browser task editor. Both downloadable modules
  return HTTP 200 and exactly match the released source bytes:
  connector SHA-256 `048ceb9275c55de662f2163dfec459ce0ca68b51b960dc286ccf1f1391bacb3d`;
  browser SHA-256 `2748e17b59cbea0c7638eb6dea8c185ac132700b0189699349292ed21c4d4621`.
- Prior production rollback target remains
  `dpl_Duh8kz1PLmbNa1PboPYpKkkRv9CE` (`ef67f424`).
- This release closes the merged frontend publication and its page-test gates.
  It does not close real Mac browser acceptance or the remaining master plan.
- References: https://github.com/conpol84/javris-clone/pull/15 and
  https://github.com/conpol84/javris-clone/actions/runs/37390691934 .

## Claude follow-up after PR #15 (`d909222` fast-forwarded, then `ca8bdf9`)

Changed (addresses Remains item 3, AI employee computer execution review points):
- agent-runner re-reads the device's policy, pairing and capabilities before every
  computer step; no per-run snapshot. Turning AI access off applies on the next step.
- `decideForEmployee`: an approval-only employee never runs a step by itself, browser
  plans included; a suggest-only employee may only list/read, every other step becomes
  a suggestion in its report; owner denials stay denials.
- connector: `computer_browser_task` Inbox approvals are executable (only steps and
  timeout are sent), refused on a device without browser_task capability, and broken
  plans return 422.
- Mac connector: Stop and the timeout end a running Shortcut (SIGTERM).
- DB `20261006010000_agent_computer_job_guards`: `claim_task_run` also waits for an
  employee's own queued/running steps (`agent_task_id`); deleting a task withdraws its
  queued employee steps. publish_task_run unchanged on purpose.

Tested / passed:
- 468/469 Firbo node tests (only browser-control-rendered fails here: Playwright 1.63
  Chromium cannot be downloaded in this workspace; CI covers it), edge tsc, frontend
  tsc, 465 frontend tests.
- Live DB, rolled back: an agent job with agent_task_id makes claim_task_run raise
  task_active_jobs.
- Live: connector v26, agent-runner v77 deployed; a real Research Agent task listed
  `/Users/macmini/Documents` on Polis1984 through v77 (job done, report saved). AI
  policy and the temporary computer_use power were switched off again afterwards.

Not done / remains:
- Frontend (`firbo-connector.mjs` Shortcut Stop, Inbox action list) is NOT released:
  production is still `7f915df`. Next release must take `claude/gifted-dijkstra-rph5j8`
  at or after `ca8bdf9` through the usual CI gates.
- Approval-to-execution of `computer_browser_task` and Shortcut Stop on a real Mac
  are not yet accepted on the device.
- The MCP SQL tool hangs on statements containing DROP/DELETE (likely an approval
  gate); use `create or replace trigger` or apply via CI. A disabled/blocked
  `computer_use` tool row remains on the test Research Agent.
