# App connection readiness candidate — 6 October 2026

## Changed

The Integrations page previously offered legacy OAuth sign-in before checking
whether the platform had registered provider credentials. Errors from the six
new read-only adapters were reduced to a generic OAuth failure; legacy
`save_failed` responses were reduced to `unknown`.

- Added authenticated, company-manager-only `integration_manifest` metadata
  for the 11 Google/Microsoft/LinkedIn/Dropbox adapters. It returns configuration
  booleans and the callback address, never client IDs, secrets or account data.
  It performs no provider request, message send or credential write.
- The page checks both manifests concurrently. Missing provider credentials
  show setup before sign-in; token/webhook apps explain the required input.
  Database setup, disabled runtime, missing credentials and unapproved device
  origins have distinct explanations. A failed check offers retry and does not
  pretend the server is configured. Legacy sign-in remains usable when an older
  server cannot supply the new manifest; the six adapters still require their
  existing readiness gate.
- App deep links now open every supported app, rather than only the six new
  adapters. Errors remain visible in the form. Expired authorization, missing
  scope, save failures and provider HTTP 401/403/429 are explained separately.
  Salesforce/QuickBooks sandbox configuration is visible before authorization.
- Legacy authorization redirects must use the expected provider HTTPS host,
  with no embedded credentials or alternate port.
- Runtime opt-in, approved device origins, account consent, restricted reads,
  atomic credential persistence and company-manager authorization are retained.
  This change does not enable publishing or financial writes for the six adapters.
- New diagnostics have English/Greek text; other selected languages retain
  existing translations and explicitly fall back to English for these diagnostics,
  consistent with the existing device messages.

## Setup that still requires real platform/account access

Configuration presence is readiness metadata, not proof that a client registration
is approved or that an account can be authorized.

| Connection group | Platform setup | User input/consent |
| --- | --- | --- |
| Gmail, Google Calendar/Drive/Sheets and their read adapters | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, registered callback and corresponding APIs/scopes | Google account authorization; Sheets also needs a spreadsheet and range |
| Outlook write/read | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, registered callback and scopes | Microsoft account authorization |
| LinkedIn / Dropbox | Matching `LINKEDIN_…` / `DROPBOX_…` client ID and secret, callback and provider products/scopes | Provider account authorization |
| YouTube / TikTok / Salesforce / QuickBooks | Deployed connection schema, `FIRBO_CONNECTIONS_ENABLED=true`, corresponding provider client ID/secret; Salesforce/QuickBooks environment selection | Provider authorization; Salesforce/QuickBooks default to sandbox |
| Home Assistant Devices / Traccar | Deployed connection schema, enabled runtime and exact HTTPS origin in `FIRBO_DEVICE_ALLOWED_ORIGINS` | Access token, server address and explicitly selected resource IDs |
| Other token/webhook apps | Existing adapter; separate MCP service for MCP servers | Actual provider token/webhook and the listed destination/account details |

The callback shown by the server is
`https://bfeinnsorgjycivozcau.supabase.co/functions/v1/integrations` for the
current production Supabase project. Register it exactly in the relevant
provider application. Do not put client secrets in frontend environment values.
Some messaging connections send their stated verification message when the user
submits connection details; this review ran only synthetic, isolated fixtures.

No provider registration, production secret, account consent or live integration
was changed. The production integration table remained empty at inspection.
The available tools do not expose an operation to configure Edge environment
secrets, and provider-owned registrations cannot be fabricated.

## Tested / passed

- 27 actual legacy handler tests, including manager/auth denial, all 11 OAuth
  readiness entries, absent/blank credentials, private-data filtering, atomic
  save failures and provider 401/403/429/503 errors.
- 516 frontend tests; 532 non-rendered top-level Node tests on the combined
  source. These suites are separate; earlier handler subset counts overlap
  the Node suite and must not be added to it.
- Strict frontend/Edge TypeScript, production frontend build, isolated world
  workbench build, Python browser-check syntax and diff checks.
- All four retained live integrations v29 dependency files exactly match the
  pre-change shared source by length and FNV-64 content comparison.
- Preserved mission accounting implementation `b582ce8`, app implementation
  `2cdb3ac`, Claude cleanup `22e5480`, new Claude runner `500e4e9` and the current
  Codex parity history `ce421e3`. Combined runtime source is `2c28393`.
- Final live reread: frontend remains `dpl_EKo9oCXqxyCZpSQpjzxQUBHUQbqp`,
  integrations v29, mission-runner v26; Claude concurrently released runner v84.
  All 12 runner v84 dependency files match the combined candidate by content
  comparison. Do not redeploy that unchanged runner. Connected integrations: 0.

## Failed / pending

- Rendered browser checks remain unexecuted: no browser binary was installed.
  Agent-browser installation failed certificate validation; the Playwright
  installer received truncated/non-ZIP Chrome downloads. No verification server
  was started and no browser success is claimed. Existing layout/company/device
  tests were preserved, with additional checks for 11 setup dialogs, ready state,
  deep links, inline failures and retry. Exact-head CI must execute them.
- Git push was rejected by automatic approval review despite the user's request
  to upload. Its reason was insufficient explicit authorization for code egress
  to the exact GitHub repository. No API or alternative route bypassed rejection.
- No PR, exact-head CI, migration or function/frontend deployment for this
  candidate has run. The existing production release remains in place.

## Remains

Obtain accepted authorization for the exact repository upload, re-read concurrent
branches/live state, run exact-head CI including PostgreSQL accounting/races and
rendered connections, then release the accepted source. Deploy integrations
with its matching shared files before/with the new frontend. Apply only the new
mission migration and deploy its matching mission bundle when its gates pass.
Do not replay already applied migrations. Do not deploy Claude's runner again
without first checking whether the concurrent session already released it.

Configure actual provider registrations/secrets and approved device origins,
then perform legitimate signed-in account checks. Preserve real-device,
second-company and inference-reconciliation acceptance as separate open gates.
