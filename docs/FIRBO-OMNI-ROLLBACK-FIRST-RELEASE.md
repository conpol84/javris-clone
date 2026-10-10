# FIRBO / OmniRoute — rollback-first production gate

2026-10-10. Applies to ONE existing OmniRoute gateway and ONE existing FIRBO MCP. No independent service or database is proposed. This document does NOT authorize release.

## Owner-verified live checkpoint

OmniRoute authenticated MCP status returned enabled, online, streamable-http and scope enforcement true. A real MCP tools/list returned 110 tools, including all five FIRBO-approved read-only names. One explicit owner-authorized omniroute_get_health returned a scope_denied:missing_scopes error in the existing audit. No accepted read health receipt yet.

OmniRoute Draft PR #1: exact source head 26e14038151e8e74c825334a33b77702286892ab adds a narrow six-scope MCP-only key preset in the EXISTING key manager, a server-side API restriction and 403 ordinary /v1 API denial. Its owner review is tracked by FIRBO Draft PR #145. PR145 verified exact-source 28/28 tests, scoped backend/auth TypeScript, ESLint and SAST (source-only). OmniRoute monorepo full TS still has preexisting UI type errors (Header, OAuthModal, analytics, Electron); this is separately tracked, NOT erased or waived.

## Stage A — independent off-host compilation

This PR adds an isolated GitHub Actions gate which fetches the public OmniRoute fork at exactly the SHA above and compiles the full Next.js API+dashboard graph under synthetic credentials, telemetry OFF, cloud sync OFF, runtime native stubs, and the repo's native Turbopack path with Next worker pool capped by CIRCLE_NODE_TOTAL=1 (the same setting used in its Dockerfile), excluding standalone packaging. The first off-host Webpack run hit a confirmed V8 heap OOM at 5,600MB (NOT a source TypeScript error); the next exact-source CI compares the lower-V8-pressure Turbopack path without weakening the security/Next build gate. Verify the real output BUILD_ID and compiled API Manager page. A green CI result is an OFF-HOST code/build checkpoint, NOT a production artifact, standalone image, test of real credentials, or deployment authorization.

## Stage A follow-up: separate compilation guarantees (2026-10-10)

Last exact-head full UI test at FIRBO commit 12395b9162e151c73749d78ef0825f120ae3cd86 showed the initial Webpack build V8 heap OOM at 5600 MB. Two later Turbopack attempts ended with a runner SHUTDOWN SIGNAL (one despite CIRCLE_NODE_TOTAL=1). Neither error proves the UI source fails to compile; neither is a successful full build.

Latest CI separates independent assurance levels:
- Backend contributor mode (repository-owned OMNIROUTE_BUILD_PROFILE=contributor) temporarily stubs all dashboard leaves and compiles the real API routing graph. A successful contributor build is backend-only, NOT a tested user interface or a production image.
- Full UI/API path uses 8192 MB V8 heap, Webpack, and one worker, with BUILD_ID and a REAL compiled API Manager page required. Success of backend contributor mode must not mask a failure of the full UI path.

Existing PR145 source-only 28/28 security and authorization tests remain passed for the same pinned OmniRoute source. This CI does not change live keys, settings, access scopes, server images, DNS, or provider routing. Full UI and production Docker candidate remain separate release gates even after successful source-only tests.
## Stage B — observe LIVE Docker state (read-only; owner terminal only)

Do NOT assume the GitHub Compose file describes the current VPS. Read the live container name/image SHA/health, Compose directory, mounts and port bindings. The fork's original docker-compose.yml maps ./data to /app/data and has persistent Redis; the VPS may differ. Never display Config.Env, any .env file contents, API keys, cookies, database rows, or secrets.

Safe owner terminal read-only discovery, only after operator chooses to proceed:

~~~bash
(
set -euo pipefail
docker ps --filter 'name=^/omniroute$' --format '{{.Names}} {{.Image}} {{.Status}}'
docker inspect omniroute \
  --format 'image={{.Image}} compose_project={{index .Config.Labels "com.docker.compose.project"}} compose_workdir={{index .Config.Labels "com.docker.compose.project.working_dir"}} status={{.State.Status}} health={{if .State.Health}}{{.State.Health.Status}}{{else}}not_configured{{end}}'
docker inspect omniroute \
  --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}data_mount_type={{.Type}} destination={{.Destination}}{{end}}{{end}}'
)
~~~

Stop if service is not actually named omniroute, the data mount is not identified, or ports/reverse-proxy routing are unknown. Do not guess.

## Stage C — reversible production candidate

Before any release: verified encrypted/off-host DATA backup and test restore, record previous immutable image SHA, Compose project, exact mounts, external reverse proxy route and safe rollback. Build a REAL production Docker/standalone image from pinned sources in a controlled builder (the CI-only Webpack source compile is insufficient). Boot a private canary with disposable TEST data; verify authenticated management, health, denial of unauthenticated routes, six MCP scopes and denial of ordinary completions by the MCP-only key. Run load/health regression without touching live databases or credentials.

## Stage D — explicit owner-governed release

Only after Stage A/B/C all pass and a verified maintenance window: promote the new verified image into the EXISTING OmniRoute service while keeping volumes, Redis, settings, provider credentials and origin/port unchanged. Never run docker compose down -v, docker system prune, DROP, or replace a live .env blindly.

On HTTP 5xx, login regression, provider/inference failure, broken health/audit or missing data, switch back to the verified OLD pinned image/config immediately. If a data migration makes the old version incompatible, use tested backup/restore procedure rather than guessing.

## Stage E — restricted operator key + FIRBO shared MCP integration

After production's EXISTING API Manager shows the new option, operator creates a new dedicated FIRBO MCP key or confirms a safe conversion of a key used ONLY for that purpose. Exactly six rights: mcp:connect, read:health, read:quota, read:usage, read:models, read:combos. No manage/admin/write/execute rights; modelAccessMode restricted with empty model/combos allowlists; central CLIENT_API policy denies ordinary /v1 routes with 403. No DevTools Console commands or credential sharing.

Then ONE owner-authorized private-key --read-health acceptance; expect existing Omni MCP Audit Log success. Only after that stage the SAME FIRBO mcp Supabase Edge source from green PR144 (110-tool catalog fix), test platform-admin/foreign-company denial and existing tool audit/egress. Keep FIRBO MCP PILOT OFF until signed owner review. The live FIRBO Hostinger Qwen native route HTTP404 is a SEPARATE pending PR139 controlled Docker release. Mac/Debian real browser, voice, sessions, agents/skills and backups remain in the FIRBO Stages 0–11 plan.

No second CEO, MCP, database, session store, gateway, ledger or frontend. No changes to PlayersFX/PickFantasy/TradeAthletes.
