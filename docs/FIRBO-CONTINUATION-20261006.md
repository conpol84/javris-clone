# Firbo continuation — combined Claude/Codex release

**Read the last entry in this file for the latest release and remaining gates.
Earlier release identities and remaining-item lists are historical checkpoints.**

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

### Codex: CEO frontend acceptance follow-up

- Continued Claude `35a5184`, retaining PR #18 and the newer v83/v36/v26 backend.
- Fixed combined offers (task/meeting/handover), false Done on failed or approval
  runs, persisted company-scoped completion, double-click duplicate creation and
  stale employee state across company changes. No backend or SQL replay.
- Local production build, TypeScript and all 482 frontend tests pass, including
  11 new action/control tests. Parent 35a5184 has 14 green workflows; run relevant
  CI for the new source before publishing. See FIRBO-CEO-ACTIONS-20261006.md.
- Fresh production remains ce421e3 / dpl_7BjPjgmuseFTEFgTRTtBoJpnqcVX. New
  meeting/delegation controls and these fixes still need publication/acceptance.
- Mac, OAuth, messaging, real customer isolation and all other master-plan gates
  remain open. No permissions, device jobs or external messages were changed.

### PR #19 — combined CEO actions release (6 October 2026)

Changed:
- PR #19 merged into Claude with preserved histories at
  `500d5df7336d84af63c897f6a58e8c52b8ca8538`. Accepted runtime source
  `e250eeb43a4348902168508a5afb0565dba6139f`, tree
  `067aefc818c4860183c2eee53dd6ee074909de51`, includes Claude `35a5184`
  and PR #18. Meetings/CEO delegation frontend is now published together with
  the combined-offer, task outcome, duplicate-click and company-state fixes.
- No backend deployment or SQL replay. Preserve connector v27, runner v83,
  chat v36 and mission-runner v26, including all prior protocol/briefing work.

Tested / passed:
- All six new exact-head PR workflows passed, including operational pages,
  security, frontend and PostgreSQL workspace lifecycle. The parent separately
  had 14 successful workflow runs; these are not one combined test count.
- Local build/TypeScript and 482 frontend tests pass (11 new controls/outcome
  tests); 22 existing meeting/briefing node tests pass. The task+meeting
  rendered regression failed on the original parent as expected and passed
  with the fix. No real account/device acceptance is implied.
- READY preview `dpl_8vC38k3ozQHbBSo3axCnAqZC8VLe` was redeployed with
  `withLatestCommit:false`. Production `dpl_2YoUFySmGW3MCgwVyPNCTx52LHBN`
  is READY; independent `firboai.app` lookup returns the same exact e250eeb.
- Live home and CeoActions-DTBpU8lT.js returned 200, with the new controls,
  awaiting-approval handling and company-scoped stored-result query.
- Live downloadable connector/browser returned 200 and match repository text
  exactly. Their unchanged SHA256 values are
  `55c429a7dcb61a1e5a6b19fcc7ffbeda5c24fb62edad13bfeae755b87b9c295b` and
  `2748e17b59cbea0c7638eb6dea8c185ac132700b0189699349292ed21c4d4621`.
- Rollback frontend: `dpl_7BjPjgmuseFTEFgTRTtBoJpnqcVX` at ce421e3.
  Do not roll backend back to schema-incompatible pre-protocol versions.

Failed / limitations:
- CLI push had no credential helper; authorized GitHub Git-object API created
  the same verified tree with parent 35a5184. No force-push/history discard.
- Build's existing chunk-size/analytics dynamic-import warnings remain.
- Active-job and device/provider observations are bounded read-only evidence:
  zero queued/running connector jobs, one paired/online device, zero browser_task
  devices and zero integrations. No account, permission or job was changed.

Remains:
- Signed-in meeting/CEO task acceptance, and Claude's work-source app proposals.
- Existing Mac Connector/browser update without re-pairing; real approved
  browser/Stop/offline task and useful saved/read-back artifact.
- OpenJarvis company adapters, real OAuth refresh/revoke and approved channel
  messages, second customer sandbox isolation, Knowledge/Skills/Workflows,
  global accounting/Free budgets, signed Desktop/OS/voice/mobile/eight languages,
  encrypted offhost restore, monitoring/load and final master-plan assessment.
- Source/automated/static-rendered/real-device/live distinctions remain in force.
  PR #13 is untouched. No full-plan completion.

