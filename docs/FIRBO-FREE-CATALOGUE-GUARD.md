# Firbo continuation: live connectivity retained, free catalogue guard

2026-10-03. Continue PR #9 and FIRBO-PRODUCTION-PLAN.md. Do not repeat the completed promotion or OCI archive-verification steps.

## Where we are

The connected Vercel check in this session returns firboai.app on production READY `ae82ca939f1a19130871c6ad7661f22be200d3c0`, deployment `dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM`. The native U1 API/UI and U2 routing remain a candidate in PR #9, not an installed full release. Local configuration/API-image archive verification passed from the owner's prior report; data/volume backups, encrypted off-host copy and actual restore/boot are still open.

The newer interrupted free-model work is present at `33c8be6e2c6dd86dba30667e7d9233e6481d5a0a`; it was read before continuing, not overwritten. Its seven returned PR workflows are all successful. The earlier official-source snapshot recorded 8 eligible OpenCode candidates (2 additional trial-related entries held) and 18 OpenRouter candidates. Those numbers are discovery results, NOT live registrations or tested free inference. The current public-source workflow and the installation script fetch sources again; do not hardcode stale offers.

## What this slice changes

The reviewed OmniRoute fork's `addCustomModel` triggers `notifyQuotaCombosForProvider`, so registering a model can indirectly resynchronize quota routing. The previous append-only helper checked combos only after a batch. A new guarded entry point checks `/api/quota/pools?limit=200` before mutation, and refuses all nonempty/incomplete/unavailable pool results. It repeats the check immediately before each individual model POST and after each result. No quota pool is created, deleted or disabled.

The entry point retains the exact SHA-pinned, already-tested price-discovery/registration helper. It also adds a local registration lock, five-minute maximum age for the discovered price snapshot, fresh provider/runtime checks, checks of existing model rows and hidden preferences, and comparison of the complete combo list. Registered results are read back by the original helper. Unsafe or ambiguous outcomes remain blocked; original data is not automatically rolled back or deleted.

Do not edit providers/models/combos or run other configuration jobs concurrently. These checks and the per-VPS tool lock are NOT a distributed transaction over arbitrary gateway writers. A race or asynchronous external change may still need reconciliation. This is controlled catalogue maintenance, not a blanket production-readiness guarantee.

## Test scope

24 new local unittest cases pass with mocked helper/network/Docker behavior. The uploaded guard blob matches the tested local file: `99370c5553623ec89251c51f27d06d94bc5938d8`. Original 41 discovery/registration tests are retained. CI now runs all matching suites, validates the exact helper checksum, and exercises the REAL helper registration plus this guard together against mocked services, including a no-duplicate repeat. CI results at the final commit must be checked separately; no passing result for a future run is claimed here.

No model prompts, customer data, credentials or production writes were sent by these local tests. Direct container network retrieval was unavailable, so real official-source checks use the repository's existing read-only GitHub workflow. Web search versions may be older than the live source; the script intersects the current catalogue with current price evidence rather than relying on search-result model names.

## Owner execution: one guarded catalogue step

Use `free_models_guarded.py --apply`, NOT the older unguarded helper command. Download both files into one new temporary private directory from the exact release commit and validate both hashes before execution. The delivery message contains the ready-to-paste block.

- `free_models.py` SHA-256: `0cf5cd914ddf47f61d382eeb5fc1c861a45c3b6f9415d7dd6f9b1b5063fb46e2`
- `free_models_guarded.py` SHA-256: `4fad16d811e696653850229939eea976de3a0b0c8ed07f87b342add3c4371907`

Unlike the old recovery checks, --apply requests real NEW catalogue entries in the running gateway and writes a private local journal/lock under /root/firbo-free-models. It reads the current management key locally from firbo-api; sends it only to the fixed gateway host; does not return its value. It connects no new providers, invokes no models, buys no credits, changes no agent setting and requests no combo update or restart. Existing models are not replaced or unhidden.

Only already-connected supported providers are used. An absent OpenRouter account is reported as requires_provider_connection, not silently created. TikTok/YouTube/Salesforce/QuickBooks account connections are unrelated to this model-catalogue operation and remain unfinished adapters.

Expected safe report contract: `firbo-free-catalogue-guard/v1`.
- `catalogue_registered_execution_unverified`: report lists the actual new IDs and confirmed read-back. This does NOT mean tested inference or guaranteed future zero price.
- `no_new_models_for_connected_providers`: nothing eligible is missing under the present connections/preferences.
- `blocked`: send only the safe JSON and stop. In particular, do not disable quota protections to force a successful result. If writes_may_have_occurred is true, inspect registered_models and the private journal before any retry; do not upload journal, raw provider response, .env or keys to chat.

## Remaining free-tier work

A separate Free tier must require current pricing, successful public/synthetic-input tests, documented privacy/terms approval, inference-only credentials and an enforced zero-price provider policy without paid fallback. Merely setting isFree is insufficient. Do not route company prompts or change Economy/Quality automatically. Free Models UI currently uses a static budget source; dynamic evidence and per-model tested/unavailable/stale status remain to implement with the native API.

The full unification, matching Hostinger candidate install, provider lifecycle, mission/audio consolidation, request ledger/atomic budgets, migration reconciliation, MCP/shift hardening, backups, monitoring and real tenant/mobile/microphone tests remain in the original plan. Do not describe them as completed by this catalogue step.

## Primary implementation/evidence references

- conpol84/OmniRoute firbo/branding: src/lib/db/models.ts, src/lib/db/quotaPools.ts, src/app/api/quota/pools/route.ts, src/app/api/provider-models/route.ts.
- conpol84/javris-clone: docs/FIRBO-FREE-MODELS-VERIFICATION.md and prior production-release evidence in PR #10.
- https://opencode.ai/docs/zen/
- https://opencode.ai/zen/v1/models
- https://openrouter.ai/api/v1/models
- https://openrouter.ai/docs/guides/routing/model-variants/free
