# FIRBO + OmniRoute — one CEO, one agency, one company ledger

Source architecture review: 2026-10-10. **Source-only Draft PR; nothing is connected, enabled or deployed by this document.**

## Existing systems: reuse, do not recreate

FIRBO currently owns:
- One company CEO in both Talk/Command; its conversation, session previews and owner memory in FIRBO Supabase.
- Organization-scoped agents, agent-runner, tasks and work approvals.
- Company-scoped Skills library and **existing MCP Edge Function** (`supabase/functions/mcp/index.ts`, v25 last verified live), with existing `integrations` + `integration_secrets` rows, RLS, organization role check, remote session transport, per-tool human confirmation and durable `audit_log` receipts.
- FIRBO provider routing, ledger, usage and cost accountability.
- A separate device Connector for Mac/Linux physical-control receipts; do not confuse OmniRoute MCP with desktop permissions.

OmniRoute remains the model/provider gateway, with its own internal metadata and tools. It is NOT a second FIRBO tenant platform or agency. Its source fork is `conpol84/OmniRoute`, branch `firbo/branding` (check image/version versus live gateway).

## Verified OmniRoute feature areas

| Existing Omni feature | FIRBO reuse decision | Activation gate |
| --- | --- | --- |
| Inference model routing, combos and provider fallback | **Already used** by FIRBO gateway client. Keep single request/usage ledger. | Distinct inference/management keys, observed quota, no ambiguous old-request replay |
| AgentSkills catalog (23 API, 21 CLI, 1 config + external) | Read-only reference / review for the existing FIRBO Skills page. Never auto-import executable markdown. | Source pin, security scan, owner review and explicit installed-company scope |
| MCP SSE and Streamable HTTP transports | **Reuse the existing FIRBO MCP connector**, no new Edge function/DB. FIRBO client speaks Streamable HTTP, so the gateway must use `streamable-http`, not `sse`. | `mcpEnabled`, matching transport, scoped `mcp:connect` key and `OMNIROUTE_MCP_ENFORCE_SCOPES=true` |
| MCP read-only health, quotas, cost and catalogs | **Pilot now in source** for platform admins only, exactly five locally allowlisted tool IDs. | Gateway authorization + per-tool read scopes and explicit owner confirmation, distinct secret |
| MCP mutation, completions, search, code, tunnels, backups, cache clear, key management | **NOT enabled** through this shared-gateway MCP integration. Do not equate advertised tools with approval. | Separate reviewed workflows with explicit authorization and FIRBO metering |
| A2A Agent Card and 6 gateway-specific routing/health skills | Reference only. FIRBO already has its own CEO/agents and delegation. No second CEO, no second A2A task database. | Explicit task lifecycle, idempotency, company isolation, owner approval and receipts; later stage |
| Omni Skills (inbound executable tools) | Keep in Omni's own sandbox; never treat them as FIRBO-granted machine control. | Container confinement and provider/tool policy review |
| Token compression / RTK / context relay | Reuse upstream transparent gateway transforms **only after quality tests**. Avoid a competing FIRBO context store. | Before/after accuracy, token cost, privacy and language parity across 8 locales |
| Skills discovery from GitHub and CLI collectors | Optional discovery source, never auto-install or auto-run. | Owner-reviewed digest/allowlist, no dynamic executable imports |
| Cloud backups and tunnels | Omni gateway ops only; FIRBO backup/restore remains independently required. | Encryption, off-host restore and least-privilege review |
| FreeLLMAPI and VPS Ollama | Operator services/backup model only, not alternate company memory. | Native route image release, signed owner call, fallback remains OFF until accepted |

## Changed in this one-system source proposal

1. `supabase/functions/_shared/omni-mcp-policy.ts`: canonical shared gateway endpoint and five named read-only tools. Rejects wrong paths and non-read-only tool identifiers.
2. Extends **existing** `supabase/functions/mcp/index.ts` (no second function or tables): only actual FIRBO platform admins who are company managers can connect, list or call tools on the shared OmniRoute gateway. Existing remote discovery, confirmation and FIRBO audit receipts remain. Local allowlist applies even when remote advertises executable tools or a token is over-scoped.
3. Existing FIRBO `IntegrationsPage` shows an OmniRoute preset using the SAME `kind='mcp'` form. The owner supplies a separate narrow key in the existing connection flow; nothing is auto-connected. Button disabled if an OmniRoute MCP row is already connected. Eight-locales explanatory copy.
4. Tests use synthetic fixtures and full frontend/Edge type CI; no credentials, gateway requests, DB writes or tool calls.

## Critical restrictions

