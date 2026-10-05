# Scoped browser executor — acceptance checkpoint

Release update: the combined Claude/Codex source `7f915df` is now live at
firboai.app (deployment `dpl_8eRbAYqUgBuz61P1ZeRs9n2tBv4S`). It includes Claude
`6f5aa78` and preserves AI employee computer access. All 20 exact-source CI runs,
including real Chromium and page checks, passed. Both downloadable modules match
the published source. See FIRBO-CONTINUATION-20261006.md for current evidence.

## Preserved release

Claude branch `claude/gifted-dijkstra-rph5j8` through `6176549` was merged into
`codex/firbo-reconcile-20261005` at `48e0b552`. Commit `e9fb240` is an ancestor.
The live agent-chat v34 already contains its focused task result/work-log logic.
All seven live files match the merged behavior; the only byte difference is an
equivalent Unicode combining-mark regex. No agent-chat redeploy is necessary.
All returned PR CI runs for the merge passed. PR #13 remains CI-only, never merge.

## New source

- Optional `browser_task`, separate from `browser_open` and shell execution.
- Existing Computers page includes a step editor only for an opted-in device.
  Eight locales are provided; company/role/device changes discard the editor.
- Every task opens a fresh, visible Chromium context with no personal browser
  profile. Supported steps: open, read, click, fill, scroll, upload, download.
- Local command-line sites are exact HTTPS origins. Remote jobs cannot expand
  them. Max 20 steps, 5 minutes, 200 HTTP requests, bounded responses and output.
- Every plan is reviewed locally. Click/fill/upload and actual non-GET requests
  have additional local confirmation. `--auto` never bypasses browser approval.
- HTTP requests are routed through public IPv4 DNS validation and address-pinned
  TLS requests. Redirects are checked independently. WebSockets, service workers,
  extra tabs and automatic downloads are blocked. Unsupported resource hosts fail
  closed; explicitly include required public origins at local startup.
- No arbitrary JavaScript, shell, screenshots, cookies export, password-field
  fill or implicit filesystem grants. Page text is marked untrusted.
- Upload requires an allowed file root. Download requires an allowed root AND
  write permission, exclusive creation and SHA-256 read-back. Direct downloads
  currently support public HTTP 200 URLs, not authenticated/redirected downloads.
- Closing the browser window or Ctrl+C stops execution. The existing SQLite job
  journal prevents automatic replay after interruption or lost acknowledgment.
  Stopping a task cannot undo an external effect already approved and performed.
- The default Connector and already-paired Mac are not upgraded automatically.

## Install on an already paired Mac (after release)

Download both `firbo-connector.mjs` and `firbo-browser.mjs` from Firbo into the same
Downloads folder. Stop the old Connector. Do NOT pair again.

```bash
npm install --prefix "$HOME/.firbo-browser-runtime" --save-exact --ignore-scripts playwright@1.63.0
node "$HOME/.firbo-browser-runtime/node_modules/playwright/cli.js" install chromium
node "$HOME/Downloads/firbo-connector.mjs" run --browser-site https://example.com
```

The site is an example, not blanket permission. Add another `--browser-site`
argument for each site you choose to authorize during this run. The existing
local config must already permit browser opening. File operations remain off
unless separately granted during pairing. Keep the Terminal visible: it shows
the plan and local approvals. The website shows the additional browser task
editor after the new capability heartbeat. No shell grant is needed.

This is a CLI candidate, not a signed installer, OS sandbox or proof of complete
desktop control. Sites using unsupported resource hosts, WebSockets, popups or
service workers may not work. No claim of support for every site is made.

## Verification boundary

Local targeted tests cover local/remote grants, protocol validation, private DNS,
address pinning, consent, sensitive fields, Stop, tenant/role checks and existing
durable delivery. TypeScript and production build pass. Chromium installation in
this workspace returned truncated ZIP files, so local rendered execution is NOT
a pass. A dedicated CI workflow runs actual visible Chromium under Xvfb using
exclusively synthetic in-memory HTTP fixtures, plus the existing page lifecycle
CI tests the step editor at 320 and 1440 px. Both passed on the released source.

## Remaining master plan

The browser stage now has exact-source CI and release read-back; actual Mac
installation/use acceptance remains. Real restart/offline/phone/voice/revoke acceptance
remains owner-device work; do not revoke a working device just to create evidence.
Useful-work acceptance still needs a real approved deliverable and consistent
Tasks/Computers/Activity/voice receipts. The new editor currently queues direct
Computer jobs, not an invented agent task orchestration or voice chain.
OAuth consent/refresh/revoke, Free budgets/request accounting, native/shared
routing key scopes, signed desktop distribution, OS input, physical voice/mobile
testing, off-host encrypted restore and final production assessment remain open.
Preserve master plan v2 and the latest continuation; do not restart prior audits.
