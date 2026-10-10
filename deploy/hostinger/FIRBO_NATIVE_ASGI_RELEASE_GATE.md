# FIRBO Native ASGI Entrypoint — Release Gate (2026-10-10)

## Corrected root cause after owner's REAL VPS readback (2026-10-10)
The earlier assumption that the running Compose command selected `firbo_app:app` has now been **disproved by the owner**. Actual `docker inspect firbo-api` reports the correct `openjarvis.server.firbo_free_app:app`. But the imported container module is missing the owner local POST route (`route_registered=false`), and the loopback request returns HTTP 404.

The reviewed GitHub source **does** contain the unconditional POST route. Therefore the currently imported Python artifact and the reviewed GitHub source disagree in behavior; a stale packaged image/module is the leading explanation, but a different installed module path or incomplete packaging must be checked with byte-exact provenance before replacement. Do NOT simply flip the ASGI command again.

## Source and image attestation
- Reviewed GitHub source: `src/openjarvis/server/firbo_free_app.py`, blob SHA-1 `edf940a67f8881e7bd828ed8a956252f2a8c67de`, first verified in PR #136 head `352264c3b6621f7310d2d1109665c6abb03675db`. Recompute this pin if reviewed source changes.
- Run the **no-write** `firbo_native_image_provenance.py` INSIDE the existing `firbo-api` via `python -B -`. Report only module Git blob SHA, exact-source match, local POST route registration, and loopback GET status; no tokens, environment, private files, AI calls or POST.
- Preserve existing running image ID and corresponding source commit in release notes. Never infer image source from Docker command alone.
- New Hostinger Compose build argument `FIRBO_NATIVE_ROUTE_ATTEST=1` makes the FIRBO image build fail unless the **installed packaged FastAPI app** registers the exact local POST route. Generic OpenJarvis builds retain the OFF default; this is not a runtime feature enablement. A successful build is NOT the same as successful authenticated production inference.

## Change
Compose now allows `FIRBO_API_ASGI_APP` override, keeping the former app as default. Nothing changes until the owner deliberately changes environment and redeploys with a reviewed image. **Do not auto-enable.**

## No-write source checks
- `docker inspect firbo-api --format '{{json .Config.Cmd}}'` (do not reveal environment variables).
- `docker exec firbo-api python -c 'from openjarvis.server.firbo_free_app import app; print(any(getattr(r,"path","")=="/v1/firbo/free/local/chat/completions" for r in app.routes))'` (ensures image actually contains opt-in app).
- Verify generated Compose *command only* using a safely filtered readout, never `docker compose config` pasted wholesale (may disclose credentials).

## Gates before opt-in
1. Confirm correct FIRBO project only and pin the exact immutable backend image + rollback image. Do not touch PickFantasy/TradeAthletes.
2. Verify free-app dependencies, startup, health, CORS and existing gateway/control endpoints in a staging container. Verify local Ollama network and digest.
3. Ensure the native free service's explicit `FIRBO_FREE_ENABLED` and `FIRBO_FREE_ORGANIZATIONS` allowlist are present and valid **without printing values**.
4. Owner JWT + allowed organization: signed POST completes through Ollama; unrelated member/tenant: denied. Invalid/anonymous tokens denied. Confirm no cloud egress and cost trace.
5. Once the exact image source, build gate and rollback are proven, rebuild a **candidate** backend image from a pinned reviewed commit; verify it in isolation before touching the running Compose service. The currently running ASGI command is ALREADY correct; do not alter it to troubleshoot the 404. Confirm candidate package's Git blob hash and all old control/gateway routes.
6. Only then perform a scoped backend-only deployment with rollback image preserved; verify local POST returns 405 on unauthenticated GET but denies unauthenticated POST, and owner-signed POST returns a bounded real local Qwen response. No cloud call and blocked cross-tenant request.
7. Only after native acceptance, deploy the matching Edge closure and scoped standby flag. Verify voice, Stop and actual device receipts on owner mobile. No automatic replay of uncertain provider requests.
8. Verify a new CEO user turn normally calls OmniRoute. After a genuine cloud model error, only a **fresh** owner-initiated turn may use local Ollama, with no double billing, same CEO history and bounded readiness. Do not replay old ambiguous requests.
9. Keep `FIRBO_CEO_LOCAL_ONLY_PRIMARY` OFF. Enable `FIRBO_CEO_OLLAMA_BACKUP=on` only for approved owner/company after live evidence, and rehearse rollback, disabled state, voice/Stop, model recovery and monitoring.

**Status:** source-only candidate. No VPS deployment, Supabase writes, secrets, keys, live inference or production failover activation.
