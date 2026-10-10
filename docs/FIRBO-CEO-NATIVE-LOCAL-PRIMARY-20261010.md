# FIRBO OWNER CEO — strictly local new-turn Qwen primary

Checkpoint date: 2026-10-10. Source-only branch stacked on PR #128, retaining the protected Agent Runner immutable source manifest. Scope FIRBO, Supabase project bfeinnsorgjycivozcau in My Org. PickFantasy ldqxfaiohvylecrgiwmi and TradeAthletes npkexklarlaxjkrskzrd must NOT be changed.

## Why
Production CEO agent-chat returned HTTP502 model_error and marked requests reconcile_required. Previous OmniRoute desktop outcomes are uncertain; they cannot safely be replayed or billed twice. Existing first-party native free route may select reviewed free OpenRouter models, so it cannot guarantee local-only behavior. This change selects a strictly local provider before any paid attempt on a NEW CEO request, only with explicit owner permission.

## Source changes
- New native FastAPI POST /v1/firbo/free/local/chat/completions on the existing firbo-api. Requires JWT principal, existing company allowlist/pilot gate and independently checked organization membership role owner/admin. Request schema still forbids client model/URL/providers. Native engine.infer is called with cloud_allowed=False and output must prove Ollama and self_hosted_no_metered_fee. Existing free, local Piper and other API routes are unchanged.
- Server-only FIRBO_CEO_LOCAL_ONLY_PRIMARY=on OFF by default; requires existing explicit FIRBO_FREE_ORGANIZATIONS UUID allowlist, authenticated owner/admin CEO auto model, no BYOK and direct user identity (not scheduler). Other agents/users/customers/manual models retain current route.
- Edge uses reviewed bounded free route envelope with a constant replacement destination to native local-only endpoint, and strictly verifies actual Ollama model/cost evidence. Runner-shared free-routing.ts remains byte-identical.
- No replay of previous ambiguous calls, same new-turn budget reservation and accounting behavior. If Ollama fails, record truthful model_error/reconcile_required without cloud fallback.

## Release gates
1. Exact-head Python ASGI + SQLite security tests, owner/non-owner cases and no-cloud safety; Node Edge routing tests; strict TS, frontend and SAST/workspace CI all green.
2. Read actual VPS Firbo API and private Ollama status/model digest; run a real authorized local generation and capture receipt. No production VPS mutation based on source CI alone.
3. Native backend-first guarded deployment with rollback image/config; then confirmed authenticated fixed local-only API, denied foreign tenant/member, zero cloud requests and provider fees.
4. Deploy Edge only after native contract proof and exact source/dependency read-back. Do not edit 19-file runner source manifest, other organizations or product databases.
5. Enable flag only for approved owner/company; verify next NEW CEO response via true local Qwen3 and adequate short context, plus real Piper/browser voice and Stop. Local Qwen3:1.7b is a limited degraded emergency option, not quality-equal complex reasoning.
6. Restore, monitoring and mobile/Desktop physical E2E before production sign-off.

STATUS: SOURCE CANDIDATE ONLY. NO Supabase changes, VPS mutation, production promotion, or PickFantasy/TradeAthletes writes. Coordinate through Master Issue #52.
