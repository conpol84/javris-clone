# Firbo continuation — combined Claude/Codex release

**Latest release is the PR #17 entry at the end of this file. Earlier versions
and remaining-item lists below are historical checkpoints.**

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

## PR #17 — combined release and OpenJarvis parity (6 October, latest)

### Changed

- Merged Claude through `c3912f98f70fd76d19cf9949c59d39f45422b0f9`, preserving
  fresh computer policy, approvals, Studio power rows, professional deliverable
  formats, PowerPoint downloads, quality pass and presentation repair standard.
- Included Codex PR #16 `525bb38`; both branch histories are parents of the
  combined candidate. PR #17 merged into Claude as
  `f27132a3656cbb9fc3268619bee2fd5586336eb5`.
- Accepted runtime source: `354a12dd8d0421ad6c1fbc914654f8892feb1272`, tree
  `60586d259c839b42881bfccaa98c2e42e8ac5787`.
- Closed the reviewed AI employee computer protocol gaps: fresh agent/tool/task
  checks, run token and policy/capability snapshots, atomic authorized dispatch,
  parent cancellation/deletion/recovery/publication guards, and confirmed
  Shortcut CLI termination with bounded escalation and uncertainty reporting.
- Suggest-only keeps Claude's list/read allowance but cannot mutate the local
  computer or bypass that limit through either OpenJarvis server. Server steps
  also refresh employee/task authorization. Per-tool server execution scoping
  remains an adapter requirement; do not claim a new full server security model.
- Preserved `started_at` in atomic job claims. Fixed FIFO fixture isolation;
  retained all prior assertions and added employee/tool revocation races.
- Added reproducible OpenJarvis AST/source inventory and function-family matrix:
  `docs/FIRBO-OPENJARVIS-PARITY-20261006.md`, JSON inventory and its script.

### Tested / passed

- Exact source: all 9 PR CI workflow runs passed. Actual PostgreSQL 17.6 passed
  rollback/lifecycle assertions plus **37 concurrent protocol checks** across
  Read Committed, Repeatable Read and Serializable. Actual Chromium passed.
- Local: production build, 468 frontend tests, 83 final edge-entrypoint tests,
  24 focused computer policy/Shortcut/deliverable tests; receipt/approval and
  local-operation suites passed in local selections and CI. Counts overlap;
  do not add them into an invented grand total. Edge TypeScript and changed
  Python formatting/lint checks passed.
- Applied migration is recorded by Supabase as **20261006023507**, name
  `agent_computer_run_protocol`. Its candidate filename was 20261006030000;
  the follow-up aligns the filename and CI reference with the real ledger.
  It also retains the concurrent idempotent `started_at` column guard for fresh
  installs. That column already exists live; the function bodies are unchanged.
  **Do not replay either filename in production.**
- Live `connector` **v27** matches both submitted files exactly; live
  `agent-runner` **v80** matches all 12 submitted files exactly. Agent-chat v34
  was left intact, retaining task briefing `e9fb240`.
- Live schema read confirms the new RPC is service-role-only. Direct read-only
  tests accept UTC all-day hours and reject incomplete hours/invalid zones.
- Production Vercel **dpl_58bZ53W55Y6e76rMgbBd1rcoERmB**, READY, source
  `354a12d`, independently resolved from `firboai.app`. Pinned redeploy from
  verified preview with `withLatestCommit:false`; no untested branch head used.
- Prior frontend rollback target: `dpl_HwR3pfREEFg8Xzp9DXQueeJFEGUA` at
  `8aed938`. Backend rollback to old v79/v26 is NOT schema-compatible for new
  inline agent jobs: retain the migration-aware versions or repair forward.

### Failed / corrected

- The original PR #16 SQL test expected a new job despite older queued fixture
  jobs on the same device. Isolated a device for the SQL tests and another for
  the concurrent employee tests; FIFO and every assertion remain intact.
- System PostgreSQL installation here was unavailable; actual PostgreSQL ran
  in isolated GitHub CI, not in the live customer database.
- First apply_migration call returned invalid/expired requestState. A read
  proved no migration/column/RPC existed before retry. The identical second
  call succeeded; no blind duplicate application or approval bypass occurred.
- CLI push lacked credentials. Used the authorized GitHub Git-object API with
  both parents and expected-head non-force updates; verified identical trees.
- Local generated frontend/tsconfig.tsbuildinfo remains uncommitted/preserved.

### Remains

- Mac is paired/online but has no browser_task capability. Update the existing
  Connector/browser runtime without re-pairing, then prove real local browser,
  consent/Stop/offline behavior and a useful saved/read-back artifact.
- Full original OpenJarvis source is retained: zero missing upstream files in
  Python/frontend/Rust/tests, with 64 static tools, 30 channels, 27 connectors,
  23 agents and 6 engine registrations. This is SOURCE, not enabled-tool parity.
  See the matrix for unmapped company adapters, browser screenshot/accessibility
  tree, typed server tools, knowledge graph, engine lifecycle and telemetry.
- Both admin and customer server health routes respond; anonymous info routes
  require authentication. No direct Hostinger/SSH capability exists here:
  installed source hashes/tool configuration and real sandbox isolation are
  still not certified. Keep the second real customer account acceptance open.