References: https://github.com/conpol84/javris-clone/pull/19 ;
https://github.com/conpol84/javris-clone/actions/runs/37412639429 ;
https://firboai.app

### PR #20 — safe CEO work-source proposals release (6 October 2026)

Changed:
- Continued Claude checkpoint `445933907548f9cc240f08bbb6c06b1f3b33cb59`;
  PR #20 merged with both histories preserved at
  `6a5f36893bfab60802630b9364a5f6ba18841b47`. Accepted head `ad9bdd3`,
  immutable tree `60ca01aa46f0d6e180e9c1742a02a184a66fdf49`.
- Added organization-scoped, allowlisted proposals for Google Drive/Gmail/Google
  Calendar/Outlook read, Notion and GitHub. Existing kinds are excluded; an
  integration-read error disables proposals. The rendered action only opens the
  exact Integrations setup page, where the owner must still review and consent.
- Unknown, already-connected and channel-only markers are stripped. Frontend and
  server have independent allowlists; labels cover all eight app languages.

Tested / passed:
- 110/110 expanded edge/meeting/briefing tests (including 21/21 focused action
  tests), 19/19 focused frontend tests, 485/485 full frontend tests, frontend and
  edge TypeScript, production build and diff check. All six exact-head PR
  workflows passed, including operational pages, security and PostgreSQL
  workspace lifecycle.
  See `FIRBO-WORK-SOURCE-PROPOSALS-20261006.md`.
- Backend `agent-chat` v37 is ACTIVE and all seven deployed files match the
  merge source exactly. No SQL or other edge function was deployed.
- Production `dpl_D6XHthZAmsy8sCUJJxVXoAqVE51g` is READY at source `6a5f368`;
  public `firboai.app` and `CeoActions-Bm-t-Vpx.js` rendered the new parser,
  allowlist and setup-only link. Error/fatal runtime scan was empty.

Failed / limitations:
- Initial focused test exposed underscore removal in `gdrive_read`; fixed before
  the passing runs. The expanded suite then exposed its missing integration-table
  mock; added with organization-scope assertions before the 110/110 pass. No
  signed-in or provider acceptance is claimed.
- Direct Vercel preview promotion returned 422; the tested preview was pinned
  into a production redeploy with `withLatestCommit:false`, and reached READY.

Remains:
- Signed-in proposal/meeting/task acceptance. Google/Microsoft
  consent/refresh/revoke, real device/channel and all other master-plan gates
  remain open. PR #13 remains untouched; no full-plan completion.

References: https://github.com/conpol84/javris-clone/pull/20 ;
https://github.com/conpol84/javris-clone/actions/runs/37416789387 ;
https://firboai.app

### PR #21 — bounded browser accessibility and screenshot release (6 October 2026)

Changed:
- Continued exact shared checkpoint `5c6a0bc` without concurrent branch drift.
  Added `snapshot` and `screenshot` inside the existing `browser_task` contract;
  no new job kind, migration, pairing, permission, SQL or external action.
- Accessibility output is bounded, marked untrusted and returned in the durable
  receipt. Visible-viewport PNG bytes are capped, signature-checked and retained
  only in an existing allowed local folder; the company receives a verified
  path/hash receipt, not the image. Both captures ask again locally and `--auto`
  cannot approve them. Server and Connector validate the same closed plan.
- Computers exposes both actions in all eight languages. See
  `FIRBO-BROWSER-EVIDENCE-20261006.md`.
- PR #21 merged with both histories preserved at
  `9b2b8ce0733762c957eb74377d88e1ae7b8fa247`; accepted head `73e51d4`,
  immutable tree `f60e617f90fcdc385396c711923c073bda188888`.

Tested / passed:
- 91/91 focused browser/policy/approval/Connector tests, all 546 non-rendered
  FIRBO Node tests, 487/487 frontend tests, frontend TypeScript and production
  build passed. All seven exact-head workflows passed, including the visible
  Chromium/Xvfb fixture in run `37423292153`.
- Supabase `connector` v28 is ACTIVE, `verify_jwt=false`, digest
  `65e01d4e06a25e8400fe947510214456137a484a17fed5279a052be99f6d37f3`;
  its two deployed files match source exactly. Runner v83, chat v37, mission v26
  and every migration remain unchanged.
