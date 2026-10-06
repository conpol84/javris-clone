# FIRBO CEO work-source proposals — 6 October 2026

Base: Claude checkpoint `445933907548f9cc240f08bbb6c06b1f3b33cb59`

Branch: `codex/firbo-work-source-proposals-20261006`

Released by PR #20: merge `6a5f36893bfab60802630b9364a5f6ba18841b47`,
accepted head `ad9bdd334276d084d34a2f984c98393c2979f48f`, tree
`60ca01aa46f0d6e180e9c1742a02a184a66fdf49`.

## Changed

- The CEO can propose one relevant, not-yet-connected company work source:
  Google Drive read, Gmail read, Google Calendar read, Outlook read, Notion or
  GitHub.
- `agent-chat` reads integration kinds only inside the current organization. It
  fails closed: if that read fails, no source is offered. Existing kinds are
  excluded from the model's available list.
- The model's final `APP:` line is converted server-side only when it matches the
  caller-provided allowlist. Unknown or already-present kinds are removed rather
  than rendered.
- The frontend independently allowlists the same six kinds and renders a review
  link to `/integrations?connect=<kind>`. The link does not grant consent, save
  credentials or connect an account.
- Suggestions render in CEO chat, agent chat and the voice console. The marker is
  removed from Telegram/WhatsApp replies because those channels cannot render the
  setup control. Labels were added in all eight app languages.
- No database migration, permission change, connector job or external message is
  part of this change.

## Tested

- Backend parser/combination tests: 21/21 passed.
- Expanded edge/meeting/briefing suite: 110/110 passed, including two new
  organization-scope and fail-closed integration-state cases.
- Focused frontend parser/render tests: 19/19 passed.
- Full frontend suite: 485/485 passed.
- Frontend TypeScript build and the edge-function strict typecheck passed.
- Production frontend build passed. The existing large-chunk and analytics
  dynamic-import warnings remain unchanged.
- `git diff --check` passed.

## Passed evidence

- Source: organization-scoped integration query, server and client allowlists,
  explicit setup-only route, and provider-secret prohibition are present.
- Automated: supported, unsupported, unavailable, combined task/meeting/app and
  rendered-link cases pass.
- Rendered/build: the production bundle contains the new CEO action component.

## Released / live evidence

- All six exact-head PR workflows passed: security SAST, workspace lifecycle and
  atomic persistence, local voice/model compatibility, Computer Manager and
  operational pages, local voice rollout guards, and Frontend CI.
- `agent-chat` v37 is ACTIVE with `verify_jwt=false`, preserving the v36 setting.
  Its deployed digest is
  `b1c43445c02db5c4fcfeb305c0c86639fa8e7d91d7652ecb52a24870563f24aa`.
  All seven deployed files match the merge source exactly; the five unaffected
  shared dependencies also matched v36 before deployment.
- Vercel preview `dpl_DmLtiQGPUnskRWh2wEukHZRGQzXR` was READY, then immutable
  source `6a5f368` was redeployed with `withLatestCommit:false`. Production
  `dpl_D6XHthZAmsy8sCUJJxVXoAqVE51g` is READY and owns `firboai.app`.
- Public `firboai.app` rendered successfully and served
  `CeoActions-Bm-t-Vpx.js`, which visibly contains the six-kind allowlist,
  `[[app:...]]` parsing and `/integrations?connect=<kind>` link construction.
  Production error/fatal runtime-log scan for the new deployment was empty.
- Rollback frontend remains `dpl_2YoUFySmGW3MCgwVyPNCTx52LHBN` at `e250eeb`.
  Backend rollback must retain schema-aware connector v27, runner v83,
  agent-chat v36 and mission-runner v26 or newer.

## Failed / limitations

- The first focused run correctly failed because `_` in `gdrive_read` was being
  stripped as presentation markup. The sanitizer was corrected and the complete
  focused and full suites then passed.
- The first expanded edge run exposed that its database double did not yet know
  the new `integrations` read. The mock gained an organization-bound table case;
  all 110 cases then passed.
- Direct Vercel promotion of the READY preview returned 422, so production used
  the established pinned redeploy path from that exact preview. The resulting
  source SHA and production aliases were verified.
- This release does not claim signed-in, provider-consent, refresh, revoke or
  real provider read-back acceptance. No integration row was created for a test.

## Remains

- Signed-in CEO proposal acceptance and provider-specific Google/Microsoft
  consent, refresh and revoke proof.
- Signed-in meeting and delegated-task acceptance.
- Existing Mac runtime update and real browser/Stop/offline/saved-artifact proof,
  approved Telegram/WhatsApp message tests, second-customer isolation and the
  remaining master-plan gates listed in the continuation.