- Google/Microsoft provider consent/refresh/revoke and Telegram/WhatsApp real
  tests remain. The integrations table returned zero rows; do not invent
  connections or send messages without an approved destination and content.
- Preserve original remaining gates: company Knowledge/Skills/Workflow real
  acceptance; atomic global accounting/Free budgets; signed desktop/OS input;
  natural voice/mobile/eight-language devices; encrypted off-host restore that
  boots, load/monitoring and final product assessment. No full-plan completion.
- No device permissions, user credentials or external messages were changed.
  Last pre-release read showed zero active connector jobs and four enabled
  computer power rows, which were preserved.

### Final integration follow-up

- Concurrent hardening head `8b22130758b6762f4e9ab5ad588a52d35de48903`
  was discovered before closure. Its history and dependency fix are preserved:
  PPTX version pin/lock alignment and image-size 2.0.4 advisory override.
  PR #16 was reopened immediately when the newer head was discovered; do not
  close it as superseded until its new history is in the target branch.
- The migration filename now matches the applied ledger. The additional
  `ADD COLUMN IF NOT EXISTS started_at timestamptz` is a fresh-install guard,
  not a new production schema requirement. No SQL replay or edge redeploy.
- Live served connector SHA256:
  `55c429a7dcb61a1e5a6b19fcc7ffbeda5c24fb62edad13bfeae755b87b9c295b`;
  browser SHA256:
  `2748e17b59cbea0c7638eb6dea8c185ac132700b0189699349292ed21c4d4621`.
  Both returned HTTP 200 and matched the released repository assets. Anonymous
  empty POSTs to agent-chat, agent-runner and connector each returned HTTP 401.
- Existing continuation automation was updated to this release and remaining
  gates, preserving direct-session priority and no concurrent duplicate work.
- Follow-up validation: clean npm 11.19 install, production build, all 468
  frontend tests and actual PPTX ZIP generation with text and embedded PNG
  passed. Production remains pinned to the accepted PR #17 runtime until the
  follow-up relevant CI completes. No edge implementation changed afterward.

### Claude: deliverables live (agent-runner v83)

- Changed: agent-runner v81 (repair prompt keeps the deliverable standard), v82 (merged Codex
  run-protocol runner from PR #17: claim-bound computer jobs with policy/capability snapshots,
  suggest-only server guard; plus presentations/messages start on the quality route), v83
  (presentations/messages are written in one request of up to 85 s from the gathered web
  material; reports keep the research loop). v82+ is a superset of the Codex runner v80, so
  "preserve runner v80" is satisfied by v83; connector v27 untouched.
- Why: live presentation runs failed twice (economy combo 30 s cut-off, then the quality combo's
  writing step exceeded the 45 s loop step limit) and fell back to the sources-only report.
- Tested: 482/483 node tests (only the Playwright-download browser test fails, environment),
  468/468 frontend tests, edge typecheck; new edge test: a presentation starts on quality,
  carries the slide standard and has no tool loop; Free plan stays off quality.
- Passed live (Trade Athletes, Research Agent): report task 2417f882 completed on quality,
  polished, 6 sections; presentation task b1f05020 completed, format presentation, 10 slides,
  sourced figures, table and presenter notes, 1 model call.
- Remains: plan steps 2-4 (meetings with minutes/decisions/tasks; CEO brings employees into the
  chat; CEO proposes apps to connect as work sources). Test rows titled "[Δοκιμή]" remain.

### Claude: meetings and the CEO that delegates (plan steps 2-3)

- Changed (backend, live): mission-runner v26 (verify_jwt kept true) adds action `meet` for a mission
  with `metadata.meeting=true`: invited (or best-matching, max 5) employees speak in parallel from
  their role and recent finished work, the CEO writes professional minutes (attendees, agenda,
  discussion, decisions, action-item table, risks, next meeting), action items become pending
  child tasks (`metadata.from_meeting`), every model call is accounted to its speaker.
  agent-chat v36: the CEO delegates (TASK line), calls meetings (MEETING line) and hands over (ASK),
  up to one of each per reply, converted server-side to `[[task:]]`/`[[meet:]]`/`[[ask:]]` markers
  for real employees only; removed on Telegram/WhatsApp; the CEO never asks for passwords, keys,
  SSH, server addresses or DNS; gpt-5/o chat models use reasoning_effort low (a live reply was cut
  off by its own reasoning). Fixed: an `ASK:` match inside `TASK:` left a stray "T".
- Changed (frontend, NOT released): Missions page Mission/Meeting toggle, invitees, minutes, what each
  employee said, run action items in place; CEO chat buttons: "Give it to <employee>" (creates the
  task, runs it, shows the result inline, slides included) and "Open the meeting"
  (/missions?meet=<topic>&with=<ids>); copy in 8 languages.
- Tested: 489/490 node tests (Playwright download only), 471/471 frontend, edge typecheck incl.
  mission-runner; new tests: mission-meeting.test.mjs, task-briefing markers, handoff parsing.
- Passed live: agent-chat v36 CEO reply in Greek in 10 s naming real employees for the deck and the
  pricing meeting (server path; buttons are app-only). mission-runner `meet` needs a signed-in user
  (verify_jwt): live acceptance through the app after the frontend release.
- Remains: frontend release from this branch; live meeting through the app; plan step 4 (CEO
  proposes apps to connect as work sources; Trade Athletes has no integrations connected).
