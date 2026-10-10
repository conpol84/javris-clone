# FIRBO ↔ OmniRoute — Stage 4/6 Read-only Capability Reconciliation

**Source checkpoint: 2026-10-10.** This does not enable tools or change the production gateway.

## Verified OmniRoute fork source

The reviewed repository is conpol84/OmniRoute, branch firbo/branding.

- Source src/lib/agentSkills/catalog.ts lists 23 API skill IDs, 21 CLI IDs, 1 config ID, plus external entries. Catalog entries describe how to use OmniRoute; they are not executable FIRBO tools or automatic grants.
- GET /api/agent-skills returns skill metadata/count/coverage. GET /api/agent-skills/{id}/raw returns untrusted SKILL.md. Never auto-install or execute descriptions returned by the gateway.
- GET/POST /api/mcp/sse requires management authentication (narrow mcp:connect key allowed) and enabled SSE mode. Separate /api/mcp/stream requires streamable-http mode. Routes merely existing in source do not prove the live transport is active.
- GET /api/mcp/status is protected and returns enabled/online/transport/scopesEnforced when properly authenticated. Observe scopesEnforced before allowing tools; no external requester gets broad manage scope.
- GET /.well-known/agent.json advertises A2A skills but does not prove that A2A is live. Actual status is GET /api/a2a/status; executable /a2a requires authenticated Bearer and enabled a2aEnabled.
- The fork includes management authentication and per-tool scope-enforcement source. Counts in marketing/docs are not evidence of actual provider quota or an activated tool.

## FIRBO retains the CEO, memory and accounting

FIRBO's agent-runner already uses company-scoped memories and installed skills, and its own accounting when calling the OmniRoute inference gateway. Do not duplicate CEO identities, company memory or tenant authorization inside OmniRoute. Management and inference credentials must be separate (the existing server had gateway_keys_must_be_distinct); never pass either key to browser code or logs. Do not auto-retry old uncertain cloud/tool requests.

## Source-only private discovery

The new deploy/hostinger/firbo_omniroute_readonly_probe.py reads only these hardcoded GET endpoints from the Docker-private hostname omniroute:20128:

1. /api/health — liveness metadata
2. /api/agent-skills — safe count and ID dedup signal, never SKILL.md
3. /.well-known/agent.json — advertised A2A skill count only
4. /api/a2a/status — enabled boolean only
5. /api/mcp/status — HTTP authentication posture only (no key or session cookie). A 401/403 means protected; a 200 without auth needs a security review.

The probe disables proxies and redirects, reads at most 256 KiB per path, emits no upstream content or secrets, and never POSTs, invokes tools, installs skills or changes data. It does NOT establish authenticated MCP/A2A readiness, tenant safety or per-tool authorization.

## Next gated stages — still pending

1. Observe real private gateway metadata and distinguish advertised vs enabled vs authenticated.
2. Resolve separate OmniRoute inference/manage key scopes via owner-approved recovery and rollback; real quotas still unknown.
3. Configure an owner-approved narrowly scoped server-only MCP connection, with scopesEnforced verified and a tiny READ-ONLY tool allowlist. Test denial for members/foreign orgs.
4. Optionally enable A2A for nonmutating skill probes with explicit task/receipt/idempotency and FIRBO metering. Do not auto-delegate from a published Agent Card.
5. External AgentSkills: pin SHA/digest, scan GitHub markdown/payload for malware/secrets/prompt injection, review owner authorization, then use existing FIRBO skill library lifecycle. Do not indiscriminately import community instructions.
6. Prove a real new CEO intent through an approved tool, receipt, accounting, same voice/chat session, Stop, tenant isolation and rollback.

No production Docker, Supabase, model, Mac, permissions or PickFantasy/TradeAthletes mutation is authorized by this discovery stage. Keep Master Issue #52 stages 0–11 as the complete release plan.
