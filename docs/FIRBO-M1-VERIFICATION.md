# Firbo M1 — mobile foundation verification and next checkpoint

Verified: 2026-10-03. Continue draft PR #9 and `docs/FIRBO-MASTER-PLAN-V2.md`. The revised plan changes sequencing, not the safeguards or unfinished U1/U2 work. Do not restart the audit or repeat completed Hostinger recovery/catalogue commands.

## Release identity — live is not the development head

- Live Firbo: `ae82ca939f1a19130871c6ad7661f22be200d3c0` on `claude/omniroute-engine`.
- Connected Vercel read resolves `firboai.app` to `dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM`, project `prj_tNGCKDtXfH6ohh9i4UbqPkL53KJa`, READY / production.
- Actual live `/firbo-backend-health` at 13:48:20 UTC: HTTP 200 JSON `{"status":"ok"}`, Via Caddy, Cache-Control and CDN-Cache-Control no-store, cache MISS.
- Latest TESTED M1 code: `2d8f6ef9a6386e65d690c9a748c9c94acf70c0db` on `codex/firbo-unified-gateway`. This documentation commit is a later record, not a new tested implementation.
- The M1 code and the full native console/desktop work are NOT on production. PR #9 remains draft; no merge, promotion or VPS/backend deployment occurred in this work unit.

## Changed

M1 starts with real shared UI, rather than arbitrary page redesign: bounded vertically scrollable Base UI dialogs; flex/grid min-content containment; wrapping long headings, actions, segmented tabs, statistics and key/value values; phone touch controls with a 44px minimum; sensible phone form text; logical-end modal close position for RTL; and reduced-motion support for modal portals outside `.fb-root`.

The existing page structure, navigation, feature set and theme identity are retained. Root overflow hiding is not used as the acceptance mechanism. The browser fixture explicitly removes root clipping to expose horizontal overflow. Existing application fonts/theme are reused; external network access is blocked during tests, so typography falls back locally rather than proving remote font delivery.

Implementation history:
- `15f9c2f00ccfd3dd871322673731778324450d4c`: initial mobile stylesheet/Layout containment, real-component fixture, workflow and revised master plan.
- `82b74a39456ab289d86b07f8e67c5931fd95aafa`: repair test-only Tailwind discovery; add all eight sample-language labels and stronger interaction/focus tests.
- `17f63674d15a6bed1c5eb5751c0c7f2a1d51cd05`: robust mobile touch minimum and logical RTL close positioning, with additional close-button assertions.
- `2d8f6ef9a6386e65d690c9a748c9c94acf70c0db`: respect reduced-motion on actual modal portal nodes. Normal animation remains available when the preference is not enabled.

## Failed, diagnosed and corrected

1. Initial mobile run `37126481096` failed because the isolated Vite test root did not generate all application Tailwind utilities. The Dialog lacked its expected fixed positioning. This was a test-harness defect, not proof that the live dialog had that exact position. A test-only CSS entry now explicitly scans the real frontend sources; no production safelist or geometry assertion was weakened.
2. Run `37127107671` passed 24 of 25 cases. Its single-line Chinese action exposed the legacy 40px minimum overriding the intended 44px mobile touch size. Selector specificity was corrected without shrinking text or skipping the case.
3. Run `37127407511` caught the dialog's scale animation despite the user's reduced-motion preference: the older rule reached only descendants of `.fb-root`, while the popup was portalled outside it. The actual preference handling was fixed in application CSS. Target-size assertions remain unchanged.
4. Final run `37127595969` passes all 25 scenarios. No remaining failure in this shared-component suite is suppressed.

## Passed: final real-browser evidence

Final browser run `37127595969`, job `111215983232`, tested code `2d8f6ef9a6386e65d690c9a748c9c94acf70c0db`.

Downloaded artifact `11274798380`, `firbo-m1-reflow-evidence`:
- ZIP SHA-256: `04c631dca0deeb792616fee94b7c403d76cac560dcf235ec16508bdd1256b5ee`.
- `results.json` read directly: **25 passed, 0 failed**.
- Six synthetic screenshots retained. Greek narrow-screen controls and a scrolled Arabic dialog were also visually inspected after download. The Arabic screenshot intentionally shows the lower fields after scrolling, not a missing dialog title.
- Chromium runs against actual Dialog, PageHeader, Segmented and Stat components with synthetic content. All network destinations except the local fixture server are blocked. No real account, API key, database response, company data or AI inference is used.

