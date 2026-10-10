# FIRBO Native ASGI Entrypoint — Release Gate (2026-10-10)

## Root cause supported by source
Hostinger Compose currently launches `openjarvis.server.firbo_app:app`, which does not mount `/v1/firbo/free/local/chat/completions`. The route is defined by `openjarvis.server.firbo_free_app:app`. This explains observed 404 if running Compose matches the reviewed source. Verify the live container command before treating it as established.

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
5. Only then deploy backend-first using explicit `FIRBO_API_ASGI_APP=openjarvis.server.firbo_free_app:app`. Verify live route, old app endpoints, and rollback. Do not enable CEO fallback yet.
6. Deploy full corresponding Edge closure, keep flags OFF until authenticated live acceptance; separately enable owner-scoped `FIRBO_CEO_OLLAMA_BACKUP=on` only after all gates. `FIRBO_CEO_LOCAL_ONLY_PRIMARY` stays OFF.
7. Real new-user-turn, voice/Stop, identity/history, accounting and fallback tests. Never replay ambiguous past requests.

**Status:** source-only candidate. No VPS deployment, Supabase writes, secrets, keys, live inference or production failover activation.
