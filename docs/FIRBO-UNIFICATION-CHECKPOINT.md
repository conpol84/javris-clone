# Firbo + OmniRoute unification — checkpoint U1

Date: 2026-10-03. Base: `50bea79134fb28aacc9d5d3fcd949ba8d8239d78`.
Branch: `codex/firbo-unified-gateway`, PR target: `claude/omniroute-engine` (NOT the old upstream `main`).

## Status

**U1 is an implemented, locally tested candidate. It is NOT a production-ready release.**
No production frontend, Supabase function, schema, provider key, agent model or running VPS container was changed by this stage.
Do not mistake a Vercel build, a model catalogue, or these isolated tests for proof that live agent inference works through OmniRoute.

## Product boundary

Keep `javris-clone/frontend` as the ONE existing Firbo frontend on Vercel.
Keep Supabase as the identity/company/agent/task system of record.
Keep OmniRoute as the model engine on Hostinger. Two deployable services can serve one product; copying the entire OmniRoute codebase into the frontend is not unification.
No TradeAthletes/PlayersFX/PickFantasy infrastructure is in scope. No nav/routes are added or removed.

## Changed

- Replace the Admin Console iframe with a native Firbo provider/model/routing console, using the existing Firbo JWT.
- Keep the original Gateway page as an internal `GatewayLegacyPanel` component. The `/gateway` wrapper checks the server session: only platform admins see global engine telemetry; company users see their own RLS-scoped memberships.
- Add `/v1/firbo/session` and platform-admin-only `/v1/firbo/control` to the existing Hostinger Firbo API.
- Existing `/v1/gateway/*` global endpoints now require fresh platform-admin authorization; POSTs additionally require an explicit writes-enabled flag.
- Correct CORS to allow the intended authenticated POSTs from explicitly configured frontend origins. No wildcard origins.
- No API keys, OAuth tokens, prompts or gateway cookies are returned by the new control API.
- Native editing is limited to the EXISTING `firbo-economy`/`firbo-quality` simple priority combos; exact live catalogue validation, stale-edit hash check, no nested combo targets, no DELETE/recreate, and mandatory read-back verification.
- Gateway writes are OFF by default. A persisted audit intent must succeed before an upstream write. Audit outcomes contain actor ID, target, request ID and revision hashes, never tokens or prompts.
- Bound request bodies (64 KiB) and upstream decoded responses (2 MB); private control responses use no-store.
- All eight existing languages have complete labels for the new console.
- Update existing frontend CI to cover the actual development branch and this branch. Add isolated Python security checks. Workflows have read-only contents permissions and NO deployment steps.

## Tested / passed locally

- 26 isolated FastAPI/security tests, real ASGI middleware and mocked Supabase/OmniRoute transports.
- 11 Node contract/input/i18n-parity tests using the new TypeScript parser.
- Syntax/transpile checks for all five changed frontend TypeScript/TSX modules.
- Python byte compilation.

These tests do not call real providers, spend AI credits, modify production data or use a real user account.
The test suite stubs the legacy gateway router to exercise the new authorization dependency; it does not claim to retest every old endpoint.
Full application typecheck/build, Vercel preview, authenticated browser/mobile QA and Hostinger installation remain separate checks.

## Safe rollout (not executed)

1. Obtain authorized scoped access to the ACTUAL Firbo VPS. Do not reuse unrelated Hostinger/OpenClaw credentials or assume it is an old VPS.
2. Capture the current running image digests/commit, Compose configuration, permissions and off-host backup; perform a restore test. Never paste keys into chat or commit .env.
3. Build/test this commit as an isolated candidate before recreating any production service. Check actual gateway route contracts and simple-combo shape; advanced profiles deliberately fail closed.
4. Deploy the Firbo API candidate with `FIRBO_CONTROL_WRITES_ENABLED=false`, then a matching frontend preview. Existing compose can be combined with `docker-compose.unified.yml` to pass the feature flag and persistent audit location. This overlay alone is NOT a deployment.
5. Verify `/health` contract, real Firbo login, platform-admin console, denied regular-user global access, own-company session data and logout/expired-token behavior. Do not enable a wildcard CORS rule for previews; authorize an exact preview origin.
6. Only after review, make the audited SQLite directory writable by the API runtime user and include it in backups. Enable writes only for an intentional controlled test; verify gateway read-back, audit rows and rollback behavior. Never roll out partial frontend/backend versions blindly.
7. A failed/ambiguous upstream write leaves an audit `reconcile_required` marker. Read current gateway state before retrying; do not silently repeat mutation requests.

## Known constraints / not done

- No authorized Hostinger execution channel was available in this session. Its deployed server version is NOT verified.
- Full frontend dependencies were unavailable locally; syntax checks are NOT the full application typecheck. CI must provide the latter before merge.
- Provider creation/OAuth enrollment, key lifecycle, advanced/composite routing, tenant-specific gateway quotas/cost reconciliation and the remaining OpenJarvis legacy screens are not completed by U1.
- Agents/voice are NOT yet forced through OmniRoute; the nine `auto` agents, one OmniRoute agent, mixed voice paths and current LLM settings remain untouched. A real traced inference/fallback test is required before routing cutover.
- No real microphone, external integrations, payment, restore, multi-tenant RLS or fault-recovery end-to-end tests have been claimed.
- Supabase migration drift, RPC hardening, exposed-key rotation, scheduler result handling, MCP hardening and monitoring remain from the prior audit. Do not restart the audit from zero.
- The native combo editor detects stale data and serializes requests in one API process. OmniRoute's management PUT contract has no verified cross-process compare-and-swap: keep ONE controlled writer and the native write flag OFF until that constraint is addressed/accepted.
- Native combo read-back may reject aliases the gateway canonicalizes. It intentionally reports an unconfirmed write instead of falsely declaring success. Confirm canonical IDs in staging.
- The old platform-admin Gateway panel still offers an optional external emergency dashboard link. The normal Admin Console no longer embeds that dashboard.

## Next checkpoint U2

Verify actual Hostinger deployment and full frontend build first; then one traced, budget-limited agent request through `firbo-economy`, controlled fallback, accurate usage attribution, and voice route policy. Persist each step with changed/tested/passed/failed/remains. U1 alone must not be advertised as all-in-one production-ready.