Matrix: EN/dark at widths 320, 360, 390, 412, 768, 1024 and 1440 with height 800; seven additional sample languages (Greek, Arabic, Spanish, French, German, Brazilian Portuguese, Simplified Chinese) at widths 320 and 390; light-theme samples 320x800 and 1440x900; short viewports 390x320 Greek and 320x256 English. Sample labels test layout pressure and RTL; this is not verification of every translation in the application.

Checks include page/element horizontal overflow, wrapping long unbroken strings, tab selection, phone touch-target size, actual fixed modal positioning, modal viewport bounds and scrolling, editing the final field, logical close-button position, footer/icon/Escape closing and restored trigger focus.

## All eight final PR workflows completed successfully

| Workflow | Run ID | Result |
|---|---|---|
| M1 shared-component reflow | 37127595969 | SUCCESS; 25/25 browser cases |
| Frontend CI | 37127596030 | SUCCESS |
| Connectivity candidate | 37127595949 | SUCCESS |
| Dependency release gate | 37127596112 | SUCCESS |
| Control-plane security | 37127596049 | SUCCESS |
| Free model catalogue | 37127596023 | SUCCESS |
| VPS diagnostics/recovery | 37127595926 | SUCCESS |
| Existing security-sast | 37127595974 | SUCCESS |

These are the returned pull-request workflows for the exact code head. Mocked backend tests, a passing registry audit and a compiled frontend do not prove live tenant isolation, provider execution, restore readiness or complete mobile usability. The isolated Edge typecheck still has its previously documented SDK-stub limitation.

## Free-model checkpoint retained

Owner report at `2026-10-03T12:59:48.576433+00:00`: seven OpenCode models registered, zero inference requests, existing combos and runtime unchanged. OpenRouter requires a provider connection. The previous 'run --apply' next-owner instruction is superseded: the user HAS run it. Do not repeat it.

Registered: `fledge-alpha-free`, `ling-3.0-flash-fin-free`, `ling-3.1-flash-free`, `longcat-2.5-preview-free`, `mimo-v2.5-free`, `mimo-v2.6-flash-free`, `space-bunny-free`.

Registration does not prove execution, vision/tool-call capability, reliability or enforced zero-cost routing. Company/screen data must not be sent automatically to unverified free providers.

## Not changed / not tested

No production alias, Hostinger service, Supabase function/schema/data, provider credential, agent selection, routing profile or unrelated sports project was changed. No real model request, paid service, installer deployment or remote-control session was initiated.

M1 is a shared-component pass, NOT completion of all pages. Physical Android/iOS, the actual on-screen keyboard, Safari, full authenticated screens, nested dialogs, full navigation, every loading/error/large-data state, desktop automation and full accessibility compliance remain unverified. A short viewport approximates restricted space; it is not a hardware-keyboard test.

The previously verified recovery checkpoint remains LOCAL configuration + API-image validation only; database/volume backups, encrypted off-host copies and application restore/boot are still open. Gateway key values were equal in the last owner report. Native backend/console, all-path routing, durable accounting, atomic budgets and security hardening remain required.

## Next stage — M2

Apply the existing full route inventory from MASTER-PLAN-V2, beginning with Command Center, Gateway tabs, Settings, Companies, Chat and Admin; then the remaining pages and popup states. Render actual pages with isolated synthetic fixtures where possible, then perform real-account/mobile acceptance. Keep a per-route evidence matrix; do not label all pages ready from this M1 pass. Preserve navigation and product identity.

Desktop follows D1 installer/pairing, D2 visible local browser, D3 opt-in OS mouse/keyboard; each has independent permissions, Stop/takeover and real-device gates. TikTok/YouTube/Salesforce/QuickBooks require real adapters and provider authorization, not a relabeled 'Live' badge. Final assessment uses evidence per feature and area, not test/model counts alone.

No new Hostinger command or user confirmation is needed to continue candidate mobile work. Do not promote the full PR solely because all eight workflows are green.

## Primary references

- https://tailwindcss.com/docs/detecting-classes-in-source-files
- https://www.w3.org/WAI/WCAG22/Understanding/reflow.html
- https://playwright.dev/docs/emulation
- https://v2.tauri.app/plugin/updater/
- https://github.com/conpol84/javris-clone/actions/runs/37127595969
