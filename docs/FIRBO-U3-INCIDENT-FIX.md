# Firbo U3 incident checkpoint — gateway connectivity, OCI verification, integrations

Date: 2026-10-03. Continue draft PR #9 and FIRBO-PRODUCTION-PLAN.md. Do not restart the audit.
Implementation commit: `4365fb042aebb09debca3ee0a1990ee8b38a70f7`.
Public diagnostic workflow: `d15c039e8fcda2138862675425f6f6a4e20377c2`.
The current production deployment was re-read through Vercel: still `50bea79`, deployment `dpl_8MfPgVXcD8oPWSp4JsU9JJd2Vdxd`, READY. No promotion/merge occurred.

## Observed live public HTTP evidence — NOT authenticated account testing

GitHub Actions run 37092811260, job 111116548116, 2026-10-03 03:19 UTC. Requests used no API key, session or credentials and made no model call.

| Request | Result |
|---|---|
| firboai.app document | HTTP 200. Compiled main bundle contains the intended api.firboai.app and gateway.firboai.app addresses, as well as old local-settings code. |
| api.firboai.app/health, Origin=https://firboai.app | HTTP 200 JSON, Access-Control-Allow-Origin=https://firboai.app, no native-control contract. |
| OPTIONS /v1/gateway/overview requesting GET + Authorization | HTTP 200; GET/OPTIONS and Authorization allowed; correct Firbo origin. |
| GET /v1/gateway/overview without Authorization | HTTP 401 JSON and correct CORS origin. This is an expected authentication boundary, not proof of authenticated success. |
| gateway.firboai.app root | HTTP 307; X-Frame-Options: DENY; CSP includes frame-ancestors 'none'. |
| gateway.firboai.app/api/health | HTTP 200; same frame-denying headers. |

**Confirmed:** the current gateway response forbids embedding. This explains rejection inside the old Admin iframe; the iframe-free U1 console is not yet live. Do not disable framing restrictions globally as a shortcut.

**Not confirmed:** the exact cause of the owner's authenticated `Failed to fetch`. A public health check is not that request. The working GET preflight rules out blanket GET CORS failure for the canonical origin at the time tested. The old API still allows only GET/OPTIONS, so the separately known POST limitation remains until the matching server update.

## Code fix for the endpoint-selection defect

The old `frontend/src/lib/api.ts:getBase` prioritizes `openjarvis-settings.apiUrl` above the deployment VITE_API_URL. A stale localhost/HTTP/other-server setting can therefore divert the Gateway request even when the deployed URL is correct.

Added gateway-specific `frontend/src/lib/gateway-api.ts` and wired the existing gateway client to it. On the canonical Firbo domains the API origin is pinned to `https://api.firboai.app`; preview/cloud configuration is deployment-owned and validated. Desktop and local development resolution remain separate. A missing browser session does not fall back to a locally saved desktop API key. No general navigation or account settings are deleted.

14 new frontend test cases cover canonical/preview/desktop/local resolution, malicious suffixes, malformed credential-bearing URLs, and cloud-vs-desktop authentication fallback. This fixes a real code defect but does not assert that the owner's current browser has that stale setting; that needs the browser check below. No frontend or backend deployment was performed.

## Recovery verifier compatibility defect and fix

Owner report: the original capture returned `saved_image_identity_mismatch`, after `configuration_roundtrip_verified=true`, with sufficient free disk and deployment_performed=false. The exact owner directory is deliberately not repeated in this public document.

The old verifier compares the saved config hash with the running image ID. Docker/containerd exports can identify an image by a linked manifest/index digest instead. A synthetic OCI export reproduces that false negative in the original verifier. This is a demonstrated compatibility defect; the actual private VPS archive has NOT yet been examined by the assistant and must still pass the corrected validation.

Added standalone `deploy/hostinger/recovery_continue.py`:
- Reuses an existing private directory; does not perform another image export or recreate backup archives.
- Accepts legacy config identities and OCI index/manifest/config identities only through a validated descriptor graph rooted in index.json. OCI descriptor sizes and SHA-256 contents are checked, including layer blobs.
- Does not accept an arbitrary matching filename or an unlinked blob. Corrupt/missing blobs, duplicate JSON/tar entries, unsafe paths/symlinks and unrelated IDs are rejected.
- Revalidates the private captured config against current files and the four pinned running containers; detects runtime/config/archive changes during validation.
- Reads private archives, selected Docker configuration and current config files locally. Emits only sanitized booleans, checksums and status. No credential value is sent anywhere.
- Creates only new 0600 checksum/report files inside the root-only backup directory. Existing archives remain unchanged. No network, docker save/load/exec/run/restart, deployment, DB access or remote upload occurs.
- Scope remains LOCAL CONFIGURATION + API IMAGE. It is not an encrypted/off-host backup, mounted-data backup or application restore/boot test. Legacy archives retain structural layer checks, not OCI descriptor-hash coverage.

Script blob: `3e8a827af7035eea2b5a1b890104827d9704e373`.
SHA-256: `2b150314966867c60055701b9ca0b545b28d0e20da65638bbf9a24bf3d5bda07`.
Use the new continuation for the existing archive, not the old --capture command again.