- The shared gateway is global; `organization_members.role='owner'` in one customer tenant is NOT sufficient to view shared provider quotas. Require authenticated `is_platform_admin()` **in addition** to manager rights of selected FIRBO company, including before each tool call.
- Never reuse `OMNIROUTE_API_KEY` (inference) or `OMNIROUTE_MANAGEMENT_KEY` (management) for an MCP connection. Use a separate token with `mcp:connect` and ONLY required read scopes (`read:health`, `read:quota`, `read:usage`, `read:models`, `read:combos`). Actual permission to execute still requires gateway enforcement of per-tool scopes.
- Supported transport is `https://gateway.firboai.app/api/mcp/stream`. The UI URL `/api/mcp/sse` is a different mode; a connection attempt does not switch the live gateway transport.
- Generic third-party MCP integrations keep their original policy; this extra platform-admin/allowlist rule applies **only** to the exact shared gateway host, and fails closed for other paths on that host.
- Existing FIRBO MCP egress requires `FIRBO_MCP_EGRESS_URL` + `FIRBO_MCP_EGRESS_TOKEN`. If missing, connection fails closed. Do not bypass the pinned egress by direct client fetch.
- Any real source merge/release requires checking all stacked Draft PRs #126–#140, production rollback/source reconciliation, completed CI and real signed-owner/foreign-tenant denial. A green isolated CI is not production acceptance.

## Actual next steps

1. PR #139 exact head Docker image CI is green; live Hostinger has previous image and native route HTTP404. Run reviewed resource preflight, capture immutable rollback, build or transfer candidate and test without production replacement.
2. Read-only `firbo_omniroute_readonly_probe.py` from PR #140 in the existing live FIRBO container; inspect real service health, catalog, MCP and A2A flags without secrets.
3. Owner creates proper three separate credential scopes (inference, management, new read-only MCP); ensure Omni scoped MCP enforcement true and Streamable HTTP enabled; do not change credentials blindly.
4. Staged existing FIRBO `mcp` Edge source deployed **only after** review and tenant denial tests; new Integrations preset should be reachable for platform admin, others denied.
5. Verify tools/list filters to five, representative read call receipt, executable tool rejected before any remote call, no cross-tenant context or extra billing.
6. Continue Master Issue #52 stages 0–11: CEO identity + long-term memory, Mac/Debian physical control, specialist work delivery, backup/restore, A2A/skills acceptance. No unrelated PF/TA writes.

## Owner live VPS read-only observation — 2026-10-10

Running FIRBO image: `sha256:75d5d4d6a0e09082569d975498b068647d8751ac2a62b7b7e608f6ec5203af46`. Still the old Python module without the native local Qwen endpoint (HTTP 404); the successful GitHub ephemeral image in PR #139 has **not** been delivered to Hostinger.

Uncredentialed calls from inside the existing FIRBO container to the PRIVATE OmniRoute service returned:

| Endpoint | HTTP | Meaning |
| --- | --- | --- |
| /api/health | 200 | Gateway process responds |
| /api/agent-skills | 401 | Read blocked without auth; cannot infer catalog contents |
| /.well-known/agent.json | 200 | Public A2A *advertisement* available; not task execution |
| /api/a2a/status | 401 | A2A real enabled state UNKNOWN |
| /api/mcp/status | 401 | MCP real enabled/transport/scope state UNKNOWN |

These are expected authentication boundaries, not a reason to disable gateway auth, turn off REQUIRE_API_KEY, share a management key, or create another MCP backend.

The dedicated `deploy/hostinger/firbo_omniroute_authenticated_readiness.py` makes exactly ONE read-only HTTPS GET to `https://gateway.firboai.app/api/mcp/status`, with a *separately issued narrowly scoped* MCP-only key entered invisibly on the operator's local TTY. It never stores or displays the key or sends it to another origin, follows no redirects/proxies, emits only four bounded readiness flags and never calls tools/A2A. An HTTP 401/403 reports **not verified**, not "MCP off". A successful response must show `enabled=true`, `online=true`, `transport=streamable-http`, `scopesEnforced=true` before it may be considered **eligible for additional owner review** (NOT permission to deploy).

## Default-OFF FIRBO shared-gateway pilot

The EXISTING FIRBO `mcp` Edge function now includes `FIRBO_OMNI_MCP_PILOT_ENABLED` read through Deno env and requires the literal value `true` for the shared gateway only, in addition to platform-admin + company-manager RBAC and the five read-only tool IDs. Missing, false, typo, "TRUE" or whitespace values DENY the shared gateway connection BEFORE secrets or outbound requests. All other third-party MCP integrations retain their own existing policies. This is NOT enabled in live Supabase.

Only after real scoped-key validation, approved transport, live denied-tenant tests, egress validation, immutable rollback and controlled staged Edge deployment should a trusted operator consider setting the pilot env var and rerunning the same acceptance suite. Do not use current inference/admin keys for this test.

