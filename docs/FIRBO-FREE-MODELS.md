# Firbo: expand verified free catalogue offers, without replacing working routing

Date: 2026-10-03. Continue the existing production plan and PR #9. Parent: b7bbeaee86d06b21579110cb8f4a7773d9dd35ac.

## Correct production checkpoint

The connectivity hotfix is now PRODUCTION at ae82ca939f1a19130871c6ad7661f22be200d3c0, deployment dpl_FFpzRVXxp8UWpSfiZ2RpDZuefBSM. The prior Vercel check returned READY/production and live firbo-backend-health returned 200 JSON status ok. This supersedes the obsolete pending-promotion text in earlier handovers. Do not ask the owner to promote or rerun recovery checks again.

The native U1/U2 frontend/backend candidate remains in draft PR #9; it has not replaced production. This change only adds a standalone catalogue tool and its tests. No source from the narrow hotfix is discarded.

## Implemented

- `deploy/hostinger/free_models.py` reads current OFFICIAL public catalogues instead of trusting a stale list or treating all gateway models as free.
- OpenCode candidates require an exact join between the documented free input/output/cache price row, the current public model ID and the supported chat-completions endpoint.
- OpenRouter candidates require a specific :free ID or openrouter/free, explicit zero for EVERY supplied price component and text input/output support. Missing, unknown, negative and NaN prices fail closed. openrouter/auto:free is excluded.
- Default mode reads the plan only. `--public-only` uses public source URLs without Docker, credentials or gateway access. `--apply` adds ONLY missing custom catalogue records for ALREADY enabled OpenCode/OpenRouter connections in the actual Firbo gateway.
- No new provider account, paid subscription, API key, inference request, agent setting, new combo or explicit combo update. Existing manually registered/hidden models are not overwritten or unhidden; aliases are deduplicated.
- Credentials are read locally from the running firbo-api container and sent only to the fixed HTTPS gateway.firboai.app management routes. They are not sent to catalogue providers, printed, written to a journal or uploaded. No redirect or environment proxy is followed.
- A root-only local journal records intent before each catalogue mutation and read-back verification afterwards. Ambiguous failures stop without retrying or deleting anything. Verified additions before a later failure remain listed in the report.
- It checks existing custom-model entries and combos after registration, and checks that runtime metadata stayed unchanged. Upstream catalogue writes invoke OmniRoute's own backup/quota hooks; if these change combos, the script reports that fact and stops, rather than claiming no change occurred.
- All HTTP destinations are fixed; reads and catalogue sizes are bounded. There is no pip install, docker exec/build/pull/stop/restart or deployment command.

## What this DOES NOT mean

**A registered catalogue entry is not a successfully tested inference route or a permanent zero-cost guarantee.** `isFree` is descriptive metadata checked against current sources at registration. This change does NOT yet implement a per-request zero-price guard, a free-only combo, fresh billing reconciliation, quota reservations or automatic routing cutoff when provider terms/prices change. It does not alter the current firbo-economy or firbo-quality selections intentionally.

The deployed API's Free Models tab still proxies OmniRoute's static FREE_MODEL_BUDGETS. Adding custom models increases the provider/model catalogue, but does not by itself rewrite that static upstream free-budget list. Do not claim the old Free Models tab is now a dynamic real-time free-only policy.

OpenCode's free offers are temporary; some permit retention or improvement/training use, and NVIDIA's free endpoint is trial-only. Candidate output is explicitly public-data-only and execution-unverified. Do not send company secrets, customer information, unpublished code or personal data to these services as part of verification. Read and accept each provider's own terms before using a trial-only endpoint. Model discovery/registration does not send any prompt.

An unconnected provider is reported as `requires_provider_connection`; the script does not manufacture credentials or mark it connected. In the owner's last overview only OpenCode, AI Horde and OpenAI were connected. OpenAI is not relabeled free. New OpenRouter/Groq/Gemini/etc. account setup is a separate consent and credentials step, not performed here.

## Modes and exact effects

```
python3 free_models.py --public-only  # public current offers; no Docker
python3 free_models.py                # read-only local plan, requires existing root console
python3 free_models.py --apply        # append missing records; local audit journal
```

`--apply` is an actual gateway catalogue write, unlike the previous recovery diagnostics. The current delivery message will pin the tested commit and SHA-256 before execution. Do not run from an unreviewed moving branch or paste keys into chat.

Successful registration reports `catalogue_registered_execution_unverified`; an already complete catalogue may report `no_new_models_for_connected_providers`. If blocked, send only the safe JSON and do not retry or run repair.sh blindly. No additional AI costs are incurred by this tool's own requests because it never calls an inference endpoint; any independent running jobs remain outside its scope.

## Verification

Initial local run: 36 unittest cases PASS and Python compilation PASS. All upstreams and Docker were mocked. Exact source/test blobs are checked into this commit. GitHub Actions additionally tests the actual public catalogue response formats with no account/secret/inference. Its results must be checked before claiming the script is compatible with the live official sources.

The real Hostinger management/API registration path is NOT verified until the owner executes the pinned tool. No protected gateway catalogue request or write has been performed by the assistant in this code preparation stage.

## Remaining work, preserved rather than restarted

1. Verify newly registered free endpoints with a minimal public test only after scoped inference credentials and provider terms are checked; construct an isolated free-only policy with no paid bypass, per-request price/availability checks, bounded retries and capability-aware routing. Keep paid Quality separate.
2. Complete consistent data backups, encrypted off-host recovery and an isolated restore/boot; deploy the matching native API safely, preserving production ae82ca9 connectivity.
3. Separate inference/management credentials, consolidate mission/audio paths, add a durable server-owned request ledger and atomic budget reservations; complete native provider lifecycle, migrations, MCP/shift hardening, requested integrations and real tenant/mobile/microphone QA.

Do not advertise this stage as fully unified or production ready.

## Primary sources

- OpenCode Zen models, current pricing and privacy: https://opencode.ai/docs/zen/
- OpenCode public catalogue: https://opencode.ai/zen/v1/models
- OpenRouter public catalogue: https://openrouter.ai/api/v1/models
- OpenRouter free variants: https://openrouter.ai/docs/guides/routing/model-variants/free
- OpenRouter free router: https://openrouter.ai/openrouter/free
- Own fork provider-models API and db/models addCustomModel implementation, branch firbo/branding.
