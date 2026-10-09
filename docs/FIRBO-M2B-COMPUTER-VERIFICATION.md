# Firbo M2-B — Computer Manager and operational-page checkpoint

Date: 2026-10-03. Continue draft PR #9 and MASTER-PLAN-V2, not a new audit.

## Release identity and limits

Starting checkpoint: `2f62836027a927ae8005aa9cce20914071d0f870`.
Application implementation: `839648b959d26eb757303c013c014ee818642399`, then layout fixes in `e04a44f1c0d9840613c2eaaa703b5d4faedba5e7`.
Final test source: `46a936ecc3aa5de702874e873cd38088519ccab3` (test fixture consistency only after the application fixes).
Candidate branch: `codex/firbo-unified-gateway`. No merge or promotion of full PR #9.

Live Vercel remains `ae82ca939f1a19130871c6ad7661f22be200d3c0`, deployment `dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM`, READY/production. Fresh `/firbo-backend-health` at 16:14:41 UTC returned HTTP 200 JSON status ok, Via Caddy, no-store/CDN no-store, cache MISS.

A read-only Supabase check at 16:08:53 UTC found **0 device rows, 0 active paired devices and 0 jobs**. The connector function is still **ACTIVE version 5**, with its existing custom user/device authentication. No runtime function or data was changed. RLS is enabled on connector_devices/jobs/secrets; their policy counts are 1/1/0. This metadata is not proof of adversarial tenant isolation.

This is a candidate UI/lifecycle/queued-cancellation slice. It is NOT a signed desktop installer, live computer pairing, tested local file execution, visible-browser control, OS mouse/keyboard control or complete remote Stop.

## Changed

- Computer Manager state is keyed by user, company and role. Switching identity/workspace destroys old pairing/device/job/command drafts.
- Device/job refreshes are tagged by scope and generation. Out-of-order or unmounted results cannot overwrite a newer selection. Reads have a bounded UI wait and background polling does not overlap. The timeout does not claim to abort the underlying network transport.
- Failed reads clear stale rows and show an error/retry, rather than masquerading as an empty device list. A future, malformed, stale, unpaired or revoked heartbeat is not shown online. Online indicates only a recent heartbeat, not permission/capability certification.
- Displayed pairing codes expire conservatively in the client, disappear after pairing/revocation, and are not published after the requesting workspace is gone. This does NOT fix the separate server-side one-time pairing transaction requirement.
- Copy failures are handled. Device selection uses real keyboard-accessible buttons. Pair instructions, job results and long names wrap on small screens. New warnings/labels are present in all eight existing languages.
- Current Connector capabilities are described honestly: permitted file operations and explicitly enabled commands; browser/screen/mouse control is not advertised as active. The advanced shell option warns that a permitted cwd is NOT a shell sandbox.
- Cancellation is explicitly for QUEUED work. The actual candidate Edge handler requires the conditional UPDATE to return a row; an already-claimed job returns 409 and a persistence failure 503. User/org checks are preserved. There is no new live deployment or network call from the handler tests.
- Tasks/Inbox/Team/People/Activity/Computers receive route-scoped reflow. Phone task identity gets a full row instead of a 1-pixel strip. Team reserves the 420px editor column only when selected, and only on wide layouts; narrower layouts stack. All existing actions/routes remain.
- `docs/FIRBO-DELIVERY-MATRIX.json` covers **34 route definitions** (including redirects, wildcard and legacy routes), plus **19 cross-cutting requirements**. A test compares the inventory to App.tsx so an added/missing route is caught. The matrix is a coverage inventory, not proof of every feature working.

## Verification

Final normal PR workflows for **46a936e** all completed successfully:

| Workflow | Run | Result |
|---|---|---|
| Computer Manager / operational pages | 37136013201 | SUCCESS; 84 layouts + 15 interactions = **99 passed, 0 failed** |
| Previous M2-A page regression | 37136013139 | SUCCESS |
| Previous M1 shared components | 37136013111 | SUCCESS |
| Frontend CI | 37136013171 | SUCCESS |
| Connectivity | 37136013295 | SUCCESS |
| Dependency release gate | 37136013218 | SUCCESS |
| Control-plane security | 37136013233 | SUCCESS |
| Free-model catalogue | 37136013122 | SUCCESS |
| VPS/recovery checks | 37136013149 | SUCCESS |
| Existing static security | 37136013140 | SUCCESS |

Downloaded artifact **11278262842** (`firbo-m2b-computer-evidence`), SHA-256 **05be1c04938e23c0ca245d3c63c3f8e93d6381466a2873199f6a338eac5b142c**. Both JSON result files were read directly: `layouts/results.json` = 84/84; `computer-interactions.json` = 15/15. These are not inferred from a green build. Computer phone and selected-Team tablet screenshots were visually reviewed; the fixture-only label issue described below was corrected and retested.