- Production `dpl_8ekCf1V4MUVuMzKZnoJQ2Q3y2WD1` is READY from the tested
  immutable PR source with `withLatestCommit:false`. Public `firbo-browser.mjs`
  matches source byte-for-byte; the served Computers chunk contains both new
  controls. The 30-minute error/fatal scan was empty.

Failed / limitations:
- Local rendered Chromium is blocked because this workspace lacks the pinned
  browser executable and Xvfb. It is not counted as a local pass; exact-head CI
  supplied separate rendered-browser evidence.
- No Mac, account, credential, integration row, permission, job or message was
  changed. Source, automated Chromium and served-source evidence do not prove
  real-device acceptance.

Remains:
- Real already-paired Mac update and approved snapshot/screenshot/Stop/offline
  useful-artifact read-back; signed-in CEO acceptance, OAuth, approved channels,
  second customer and all remaining master-plan gates.

References: https://github.com/conpol84/javris-clone/pull/21 ;
https://github.com/conpol84/javris-clone/actions/runs/37423292153 ;
https://firboai.app

### PR #22 — MCP company boundary release (6 October 2026)

Changed:
- Continued exact Claude checkpoint `f24287b99cbfb5aa94fc19d7012b26b0fc8ecb22`
  after confirming no direct-session branch drift. PR #13 remains untouched.
- Hardened the existing MCP adapter with bounded request/response/session/tool
  data, exact same-session tool discovery, explicit browser+server confirmation,
  manager-role recheck, durable pre/post audit receipts and honest reconciliation
  for ambiguous/unrecorded results. Missing quota, integration, secret or audit
  state fails closed before any tool action.
- New connections use the existing atomic integration+secret RPC. No migration,
  SQL replay, provider consent, credential, integration row, external tool call,
  device job or message was created. Eight-language confirmation copy included.
  See `FIRBO-MCP-BOUNDARY-20261006.md`.
- PR #22 merged with both histories preserved at
  `97a10a375ec488d6bc8f3120ae07900d8ea2bf57`. Accepted head
  `be8332a09bc10de9f38fd9e4764d9e32b8b2f959`, immutable tree
  `7610f4e3f0394fe93908c0247b3bdec35e199b57`.

Tested / passed:
- 9/9 actual MCP Edge entrypoint tests with synthetic DB/remote doubles, 2/2
  focused frontend receipt tests, all 555 non-rendered FIRBO Node tests and all
  489 frontend tests pass. Edge TypeScript, frontend production build, clean npm
  11.19 install, diff check and production dependency audit (zero
  vulnerabilities) pass.
- All six exact-head workflows passed: `37425692404`, `37425692340`,
  `37425692352`, `37425692357`, `37425692392` and `37425692402`; the latter
  operational run supplied separate browser/rendered evidence.
- Supabase `mcp` v19 is ACTIVE with `verify_jwt=true`, digest
  `4bae985da5c47dd2f142d23746db9e038383faec616f337c513f4cfb8bb23aea`;
  its deployed source matches the accepted file exactly. Connector v28,
  runner v83, chat v37, mission-runner v26 and all migrations remain unchanged.
- Production `dpl_GmvEdCJBQCV5fRfHHRRcmPmrhQKZ` is READY from tested preview
  `dpl_6ANscVpdtBA4Z4xNz77fsW1J9Fnu` with `withLatestCommit:false`.
  `firboai.app` returns 200 and its Integrations chunk contains receipt/SHA-256
  output. Deployment-scoped 30-minute error/fatal scan is empty. Frontend
  rollback remains `dpl_8ekCf1V4MUVuMzKZnoJQ2Q3y2WD1`.

Failed / limitations:
- The wildcard local FIRBO run reaches the existing rendered-browser fixture but
  cannot load its pinned Playwright runtime in this workspace. This is an
  environment limitation, not counted as a pass; exact-head CI supplied
  independent rendered evidence.
- Literal/local/internal hosts and redirects are denied, but the Edge fetch API
  does not provide the Connector's socket-level DNS pinning. Network-pinned
  egress remains required before declaring arbitrary tenant MCP hosts a complete
  SSRF boundary.
- Direct preview promotion returned 422; the tested preview was pinned into a
  new production deployment instead. Anonymous live MCP invocation returned
  HTTP 401. No signed-in/provider call was made.

Remains:
- Legitimate owner-approved provider acceptance with receipt reconciliation;
  network-pinned egress and second-customer isolation. No real connection or
  call may be invented from the release evidence.
