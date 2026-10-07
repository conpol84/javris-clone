# Firbo delivery plan v2 — one product, mobile and desktop execution

Owner approved replanning and starting now on 2026-10-03. Supersedes the order of work in FIRBO-PRODUCTION-PLAN.md, NOT its uncompleted safeguards or the U1/U2 work. Continue the existing draft PR #9; do not restart audits from zero. No silent production promotion.

## Verified starting point

- Production: ae82ca939f1a19130871c6ad7661f22be200d3c0, deployment dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM, READY / production. Verified again through connected Vercel on 2026-10-03. Live /firbo-backend-health returned HTTP 200 JSON status ok, Via Caddy, no-store (13:20 UTC).
- Unified candidate before this work: 7000d233190f64ab4f0a767180826575e138e59a. It is NOT the current production frontend. U1 native console and U2 opt-in shared routing still need matching backend/runtime and real-account verification.
- Owner reported successful free-model registration at 2026-10-03T12:59:48.576433Z: seven OpenCode entries; zero inference requests; existing_combos_unchanged=true; runtime_unchanged=true; OpenRouter still requires connection. This is owner-run VPS evidence, not assistant SSH access. No re-run needed. No claim that the models execute, support vision/tool calls or enforce zero cost.
- Previously verified local recovery covers configuration + existing API image only. Database/volume backup, encryption, off-host copy and application restore/boot remain OPEN. No repeat of the completed archive-format checks.
- Last owner evidence says inference and management key values are equal. Scope separation remains required before routing cutover.

## Product decisions

Keep javris-clone/frontend as the one Firbo web/desktop frontend, Supabase as identity/company/task records, and OmniRoute as the Hostinger model engine. Native desktop installs use the same company identity with separately paired/revocable devices. Installing the web app as a PWA does NOT itself provide computer-control privileges.

Mobile quality applies to every existing page, admin view, dialog, menu, table and chat. Preserve navigation, features, language coverage and the product's visual identity. Do not hide overflow or remove controls to manufacture a mobile pass.

Desktop execution means REAL browser and, later, operating-system mouse/keyboard actions, not merely suggested instructions or the browser on the VPS. Use APIs first, browser automation second, full desktop input only when needed. Default proposed first installer target is Windows; this is a sequencing choice, not a promise of already tested macOS/Linux parity.

## Stages and exit criteria

| Stage | Deliverable | Exit evidence |
|---|---|---|
| V0 — Release clarity | Persist exact live/candidate versions and accepted tests; reconcile the actual released branch into the unified branch without discarding U1/U2; later expose version info in Settings | Verified deployment ID/commit; reviewed merge/conflicts; clear source/tested/live labels |
| M1 — Mobile foundation, start now | Shared dialogs, controls, flex/grid containment, navigation safe areas; automated component/viewport regressions | Component geometry and interactions at small widths, no hidden content, screenshots; label this as a component pass only |
| M2 — Complete responsive pass | Every existing route and interaction: tables/cards, tabs, menus, long translated labels, nested modals, chat composer, keyboard, portrait/landscape, empty/error/loading/large-data states | Per-route matrix; 320/360/390/412/768/1024/1440 widths; all 8 languages, RTL; Android Chrome + iOS Safari; keyboard/zoom/focus; no outstanding blocker in a claimed-ready route |
| U3 — Runtime and recovery | Matching native Firbo API, private test deployment, off-host encrypted data/volume backups and actual isolated restore, distinct verified key scopes | Restored app boots; contracts match; no public secrets; existing live preserved until accepted cutover |
| U4/F — Unified execution and Free policy | Chat/tasks/missions/audio choose a verified execution route; trace IDs, durable server-owned request ledger and atomic budget reservations; dynamic catalogue and verified Free-only option | Bounded synthetic requests, confirmed provider and costs/fallback, no silent paid fallback, reconciliation on ambiguous failures; privacy controls and no company data sent to new free providers automatically |
| D1 — Firbo Desktop and pairing | Firbo branding/identity; signed installer/update chain owned by Firbo (not upstream OpenJarvis updater); bundled local executor; pair/revoke/heartbeat/permissions | Install/uninstall/update tests; malicious/revoked/expired device refused; scoped folders; local Stop works; no open unauthenticated listener |
| D2 — Visible browser work | Separate browser profile; open URLs, inspect page, click, fill, scroll, download/upload only within granted scope; live progress and final artifact | Real approved sample task completes; credentials/login prompts left to user; no unsupported website claims; browser is clearly local vs cloud |
| D3 — Desktop mouse/keyboard work | Opt-in OS accessibility/input bridge; screenshot consent; select app/window; pause/resume/Stop, user takeover; no privilege-prompt or OS protection bypass | Real Windows app tasks, interruption recovery, lock/sleep/offline behavior, policy-denied actions, prompt-injection tests and screen-data privacy; macOS/Linux tested separately |
| I — Actual integrations | TikTok, YouTube, Salesforce, QuickBooks with provider-specific consent/lifecycle; read/write scopes explicit; no fake Live label | OAuth account connected, refresh/revoke tested, real allowed action + returned provider identifier/status; platform approval limitations shown honestly; financial apps read-only first |
| P — Operations and release | Database migrations reproducible, prior MCP/scheduler fixes, monitoring/alerting/backup automation, role/tenant isolation, performance, coordinated release/rollback | Two-company adversarial tests, runtime faults/retries, restore drill, dependency/security checks, no critical known launch blocker |
| Q — Final project assessment | Page/feature inventory with evidence, scored areas, remaining gaps and priorities; documented distinction between beta and production | Scores reflect observed execution, not page existence/test counts/model count; exact release reviewed |