The existing regression workflows also passed with the new mocked client. This does not turn their previous documented limitations into a real-account or device test. Dependency results are registry snapshots, not universal security certification.

Local checks: 223 existing frontend tests across 31 files; 26 new Node tests (17 state/result/language checks, 7 actual cancellation-handler tests using stubbed DB/auth, 2 inventory tests); full frontend TypeScript and isolated workbench build passed. Local browser navigation was blocked by the execution environment; the actual browser results come from GitHub Actions, not a claimed local browser pass.

The operational browser matrix covers 84 page/profile cases: six real App/Layout pages, English widths 320/360/390/412/768/1024 and a 1440 light sample, seven more languages at 320. Fifteen extra cases exercise four Computer Manager widths, empty/loading/error/member views, a delayed device response, expiry via a controlled clock, identity switch during delayed pairing, Tasks board at two widths and Team selection/editor at two widths.

The adapter uses invented companies/devices/jobs. It narrowly imitates connector query filters; it is not a database, RLS or transaction simulation. Pair creation and cancellation UI calls are in-memory test stubs. No real machine, account token, command, file, provider or AI inference is invoked. Browser external requests and service workers are blocked. Synthetic profile synchronization is allowed. The cancellation UI test validates the interaction/refresh path, not the server's affected-row logic; that logic has its separate actual-handler tests.

Geometry tests and screenshots are not physical Android/iOS, Safari, OS keyboard/zoom, complete accessibility, every popup or every execution-state acceptance. Eight language dictionaries are sampled, not every language/viewport/state combination.

## Failures were diagnosed, not hidden

- First run at 839648b: all 13 lifecycle tests passed; 82/84 layout cases passed. Two genuine failures were task identity squeezed by actions at 320px and Team reserving an unused editor column at 1024px. Application fixes followed; assertions stayed intact.
- Second run at e04a44f: 84/84 layouts and 15/15 interactions passed. Artifact 11278353227, SHA-256 c5c5050b4a3072469a03191d1676a1525380123d4d1c4a0578dbd5f49b456875.
- Visual inspection found the OLD DEMO fixture using `ask_first`, which is not the current Autonomy enum value (`approval`). Only invented fixture rows were normalized, with an explicit translated-label assertion. No actual agent policy or production dictionary was changed.

## Preserved and still open

The prior six-page M2-A and M1 work remain intact and were rerun in CI. Seven free OpenCode entries were already registered by the owner, not inference-tested. The local configuration/API-image checkpoint is accepted, but does not replace DB/volume backup, encrypted off-host storage and real boot/restore. Do not rerun those completed registration/recovery commands.

Before the Computer Manager/desktop execution is released, the remaining Connector work includes atomic one-time pairing; validated secret-row persistence; revoke-versus-running-job reconciliation; proper local Stop/process-tree interruption; bounded authenticated request handling; server-owned job leasing/idempotency and audit; and actual two-user/company/device tests. Existing `--allow-exec` is a general shell under local user permissions, NOT a folder security boundary. This stage does not enable it or certify its safety.

A refreshed live count of zero devices makes it especially important not to label these synthetic tests a real PC-control pass. The actual user must install/pair/authorize the reviewed desktop build for physical-device acceptance later.

Remaining mobile routes are listed individually in the matrix: Office, Analytics, Integrations, Studio, Coding, Hub, Billing, Memory, Reviews, Store, CEO, Missions, Shifts, public auth/onboarding and legacy desktop routes, plus the remaining menus/dialogs/real-device states. Twelve workspace routes now have sampled synthetic mobile evidence; **all-page completion remains open**.

Retain matching native Hostinger API/shared console and distinct keys; all-path routing including missions/audio; durable request ledger/atomic budgets; verified Free-only execution without paid fallback; signed Firbo Desktop and own update chain; visible browser and opt-in OS input with local Stop; real TikTok/YouTube/Salesforce/QuickBooks adapters/consent; migrations, MCP/shifts, monitoring/performance and final evidence-based assessment.

## Next

Continue M2-C using the matrix, then coordinated runtime and Desktop gates. Do not promote the entire PR merely because tests are green. No owner Hostinger command, model registration rerun, backup rerun or production Promote is required for the current candidate work.

## References

- https://github.com/conpol84/javris-clone/actions/runs/37136013201
- https://github.com/conpol84/javris-clone/actions/runs/37136013139
- https://react.dev/learn/you-might-not-need-an-effect
- https://playwright.dev/docs/network