- Mac, signed-in CEO, OAuth/channel, second customer and all remaining
  master-plan gates stay open. No full-plan completion.

References: https://github.com/conpol84/javris-clone/pull/22 ;
https://github.com/conpol84/javris-clone/actions/runs/37425692392 ;
https://firboai.app

### PR #23 — inference accounting ledger stage 1 release

Changed:
- Continued exact Claude checkpoint `13f4304`; no direct-session branch drift
  was present. PR #13 remains untouched.
- Added a private, service-only request ledger for `agent-chat`: client request
  UUID, pessimistic pre-provider cost reservation, per-company/agent row-lock
  admission, atomic usage settlement, duplicate suppression, explicit
  reconciliation for ambiguous provider results and release for known local
  pre-provider failures. Free/BYOK reserves $0 but remains rate-counted.
- Added an exact PostgreSQL 17 lifecycle/race target. PR #23 merged with both
  histories preserved at `fe9de7b257fc9e48c44cf0b8c1dfe0ae5c326a50`.
  Accepted Codex head `0d31c30683870a325eabe3b33bf76e8f45ad0ca2`,
  immutable tree `009cdba5d9def9cecc4d03580ff0e6334fb85353`.
  See `FIRBO-INFERENCE-ACCOUNTING-STAGE1-20261006.md`.

Tested / passed:
- 92 actual mocked-transport Edge handler tests, 561 non-rendered FIRBO Node
  tests, 490 frontend tests, strict Edge TypeScript and production build.
- All seven exact-head workflows passed: `37436471173`, `37436471228`,
  `37436471240`, `37436471267`, `37436471225`, `37436471295` and
  `37436471287`. PostgreSQL 17 executed the actual migration, ACL/settlement
  assertions and all four READ COMMITTED/SERIALIZABLE concurrency races.
- Production migration was applied once as ledger `20261006083523`. Live ACL
  checks show no direct table access for anon/authenticated/service_role and RPC
  execution only for service_role. All four functions retain an empty search
  path; no accounting request or usage row was created by release verification.
- `channel-inbound` v9 and `agent-chat` v38 are ACTIVE. All eight chat bundle
  files match accepted source byte-for-byte; chat digest is
  `037b3fcaf1a32c621b1fc5c7ddb92c377081c1986405444a2b1f8f953acd8abb`.
- Production `dpl_EKo9oCXqxyCZpSQpjzxQUBHUQbqp` is READY from the tested
  immutable PR head with `withLatestCommit:false`. `firboai.app` returns 200,
  the served runner contains the client request UUID, anonymous chat POST is
  denied with HTTP 401, and the deployment-scoped 30-minute error/fatal scan is
  empty. Rollback remains `dpl_GmvEdCJBQCV5fRfHHRRcmPmrhQKZ`.

Failed / limitations:
- This is source, automated, rendered and live-served evidence. No legitimate
  signed-in chat/provider request was made, so real-account cost receipt and
  reconciliation acceptance remain unproven.
- `agent-runner`, missions, speech and other inference routes still use their
  older guards; the global cross-route accounting/Free-budget exit criterion
  remains open. Supabase performance lint also reports two new unindexed FK
  paths on the private ledger for a follow-up migration; this is not treated as
  stage-1 completion.
- Direct preview promotion returned 422; immutable production redeploy succeeded.

Remains:
- Reconciliation UI/monitoring, the remaining inference routes, the two covering
  indexes, real signed-in receipt and second-customer isolation remain after
  stage 1. Preserve connector v28, runner v83, chat v38, channel-inbound v9,
  MCP v19 and mission-runner v26; never replay ledger `20261006083523`.
- Mac, signed-in CEO/meetings/delegation, provider OAuth/channel tests, backup,
  monitoring/load and every other master-plan gate remain open.

References: https://github.com/conpol84/javris-clone/pull/23 ;
https://github.com/conpol84/javris-clone/actions/runs/37436471240 ;
https://firboai.app

### PR #24 — accounting FK covering indexes release

Changed:
- Continued exact Claude checkpoint `38b02e2`; no direct-session drift was
  present. Added an additive migration for the two private ledger FK paths
  reported by the post-release Supabase performance advisor.
