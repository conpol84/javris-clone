# FIRBO CEO — confirmed rate-limit / local Qwen3 recovery (2026-10-10)

This source branch is stacked on PR #126 exact head 5b218120815367d5c4718378bb5f03e70b5fff15. Coordinate through master Issue #52. Scope: FIRBO project bfeinnsorgjycivozcau ONLY. No changes to PickFantasy or TradeAthletes Supabase.

## Observed incident

FIRBO agent-chat v51 source equals the checked GitHub source byte for byte. Actual HTTP POST returned 502 at 2026-10-09 22:29 UTC and 2026-10-10 02:27 UTC. The owner inference ledger records two model_error items and a distinct desktop_model_rate_limited event, with earlier settled OmniRoute completions. A model_error reason is not proof that Qwen ran or even that the upstream produced a model completion.

The Ollama and Piper VPS containers were previously reported running, but service health is not proof of inference and playback. Local Qwen text and local Piper audio are two separate routes. Existing FIRBO_ALLOW_LOCAL_CHAT selects the allowlisted local route as primary; it is not automatic recovery. The default Dark voice profile uses a separate cloud TTS service.

## Source-only change

1. Distinguish definite direct-provider HTTP errors from unknown failures with bounded diagnostic codes, never raw upstream messages, secrets or prompts.
2. Introduce FIRBO_ALLOW_LOCAL_FALLBACK=on: OFF by default and server-only. Requires tenant UUID already present in FIRBO_FREE_ORGANIZATIONS, an enabled CEO agent, no own-provider key and exactly one direct-provider target.
3. After a definite direct HTTP 429 rejection (no accepted upstream inference), allow exactly one local Qwen3 request on the existing authenticated text-only zero-provider-fee route with the same request ID.
4. Never fail over after ambiguous gateway processing, 5xx, timeouts, multi-target paths, own-key usage, cross-tenant requests, or unknown errors. Preserve request accounting and reconcile-required on uncertainty. A failed local request is not automatically retried.
5. No TTS preset change, backend credential exposure, audio replay, device operation, or change to other product runtimes.

## Release gates

- Exact-head Node unit tests for allowed and denied routes, Edge TypeScript compile, full frontend tests/build, SAST and relevant shared lifecycle checks.
- Review the complete Edge source bundle and verify production source/version before any deployment.
- Confirm installed, authenticated owner-local Ollama status and perform one safe bounded text generation with real receipt, company authorization and no cloud-provider call.
- Confirm live HTTP 429 is definitively rejected by a single direct provider before enabling recovery, never treat 5xx/timeout or gateway uncertainty as safe retry.
- Enable the flag only for explicitly approved owner company after owner acceptance; never for public tenants or paid BYOK.
- Physically verify CEO text reply, optional Piper/browser TTS, audio playback, Stop, privacy and cost ledger.
- Maintain prior function deployment and rollback path.

## Checkpoint
Changed: candidate FIRBO GitHub source and tests only.
Tested: CI must run on exact PR head.
Passed: no test result claimed before CI.
Failed: existing production CEO model_error remains until verified release.
Remains: all live backend and physical acceptance gates. No production, Supabase or device writes in this stage.
