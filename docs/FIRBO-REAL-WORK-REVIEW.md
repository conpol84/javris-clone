# Firbo real-work review — existing backends, reference images and execution correction

2026-10-03. Continues PR #9 from 08ae6d4399af3fac606d060675eb8bc40726b64e. Keep MASTER-PLAN-V2 and the 34-route / 19-requirement delivery inventory; this is a focused execution-priority addendum, not another app or a fresh audit.

## The backend question

YES, javris-clone contains a substantial Python backend. `src/openjarvis/server/app.py` creates the full OpenJarvis application, with inference runtime and routers. `server/api_routes.py` includes agent lifecycle/tool operations, memory and other APIs. Local browser tools and native-agent code also exist.

BUT the Hostinger compose command explicitly starts `openjarvis.server.firbo_app:app`, NOT the full app. The currently deployed frontend's version of firbo_app.py documents itself as a small gateway API and mounts only gateway_router. It does not initialize the full inference/agent engine. The compose file's introductory comment mentioning legacy chat/agents is therefore misleading relative to its actual command; use the executable configuration as evidence.

The Firbo business backend is a separate Supabase implementation. A fresh connected read returned 12 ACTIVE Edge Functions: agent-runner v19, agent-chat v9, integrations v9, admin-overview v5, mission-runner v5, shift-runner v5, agent-speak v5, billing v5, stripe-webhook v5, connector v5, agent-listen v1, mcp v1. ACTIVE means deployed, not proof that each business flow works.

The live agent-runner v19 was read: it gathers optional search/page material, calls a language model, parses a report and proposed actions, and queues outward actions for approval. Its model request has no general tools/tool-call execution loop, and explicitly instructs the model not to send/publish/pay/change things itself. Calling this equivalent to the full OpenJarvis orchestrator would be incorrect. A separate integration executor may implement selected approved actions; this review does not claim that no external action exists anywhere.

OmniRoute is model routing; a model catalogue does not install the Python engine, connect a PC, supply approved tool credentials or verify an external task. The browser/frontend is not a replacement for a worker.

The full OpenJarvis runtime should be reused behind a Firbo job/security adapter or in the local Desktop runtime. Do NOT just replace the public API entrypoint or expose legacy local-machine/file/shell endpoints to every company. Company context, device identity, capability limits, job ownership, approvals, audit and idempotent leases must be enforced at the execution boundary, not supplied by untrusted model output.

## Source / deployment boundary

Fresh Vercel read still returns firboai.app -> ae82ca939f1a19130871c6ad7661f22be200d3c0 / dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM, READY and production. PR #9 is draft. The candidate mobile, native console, routing and Computer Manager work is not all in that live build. No production service, database function/schema, token, device pairing or provider setting was changed during this review.

## Nine uploaded reference images reviewed

Archive: `New folder (2).zip`, nine image files, no application source. The images themselves are NOT copied into this public repository.

- `images (1).jpg`, `images (2).jpg`, `images (3).jpg`, `images.jpg`, `jarvis-knowledge-hub.webp`: cinematic/promotional-looking compositions. Useful for art direction, not proof of real holographic hardware or deployed capabilities. Origin/generation method was not established.
- Two filenames explicitly refer to `sites.blink.new`. They are screenshots of other named Jarvis projects, not evidence that they share this repository's backend. Their functional claims were not independently execution-tested.
- `jarvis-command-center-real (1).webp`: strongest workbench reference — activity feed, active agents, mission timeline, quick actions, memory and provider status. Recommend borrowing hierarchy and readable status, not copying brand/assets or inventing CPU/latency values.
- `mt03ga3u09ff1.png`: its conversation visibly says 'JARVIS backend is offline' while a top status says Online. This directly illustrates why a convincing dashboard/green dot is not sufficient proof of a functioning agent.
- The voice screenshot also displays unavailable contacts and an access request. Permissions/connectors are real implementation requirements, not visual switches.

Recommended visual direction: professional sci-fi workspace, preserve current routes and dark/light identity, reduce decorative dominance, use the orb as a compact activity indicator, make current work and outputs primary, expose exact connected/not-configured/failed states. No wholesale redesign or nav deletion was performed. CPU/RAM/screen data must come from an authorized identified device, not the VPS or invented browser metrics presented as the user's PC.

## What changed in this code slice: actual local execution reliability

The existing public/firbo-connector.mjs was found to report `{ok:true}` even for a process that exited with code 7, because a resolved Promise was treated as success. This was reproduced with a real temporary subprocess against the unchanged old runner. The new main loop calls `executeJobForReport`: nonzero/missing exit or signal termination is a failure, not done. A zero exit remains only operation-level success, NOT proof that a user's higher-level goal was achieved.

