# FIRBO FreeLLMAPI — Existing Service Acceptance & One-Gateway Integration
10 October 2026. **Do not install FreeLLMAPI a second time.** The owner reports that it is already installed on the Hostinger VPS. Previous repository guidance describes a guided isolated installation; current live Docker readiness has not been independently re-read through this ChatGPT connection.

## Verified source
- FIRBO repo conpol84/javris-clone already has deployment, optional isolated Compose, and read-only health probe.
- Owner fork conpol84/freellmapi main is pinned at a6b2158c7c36ce19f888d0411846a1a0f2aa3f06 (as at this checkpoint).
- Pinned FreeLLMAPI API docs explicitly say GET /v1/models can include disconnected, exhausted and synthetic auto/fusion entries. GET /v1/models?execution_status=ready is a catalog *capacity hint*, not a completed inference or zero-cost contract; unknown provider key health may still report ready.

## Commercial-use and production restriction
The reviewed exact owner fork conpol84/freellmapi@a6b2158c has an MIT software LICENSE (code can be used commercially subject to its notice), BUT its README explicitly warns: "This project is for personal experimentation and learning, not production." Upstream free-tier provider rules, quotas, retention and commercial permissions are separate from the MIT license. A 200 or ready catalog entry is not a subscription, production SLA, commercial license, or verified no-cost entitlement.

Therefore **DO NOT enable FreeLLMAPI in public/customer AI products or default production firbo-quality/firbo-economy combos**. Restrict the proposed integration to a named internal owner/developer QA canary, with public synthetic prompts only, until a provider-by-provider ToS/privacy/cost review establishes acceptable commercial usage. Keep existing paid/approved production providers and the separately guarded local owner Qwen route unchanged.

## Architecture (one selection plane)
FIRBO CEO/employee AI -> Supabase agent-chat -> authenticated OmniRoute inference combo -> dedicated FreeLLMAPI provider -> actual selected upstream.
For strict local/no-provider-fee emergency CEO new turns, use the PR129 independent owner-scoped native Ollama-only route instead; do NOT call OmniRoute via FreeLLMAPI, do NOT route FreeLLMAPI back into OmniRoute, and never silently replay ambiguous cloud 502/timeout outcomes.
Local Piper handles audio separately and may fall back to device speech per PR128.
FreeLLMAPI does not itself guarantee permanently free or commercially permitted usage; a model catalog is not a cost receipt. Do not expose API/provider keys in Vercel/public browser.

## Read-only Docker inventory for existing installation
Run only on the intended Hostinger VPS with Docker inspection permission:
`python3 deploy/hostinger/freellmapi_inventory.py` (from the reviewed checked-out source).
This script never restarts, installs or reconfigures the service. It requests ONLY selected Docker metadata, not container environment, secret files or logs. It checks:
- container `firbo-freellmapi` is running and healthcheck healthy
- exact pinned image identity, non-root `1000:1000`, all capabilities dropped and no-new-privileges
- host port `127.0.0.1:3001` only (not world accessible), only `hostinger_default` network, expected restart policy

A reported READY Docker container is still **not model readiness**; verify the read-only catalog separately, then a single manually authorized inference. If the image has been upgraded, stop and review the new digest rather than silently accepting it.

## Safe readiness protocol
1. Existing read-only localhost catalog probe: deploy/hostinger/freellmapi_probe.py. It now counts ONLY distinct, specifically identified non-router models marked execution_status=ready. Auto/fusion, exhausted, needsKey and unknown models do not make the provider ready.
2. It returns inference_verified=false, commercial_use_verified=false and provider_cost_verified=false even if models are ready. No prompt sent, no quota consumed, no key logged.
3. Optional one-call acceptance is in deploy/hostinger/freellmapi_acceptance.py. It is read-only by default. Real inference requires BOTH --smoke and host-held FREELLMAPI_SMOKE_APPROVED=YES, plus one exact FREELLMAPI_SMOKE_MODEL known ready from the catalog. It sends a public 24-token-cap prompt to FIXED loopback, never company/customer data. It reports X-Routed-Via and rejects observable multi-attempt fallback. The report deliberately still sets provider_cost_verified=false and commercial_use_verified=false; an actual provider terms/ledger check is required.
4. Review existing Docker state/installed digest, gateway network, startup/health and locked-down port 127.0.0.1:3001. Never run install-freellmapi.py on an already installed host; it is intentionally create-only and will refuse or risk conflict if bypassed. Do not dump environment, keys or provider responses.

## CEO upstream credits / rate-limit incident diagnostics

