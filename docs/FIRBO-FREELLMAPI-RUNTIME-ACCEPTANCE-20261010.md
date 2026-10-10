# FIRBO FreeLLMAPI — Existing Service Acceptance & One-Gateway Integration
10 October 2026. **Do not install FreeLLMAPI a second time.** The owner reports that it is already installed on the Hostinger VPS. Previous repository guidance describes a guided isolated installation; current live Docker readiness has not been independently re-read through this ChatGPT connection.

## Verified source
- FIRBO repo conpol84/javris-clone already has deployment, optional isolated Compose, and read-only health probe.
- Owner fork conpol84/freellmapi main is pinned at a6b2158c7c36ce19f888d0411846a1a0f2aa3f06 (as at this checkpoint).
- Pinned FreeLLMAPI API docs explicitly say GET /v1/models can include disconnected, exhausted and synthetic auto/fusion entries. GET /v1/models?execution_status=ready is a catalog *capacity hint*, not a completed inference or zero-cost contract; unknown provider key health may still report ready.

## Architecture (one selection plane)
FIRBO CEO/employee AI -> Supabase agent-chat -> authenticated OmniRoute inference combo -> dedicated FreeLLMAPI provider -> actual selected upstream.
For strict local/no-provider-fee emergency CEO new turns, use the PR129 independent owner-scoped native Ollama-only route instead; do NOT call OmniRoute via FreeLLMAPI, do NOT route FreeLLMAPI back into OmniRoute, and never silently replay ambiguous cloud 502/timeout outcomes.
Local Piper handles audio separately and may fall back to device speech per PR128.
FreeLLMAPI does not itself guarantee permanently free or commercially permitted usage; a model catalog is not a cost receipt. Do not expose API/provider keys in Vercel/public browser.

## Safe readiness protocol
1. Existing read-only localhost catalog probe: deploy/hostinger/freellmapi_probe.py. It now counts ONLY distinct, specifically identified non-router models marked execution_status=ready. Auto/fusion, exhausted, needsKey and unknown models do not make the provider ready.
2. It returns inference_verified=false, commercial_use_verified=false and provider_cost_verified=false even if models are ready. No prompt sent, no quota consumed, no key logged.
3. Optional one-call acceptance is in deploy/hostinger/freellmapi_acceptance.py. It is read-only by default. Real inference requires BOTH --smoke and host-held FREELLMAPI_SMOKE_APPROVED=YES, plus one exact FREELLMAPI_SMOKE_MODEL known ready from the catalog. It sends a public 24-token-cap prompt to FIXED loopback, never company/customer data. It reports X-Routed-Via and rejects observable multi-attempt fallback. The report deliberately still sets provider_cost_verified=false and commercial_use_verified=false; an actual provider terms/ledger check is required.
4. Review existing Docker state/installed digest, gateway network, startup/health and locked-down port 127.0.0.1:3001. Never run install-freellmapi.py on an already installed host; it is intentionally create-only and will refuse or risk conflict if bypassed. Do not dump environment, keys or provider responses.

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
