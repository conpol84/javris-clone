# Firbo M2-A — actual-page mobile verification and checkpoint

Verified: 2026-10-03. Continue draft PR #9 and `FIRBO-MASTER-PLAN-V2.md`. **This completes the first six-page synthetic-browser slice of M2, not the entire all-page/mobile-device acceptance plan.**

## Source and production identities

- Starting candidate: `14d1a7f6b23a68aa91a512ccd65ea769b9e61b06`.
- Latest application code: `723703e25d0bbb53bc2fc98f4d36f28a819edb3a`.
- Final tested source, including exact fault-report classification: **`1a42799702591a8d49f8b74df419714ab825c758`**.
- Branch: `codex/firbo-unified-gateway`; full PR #9 remains draft, not merged/promoted.
- Fresh connected Vercel read still resolves `firboai.app` to **`ae82ca939f1a19130871c6ad7661f22be200d3c0`**, deployment **`dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM`**, READY/production, project `prj_tNGCKDtXfH6ohh9i4UbqPkL53KJa`.
- Live `/firbo-backend-health` at **15:10:06 UTC**: HTTP 200, JSON `{"status":"ok"}`, Via Caddy, Cache-Control/CDN-Cache-Control no-store, cache MISS. This is an unauthenticated health check, not a fresh real-user session.

No production promotion, Hostinger restart/configuration, Supabase function/schema/data write, credential/agent/model/routing change or real inference occurred in this work unit. No unrelated sports product was touched. All current mobile work remains candidate-only.

## Changed application files

1. **Layout:** adds a route marker and imports the scoped page stylesheet; keeps routes, sidebar and existing authentication.
2. **BottomNav:** observes its real translated/safe-area height and reserves matching content space. All five controls remain; long navigation labels wrap instead of ellipsis.
3. **Panel:** allows header/actions/tabs to wrap; collapse/maximize behavior is retained, not claimed comprehensively interaction-tested here.
4. **mobile-pages.css:** reflows full labels/emails/statistics, contains company cards, preserves explicit bounded table/code scrolling, separates phone chat text entry from its buttons, stacks conversation lists above the editor on 768–1023px tablets and gives both Command Center actions usable widths.
5. **SceneFallbackBoundary / CoreOrb:** contain a decorative asset rendering failure and show the existing CSS fallback while navigation remains usable. Normal visuals remain when the asset works. This does not certify all graphics-driver/context-failure scenarios or fix every other scene.

The comparison to the starting candidate contains 14 changed files: six application files and eight isolated workbench/test/workflow files. No package versions, lockfile or language-dictionary content changed in this slice. Shared component changes still require regression checks on remaining routes. No blanket root-clipping fix was used to manufacture a pass.

## Final browser results: 97 passed, 0 failed

Read directly from the downloaded artifact, not inferred from a green build:

| Evidence file | Scenarios | Passed | Failed |
|---|---:|---:|---:|
| `results.json` | 36 | 36 | 0 |
| `additional-profiles/results.json` | 42 | 42 | 0 |
| `status-cases.json` | 19 | 19 | 0 |
| **Total** | **97** | **97** | **0** |

M2 workflow **37132489333**, job **111230208219**, artifact **11276594399** (`firbo-m2-page-evidence`). Artifact SHA-256:
`8444e2caac700250362a60d5cec582711e60c0807ea60b0006695516561cf6af`.

Final 320px screenshots of Companies, Chat, native Admin Console and Command Center were visually inspected. Earlier images exposed a briefing action squeezed into a narrow column even though its characters technically wrapped; the final CSS gives both existing Command Center actions balanced columns. Long synthetic identifiers deliberately stress the layout, and a geometry pass is not a claim of final design polish in every screen/state.

## All nine final workflows passed at the tested source

| Workflow | Run ID | Result |
|---|---|---|
| M2 actual-page mobile checks | 37132489333 | SUCCESS; 97/97 scenarios |
| M1 shared-component reflow | 37132489330 | SUCCESS |
| Frontend CI | 37132489375 | SUCCESS |
| Connectivity candidate | 37132489357 | SUCCESS |
| Dependency release gate | 37132489302 | SUCCESS |
| Control-plane security | 37132489327 | SUCCESS |
| Free model catalogue | 37132489345 | SUCCESS |
| VPS diagnostics/recovery | 37132489340 | SUCCESS |
| Existing security-sast | 37132489320 | SUCCESS |

These checks do not establish universal security, real provider behavior or full production readiness. The isolated Edge SDK-stub limitation remains documented in earlier checkpoints. This later documentation commit does not introduce a new tested application implementation.

## Real UI, synthetic services — exact scope

The isolated build renders the **real App, Layout and page components**, existing bottom navigation, native admin controls and M1 stylesheet together. The test-only Vite configuration substitutes synthetic Supabase-like responses; Gateway reads are intercepted. No backend proxy is configured in the workbench. External requests and service workers are blocked; execution/write requests fail. Only fake profile synchronization is allowed in the fixture.

Routes: **Command Center `/`, Settings `/settings`, Companies `/companies`, Gateway `/gateway`, Admin `/admin`, and loaded Chat `/chat?c=c0`**. Gateway iterates all ten tabs; Admin visits Overview, Companies, Users and the readonly native console. No Playground, model execution or external mutation is submitted.