## Verification actually obtained

- 19 new continuation tests PASS locally, including reproduction of the original false negative and complete synthetic reuse without re-export.
- Python compilation PASS; local script's Git blob hash matches the uploaded blob.
- Final diagnostics workflow 37093379087 SUCCESS, including old preflight, original capture, and new continuation suites.
- Final Frontend CI 37093379098 SUCCESS; job 111118264300 explicitly confirms npm test, native/routing suites, isolated SDK-stub Edge check, full TypeScript and production build all passed.
- Dependency release gate 37093379119 SUCCESS.
- Control-plane security 37093379059 SUCCESS.
- Existing security-sast 37093379134 was still running at the last recorded check; do not infer its final result from other jobs.

Mocked tests are not proof of live RLS, real-account UI, credentials, provider inference or physical microphone operation.

## Immediate owner steps

1. In the LIVE Firbo Settings -> AI Server, check the API/server URL. It should be `https://api.firboai.app`, not the gateway dashboard, localhost or an HTTP address. Change only that URL if incorrect, save and refresh. Do not enter gateway management keys in the browser. This is a check/workaround for the old production client, not deployment of the new code.
2. If the error persists, use browser developer tools -> Network, filter `gateway/overview`, refresh once and report only Request URL and Status plus the browser's short error. Do not copy Authorization/Cookie headers, stored sessions or a full HAR.
3. In the same root Hostinger console, download the checksum-pinned `recovery_continue.py` from implementation commit 4365fb0 and run `python3 FILE --directory EXISTING_CHECKPOINT_DIRECTORY`. The exact known directory and complete command are supplied privately in the delivery message. Send only the JSON `firbo-recovery-resume/v1`. Success is `verified_existing_checkpoint`; if blocked, stop without restarting services or deleting private files.

## Four requested integrations — actual scope, not a label switch

The current frontend explicitly lists TikTok, YouTube, Salesforce and QuickBooks in PLANNED_APPS, not LIVE_APPS. This is a separate missing implementation, not caused by the gateway fetch error. This changeset does not activate or advertise them as live.

Required implementation for each: tenant-bound OAuth consent/state and callback handling, server-only refreshable credentials, safe connection verification, revocation/disconnect, role/approval enforcement for writes, durable job/result recording, and real-account testing. Credentials and provider approval cannot be manufactured by changing UI labels.

| Integration | Implemented capability to target | Owner/provider prerequisite before real live use |
|---|---|---|
| YouTube | Connect channel, verify owner, upload via controlled/resumable job, report processing/privacy/result, retain human approval for publishing | Google project with YouTube Data API and OAuth consent/client; authorized channel; unverified API projects have private-upload restrictions until the required audit. A private test upload is not proof of public publishing. |
| TikTok | Creator/account verification, compliant consent/privacy UI, video upload/direct-post flow and result polling | Registered TikTok app, Content Posting API and granted user scopes. Unaudited Direct Post has private-viewing restrictions; public capability depends on audit. Respect the provider's intended-use and consent requirements. |
| Salesforce | Connect authorized org, role-scoped reads first; reviewed CRM writes through approval | OAuth External Client App or an eligible existing Connected App and org authorization. Current Salesforce docs restrict creation of new Connected Apps; do not blindly follow the older 'create Connected App' wording. |
| QuickBooks | Company connection, read-only accounting summary first; no automatic invoice/payment mutation | Intuit app and matching sandbox/production credentials, approved production-key questionnaire when applicable, consent by the actual company. Sandbox success is not a production-company test. |

Do not mark `connected` solely because credentials exist or `live` solely because an OAuth screen opens. Track not_implemented / setup_required / connected / verified_capabilities / error separately. This roadmap does not itself implement the four adapters.

## Not changed / still required

No production Vercel promotion, Supabase deployment or SQL mutation, agent model/secret change, DNS change, Hostinger container modification, real provider call or posting occurred. Earlier U1/U2, dependency remediation and existing UI are retained. Complete data/off-host backup and restore, matching backend installation, authenticated native UI/inference/fallback, mission/audio/ledger/budgets, migration and MCP/shift fixes remain under the production plan. Do not restart from scratch or claim production readiness from a green build.

## Primary references

- Public HTTP evidence: https://github.com/conpol84/javris-clone/actions/runs/37092811260
- Docker containerd storage: https://docs.docker.com/engine/storage/containerd/
- Docker/containerd exporter: https://raw.githubusercontent.com/moby/moby/master/daemon/containerd/image_exporter.go
- OCI index and manifest specifications: https://github.com/opencontainers/image-spec
- YouTube API videos: https://developers.google.com/youtube/v3/docs/videos/
- TikTok Content Posting: https://developers.tiktok.com/doc/content-posting-api-get-started
- Salesforce REST OAuth: https://developer.salesforce.com/docs/platform/api-rest/guide/intro-oauth-and-connected-apps.html
- Intuit client credentials: https://developer.intuit.com/app/developer/qbo/docs/get-started/get-client-id-and-client-secret