Additional changes:
- Independently validate job parameters on the local device; remote jobs cannot turn on write/exec powers. Strict boolean local permissions, bounded path/command/content input, unknown-job rejection.
- Bound file reading during the actual read, and mark a shortened text preview explicitly. Stream directory entries rather than materializing an entire directory.
- Exclusive creation for a no-overwrite write, with a test showing two concurrent creations cannot both succeed. Explicit overwrite remains deliberate. No claim of complete symlink/TOCTOU race protection or transactional overwrite.
- Network deadline includes response-body reading; actual body/request byte limits; reject HTML/malformed JSON and redirects; do not reflect arbitrary upstream/OS exception strings in reports. Failed HTTP calls do not claim an operation was acknowledged.
- Validate local folders before consuming a pairing code; handle a missing --allow argument and malformed returned token. This does NOT implement server-side atomic pairing.
- Remove unneeded raw command/path text from routine job logging. Interactive permission prompts still intentionally show the operation locally so the owner can consent.
- Added Ubuntu/Windows Node 22 CI for these local-operation tests, without npm dependencies or deployment permissions.

## Verification actually performed before commit

- 32 new Node tests PASSED locally on Linux, including real temporary files, directory enumeration, allowed subprocess output/artifact, exit-7 failure, POSIX signal failure, concurrent exclusive create, refused permissions and mocked bounded/cancelled HTTP reads.
- Existing eight Connector tests PASSED locally under Vitest.
- Original failure reproduced: old wrapper returned ok:true with result.code=7. Corrected wrapper returns ok:false / command_failed_exit_7.
- No real device was paired, no Supabase/provider HTTP was sent, no external messages or AI calls were made. HTTP uses an injected fake transport; it does not prove network authentication or a complete cloud-device round trip.
- Final GitHub CI/Windows results are a separate gate recorded after this commit. The POSIX signal test is intentionally not a Windows signal test.

## Important unfinished work retained

1. Full job execution adapter/orchestration loop and registry of actually available tools, not a prompt listing powers. Read -> plan -> authorized action -> observe -> verify -> persist final artifact.
2. Durable request/job ledger, atomic budgets, idempotency, retries and leases. Approval must authorize a specific payload and external result verification; it must not merely change a badge.
3. Atomic one-use device pairing, reliable secret persistence, token storage/rotation, revoke-vs-running reconciliation, native local Stop and process-tree interruption. Existing shell timeout does not prove descendant processes stop. General --allow-exec remains unconfined and OFF by default.
4. Signed Firbo installer and own updater, visible dedicated browser profile, consented device/screen access, then bounded OS mouse/keyboard operations. No stealth access, CAPTCHA/2FA bypass, or assertion that all free text models support vision/tools.
5. File safety for links/races/special files, process isolation, retained failure diagnostics, durable report delivery/reconciliation and real two-user/company/device tests. These are not fixed merely by this slice's bounded IO or exit-code check.
6. Real voice recording -> transcription -> reasoning/tool execution -> playback with cancellation; microphone and screen privacy controls. Keep current gateway scopes separate; do not route private screens to unreviewed free providers.
7. Native API/console rollout, full DB/volume backup and encrypted off-host restore, migrations, MCP/shift hardening, monitoring and remaining route/mobile/physical-device tests.
8. Actual TikTok/YouTube/Salesforce/QuickBooks adapters and provider approvals; no relabeling Coming soon to Live.

## Execution-first delivery order (within the approved master plan)

A. First prove one useful complete loop in staging: select a permitted folder -> read synthetic documents -> generate a report -> save and read back -> show a verified artifact, and correct failure/Stop behavior. Use the existing Computers/Tasks/Activity pages.
B. Dedicated visible-browser research/extraction and a draft form; explicit approval before external submit. Browser and OS mouse control are different capabilities.
C. One real approved connector action and external receipt; then voice operating the same workflow. Do not jump straight to four new services before the execution contract is reliable.
D. Broaden workflows, all-page/device mobile validation and native administration after the vertical slice. Preserve rather than discard the already passing M1/M2 suites.
E. Final product assessment by completed user outcomes, recovery, safety, cost and latency. No completion percentage from model count, lines of code or number of tests.

No owner Hostinger command is needed for this code review/candidate work. Do not rerun the already-completed seven-model catalogue registration or configuration/API-image archive validation.

## Sources reviewed

Repository refs ae82ca9 and 08ae6d4:
- src/openjarvis/server/firbo_app.py
- src/openjarvis/server/app.py
- src/openjarvis/server/api_routes.py
- deploy/hostinger/docker-compose.yml
- supabase/functions/agent-runner/index.ts, plus actual deployed v19 from Supabase
- frontend/public/firbo-connector.mjs
- docs/FIRBO-M2B-COMPUTER-VERIFICATION.md / FIRBO-DELIVERY-MATRIX.json

Primary external references:
- https://github.com/open-jarvis/OpenJarvis
- https://open-jarvis.github.io/OpenJarvis/getting-started/quickstart/
- https://open-jarvis.github.io/OpenJarvis/user-guide/system-access/
- https://nodejs.org/api/child_process.html
- https://nodejs.org/api/fs.html

Screenshots are user-supplied reference images, not independently verified software installations.