M1/M2 design work can proceed safely in the candidate without waiting for live infrastructure writes. U3/U4 and later desktop work cannot bypass recovery/auth/permission gates. Free registration does not switch existing Economy/Quality profiles or agents.

## M2 page inventory (all required; not claimed tested now)

Public landing / login / onboarding; Command Center; Chat / Agent Chat; Office; Gateway and every tab; Analytics; Integrations and connect/test/error dialogs; Admin Overview/Companies/Users/Console; Studio; Computers; Coding; Hub; Billing; Memory; Reviews; Store; CEO; Missions; Shifts; Companies; Team; Inbox; Activity; People; Tasks; Settings. Legacy desktop-only routes: Dashboard, Get Started, Data Sources, Agents and Logs. Include global sidebar, bottom navigation, notifications, command palette, fullscreen panels and all related popup states. Route names are derived from App.tsx at the starting commit; keep the inventory synchronized with later changes.

## Desktop security and autonomy contract

- A task grant includes device, allowed app/site/folder, duration, maximum steps/cost and allowed action classes. The local executor validates it independently of server requests. Secrets stay in OS credential storage; device credentials are revocable.
- Routine clicks within an approved task need not prompt individually. Sending, publishing, purchasing, deleting, permission changes and other sensitive transitions require the applicable separate approval. No opaque generic shell command channel exposed to every agent.
- Screen/web/file content is untrusted data, never authority to change the task or disclose credentials. Test malicious pages, downloads, redirects and stale elements. Approved external tools do not gain blanket authority.
- Stop/takeover must function locally even when the network fails. Never silently resume a destructive operation after reconnect. Persist checkpoints and reconcile external effects before retry.
- A sleeping/offline/locked PC is not an available local executor. Cloud jobs run only on explicitly designated cloud resources; do not pretend that a cloud browser controls the user's PC.
- Screen content may be confidential. Capture scope/retention and remote-model processing require informed user choices. Unverified/free-model offers are not default destinations for desktop screenshots or company data.

## Evidence vocabulary / final scoring

SOURCE = code exists; V1 = automated tests; V2 = rendered/browser test with synthetic data; V3 = observed real-account/real-device task; LIVE = exact deployed release checked. Never equate those labels.

Assess each of: mobile/usability, task completion and reliability, integration correctness, desktop execution, security/tenant isolation, recovery/operations, performance, cost accounting and maintainability. Score 0–5 per area only with supporting evidence; untested areas are UNVERIFIED rather than invented numeric quality. Provide Changed / Tested / Passed / Failed / Remains after each stage.

## M1 work started in this commit

A shared responsive stylesheet applies bounded scrollable Base UI dialogs, wrapping long labels/buttons/segmented controls, and min-content-safe statistics/key-value layouts on phones. Layout flex containers receive min-width:0 so child screens can shrink. No root overflow-hiding fix, no font shrinking, no navigation removal, no API/auth/database/routing changes. The isolated fixture renders the real Dialog, PageHeader, Segmented and Stat components with synthetic content and tests geometry/interactions across viewports. It is NOT the full page matrix or physical-keyboard test.

CI/browser outcomes will be written into the M1 verification checkpoint after execution, not assumed here. No production promotion or installer distribution is part of M1.

## Owner steps and boundary

No new Hostinger command is needed for the free models already registered or for this candidate mobile work. Future owner-only actions are limited to unavailable server access, registering/provider-consenting OAuth apps, and physical-device installation/permission/microphone checks. Use secure provider dashboards, not passwords/tokens in chat. Work performed through available connected tools should not be handed back to the owner unnecessarily.

## References consulted

- W3C Reflow: https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- Playwright device emulation: https://playwright.dev/docs/emulation
- Tauri signed updates: https://v2.tauri.app/plugin/updater/
- Actual connected GitHub/Vercel reads plus owner-supplied report above. This plan does not certify WCAG compliance or production readiness.