Data includes two very long company names, a long email, large costs/token totals, eight conversations, long unbroken links and a long assistant message. These are invented test records, not private company data. The mock query builder does NOT reproduce real query filtering, RLS, atomicity or transaction behavior. Member UI tests are not backend authorization tests.

The 78 page/viewport/language cases contain 234 measured base/tab states; those are not 234 separate pages or API security tests. Widths sampled: 320, 360, 390, 412, 768 and 1440. All eight existing language dictionaries are rendered across the matrix, including Arabic RTL; this is not every width crossed with every language. There are desktop light-theme and phone dark-theme samples.

The 19 extra cases cover empty/error/loading data on five routes, two member views, one deliberately missing visual asset and one 390x400 chat viewport. The short viewport approximates reduced space; it does not reproduce a physical mobile keyboard. Explicit bounded table/code wrappers may scroll sideways, but a generally overflowing page is not exempt.

## Failures, diagnosis and corrections

- **Initial build:** the fixture lived outside `frontend/node_modules`, so router imports failed. `0a50dd7` corrected resolution to existing installed packages without changing dependencies or externalizing application modules.
- **Initial mock/asset setup:** the earlier client matcher missed some relative imports, and the isolated build lacked public 3D assets. These were test-harness defects, not evidence of production authentication/asset outages. Exact-path interception and the real public asset directory corrected them.
- **Actual clipping:** baseline geometry caught truncated company/email labels and company cards overflowing the phone. `adb95b8` fixed these plus navigation/composer containment; downloaded run 37130822685 showed **35/36 pass**, with the remaining tablet composer approximately 30px wide.
- **Tablet/fault path:** `84ede9f` stacks tablet conversations and adds visual fallback. The 78 expanded layout cases passed. The first asset test also clicked the panel-collapse header button rather than the Settings navigation row; this locator was corrected.
- **Renderer containment and visual review:** `eee8fe2` added the inner loader boundary; `723703e` improved Command Center action widths. Fallback and navigation then worked, but the renderer still reported the intentionally injected GLB 404.
- **Expected fault reporting:** React Three Fiber's renderer routes caught, uncaught and recoverable errors through `reportError`. The actual downloaded compiled workbench contains the same callback wiring. An error event alone therefore does not prove a failed recovery. `1a42799` changes ONLY test classification: exactly the injected local GLB-404 report is accepted in that one deliberate-failure case, and its count is retained. Every other page error still fails, including the same message outside the fault case. Three assertions check this classification. **No global error suppression, logging disablement or falsified clean-log claim.** The final evidence contains **one expected injected-asset report and zero unexpected page errors**, with the fallback visible and Settings navigation working.
- A superseded run at `eee8fe2` was cancelled by branch concurrency when the next reviewed change was pushed; it is not counted as a completed pass.

## Not tested / not yet released

Physical Android/iPhone, iOS Safari, actual keyboard/zoom behavior, every modal/menu/sidebar/panel interaction, every loading/error/large-data variation, all remaining routes and full accessibility compliance remain open. Browser-side mocks do not establish real-account permissions or tenant isolation. Remote fonts are blocked in the workbench; these tests do not prove production font metrics or delivery.

No native backend, desktop installer, mouse/keyboard control, voice path, integration adapter or runtime Free-only policy was installed by this slice. The visual fallback deliberately retains error reporting; it is not silent replacement of business failures.

## Parallel branch work preserved

The PR CI merge ref included target `41d56da3940a722a70d18f701173453916355b27`, a documentation-only Claude handover/review atop `ae82ca9`. It was read and not discarded or force-overwritten. Textual merging alone is not visual acceptance; this M2 workbench tests the real combined UI styles and navigation. Recheck the current target before any production merge.

## Next checkpoint

Continue M2 with Tasks, Inbox, Team, People and Activity, then the remaining routes and dialogs in MASTER-PLAN-V2. Keep a per-route evidence matrix and separate real-device acceptance. **Do not label all pages mobile-ready from this six-page pass.**

Retain U3/U4 gates: matching native API, distinct scoped keys, consistent data/volume backups, encrypted off-host storage and actual restore/boot; real tenant/agent/fallback verification; durable request ledger and atomic budgets; mission/audio routing; signed Firbo Desktop/pairing/visible browser/OS execution; real TikTok/YouTube/Salesforce/QuickBooks adapters; migrations, MCP/shifts, monitoring/performance and final evidenced assessment.

The owner's seven OpenCode registrations and local configuration/API-image verification remain completed within their original scope. **No repeat of free-model registration, recovery scripts or Promote is needed for this candidate mobile work.** No new owner action is required now.

## Evidence and primary references

- https://github.com/conpol84/javris-clone/actions/runs/37132489333
- https://github.com/conpol84/javris-clone/actions/runs/37132489375
- https://github.com/conpol84/javris-clone/actions/runs/37132489330
- https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- https://playwright.dev/docs/network
- https://react.dev/reference/react/Component
- https://github.com/pmndrs/react-three-fiber/blob/master/packages/fiber/src/core/renderer.tsx