The owner's FIRBO Supabase event ledger proved five distinct agent-chat HTTP502 model_error failures since 2026-10-09 22:29Z (latest 2026-10-10 04:03Z), plus one desktop_model_rate_limited case and previous settled OmniRoute desktop completions. The affected Enterprise organization has 50,000 plan daily runs, only five new UTC-day inference reservations at observation, no assigned CEO monthly budget, and no company BYOK/model_routes. This is NOT a FIRBO Enterprise plan exhaustion. The exact upstream paid-provider balance is not readable in Supabase.

Read-only VPS operator utility deploy/hostinger/omniroute_ceo_quota_probe.py uses a fixed GET https://gateway.firboai.app/api/usage/quota and existing server-held OMNIROUTE_MANAGEMENT_KEY, ignores proxy/redirects and prints sanitized provider-code counts only. It NEVER calls /v1/chat/completions or uses paid provider credits. Reported future resetAt denotes **gateway-observed cooldown**, not the provider's official billing reset or remaining dollar balance. QuotaTotal=100 or percentRemaining=100 is often synthetic queue pressure; even learned provider limits are not a billing statement. The report hardcodes credits_balance_verified=false.

The next owner-authorized live steps are:
1. Check the pinned local read-only OmniRoute quota probe and native FreeLLMAPI inventory/probe, without disclosing keys.
2. Verify the actual gpt-5.5/desktop upstream connection/cooldown in OmniRoute account admin, and consult provider's official usage/billing panel for remaining credits. A desktop subscription rate limit and an API pay-as-you-go balance are different concepts.
3. Pause burst traffic to the affected provider; do NOT replay reconcile_required jobs. Only after owner-authenticated native Ollama/Piper acceptance may the already-approved PR129 local-only NEW turn mode be enabled.
4. Preserve original usage and reservations for financial reconciliation; request/provider-level billing proof is required before releasing unknown reservations.
5. Existing client-visible model_error is generic because live agent-chat v51 suppresses direct-provider HTTP details. PR127 adds sanitized diagnostics, still not deployed. Do not confuse a GitHub green CI or a Vercel READY preview with production recovery.

## Read-only OmniRoute connection check
The additional tool deploy/hostinger/freellmapi_gateway_probe.py reads only three fixed HTTPS management endpoints:
- /api/providers?limit=200, verifies one active freellmapi connection
- /api/provider-models?provider=freellmapi, counts registered model IDs
- /api/combos?limit=200, requires a dedicated firbo-freellmapi-canary* combo that ACTUALLY references a registered freellmapi/model ID (a matching name alone is never enough)

It requires the existing host-only OMNIROUTE_MANAGEMENT_KEY; never transmit the key in a chat message, screenshot, browser or CI variable. It prevents redirects and HTTP proxies, bounds all response data, and reports only sanitized counts and verification flags. It never creates a provider, model, credential, combo or inference.

A successful management read-back does NOT establish serving-model readiness, a live FreeLLMAPI inference, a zero-cost contract, or customer authorization. Continue through the next manual acceptance gates, preserving existing firbo-economy/firbo-quality combos.

## Integration order
- First confirm actual FreeLLMAPI container health, private listener and READY candidate with read-only script.
- Review provider commercial terms, free budget, key ownership and model latency/quality. Prefer one pinned exact provider+model, NOT auto or fusion.
- Verify the explicit one-call smoke, real route X-Routed-Via, any X-Fallback-Attempts, and provider/platform ledger evidence for actual fees. Never assume a zero-cost label is current.
- In OmniRoute management, add an isolated OpenAI-compatible provider with internal-only host http://freellmapi:3001/v1, API type chat and prefix freellmapi. Only server-side credentials, never frontend. Avoid weakening SSRF controls globally. The existing OmniRoute source already supports provider-node routing. This requires an owner-authenticated management action and exact-branch CI/readback.
- Create a **dedicated test combo** using verified model, and opt in only one owner-approved canary agent. Do not change existing firbo-economy/firbo-quality/customer combos or BYOK routes.
- Verify trace, route provenance, bounded one-call behavior, source budget and accounting. Only then consider a **new-turn** provider policy; no automatic retry after uncertain inference or provider failure. Mobile/CEO text+voice/Stop acceptance and rollback must pass before wider release.

## Stage result
Changed: Source-only read-only probe and manual acceptance contract, tests and workflow.
Tested: GitHub exact-head CI required. No remote VPS actions from this connection.
Passed/Failed/Remains must be updated from the actual CI, not from assumptions. No production deployment or FIRBO/PF/TA Supabase writes.
Master coordination: Issue #52. Stacked on PR129 protected source, do not merge out of order.