- The PostgreSQL accounting target applies stage 1 followed by the new migration
  and asserts the exact index columns/order. PR #24 merged with both histories
  preserved at `11d433a58a926be141c633dca9dda0fd6ac184cc`.
  Accepted Codex head `b09a6d51330985345934ff9783401dd5c481b4c6`,
  immutable tree `c3b3928416a611e7d342525cf1fb4c6e1f39ca65`.

Tested / passed:
- Workflow YAML/migration-order validation, diff check and all 92 Edge handler
  tests pass locally.
- All seven exact-head workflows passed: `37438061513`, `37438061473`,
  `37438061482`, `37438061685`, `37438061534`, `37438061538` and
  `37438061682`. PostgreSQL 17 applied both migrations and passed the exact index
  assertions plus retained accounting semantics/races.
- Production migration was applied once as ledger `20261006084808`. Live catalog
  inspection reports `(organization_id, agent_id)` and `user_id` in the intended
  order. Both new unindexed-FK findings disappeared from the advisor.

Failed / limitations:
- This release changes indexes only. It does not extend accounting to another
  inference route or prove real-account/provider acceptance. New indexes appear
  as unused because the live accounting ledger intentionally remains empty.

Remains:
- Extend the ledger route by route, add reconciliation monitoring, and complete
  legitimate signed-in receipt/second-company acceptance. Never replay ledgers
  `20261006083523` or `20261006084808`.

No frontend or Edge Function changed; production remains
`dpl_EKo9oCXqxyCZpSQpjzxQUBHUQbqp`, chat v38, channel-inbound v9, connector
v28, runner v83, MCP v19 and mission-runner v26.

References: https://github.com/conpol84/javris-clone/pull/24 ;
https://github.com/conpol84/javris-clone/actions/runs/37438061534

### Claude: test data removed (owner request)

- Removed in production at the owner's request: the 7 "[Δοκιμή]" tasks of Trade Athletes (all finished,
  no children or approvals), the 8 learned-memory notes saved from them, the 2 "[Δοκιμή]" CEO chat
  messages and the 2 CEO replies to them. The owner's own conversation history was kept.
- Verified: production frontend dpl_EKo9 (0d31c30) contains all Claude commits through 35a5184
  (deliverables, slides/PowerPoint, meetings, CEO task/meeting buttons); agent-chat v38 keeps
  ceoActions and adds the Codex APP line; 511/512 node and 490/490 frontend tests after the merge.
- Remains for the owner: one signed-in meeting through the app, connecting work-source apps,
  Mac Connector update, Telegram/WhatsApp, second customer account, OmniRoute key rotation.


### Candidate — mission/meeting inference ledger (6 October, source only)

Changed:
- Continued Claude checkpoint `a823bcbd0f54e4ef1d29ad15905ef29991289b1b`, which
  already includes merged PRs #17 through #24 and both contributors' history.
- Preserved Claude `22e5480` test-data cleanup checkpoint during the combined
  merge; its runtime files were unchanged.
- Each mission plan, synthesis, meeting speaker and CEO minutes model attempt
  uses the chat ledger's private company lock and current employee budget.
  Fallbacks reserve separately; ambiguous earlier results retain their cost
  reservation. Lost settlement responses cannot trigger another provider call.
- Mission results contain accounting request IDs and review state. Previously
  ambiguous missions cannot be re-executed automatically. Free/BYOK remains
  zero Firbo cost while still consuming per-call rate quota. Existing daily
  plan limits now apply atomically across chat and meeting model calls.
- Added source allowlist migration, mixed-route PostgreSQL assertions/races
  and actual handler tests. No frontend, connector or task-runner changes.

Tested / passed:
- 103 actual chat/task/mission handler tests with mocked transport; 519
  non-rendered top-level Node tests; strict Edge TypeScript and diff checks.
- Real PostgreSQL migration and six race checks remain an exact-head CI gate.

Failed / limitations:
- Source-only candidate: no production migration, Edge deployment, provider
  request, user permission, integration or device job was changed.
- Existing mission task publication/claim semantics are preserved; this does
  not claim synthesis idempotency or repair every mission lifecycle issue.
- Agent-runner, speech and other inference routes still need ledger adapters.

Remains:
- Require exact-head CI, re-check concurrent branches/live dependencies, merge
  preserving history, apply only the new migration and deploy mission-runner.
  Never replay `20261006083523` or `20261006084808`.
- Keep real Mac, real customer sandbox, OAuth/channel acceptance, reconciliation
  monitoring and all other remaining master-plan gates open.
