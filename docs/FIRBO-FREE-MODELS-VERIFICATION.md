# Current free-model discovery: verified sources and controlled registration

Date: 2026-10-03. Continue draft PR #9 and the existing staged plan. Live frontend ae82ca9 is not changed by this work. No deploy, database mutation, key rotation, account creation or model execution has been performed by this stage.

## Actual verified public-source results

Code/script revision: 5285c388818bdb2696b4abe7f1933685f7928187.
GitHub run 37102769504, public-catalogue job 111145407259, execution timestamp 2026-10-03T06:21:17.570792+00:00. Read the real official HTTPS sources, not just cached search snippets. Both sources parsed successfully; source_errors is empty. No authentication or inference requests were made.

| Source | Offers satisfying the implemented price/protocol filter | Registration policy |
|---|---:|---|
| OpenCode docs joined to its live public models | 10 | 8 candidates; 2 Nemotron trial-related offers held for terms review |
| OpenRouter live public models | 18 | Explicit zero-priced :free variants plus openrouter/free; only if the provider is already connected |

This is the subset satisfying this tool's strict text/price filters, not a count of every free model on the internet and not a count of new models added to the owner's gateway.

Eight eligible OpenCode catalogue IDs at that snapshot:
- big-pickle
- fledge-alpha-free
- ling-3.0-flash-fin-free
- ling-3.1-flash-free
- longcat-2.5-preview-free
- mimo-v2.5-free
- mimo-v2.6-flash-free
- space-bunny-free

Held, not automatically registered: nemotron-3-ultra-free and nemotron-3.5-lightning-free. Existing operator entries are left unchanged, including any previously installed trial entries.

OpenRouter candidates at that snapshot: apodex/apodex-1.1-mini:free; cohere/north-mini-code:free; dots-studio/dots-3-note-preview:free; google/gemma-4-26b-a4b-it:free; google/gemma-4-31b-it:free; inclusionai/ling-3.0-flash-sante:free; liquid/lfm-2.5-2.6b:free; nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free; nvidia/nemotron-3-super-120b-a12b:free; nvidia/nemotron-3-ultra-550b-a55b:free; nvidia/nemotron-3.5-content-safety:free; nvidia/nemotron-3.5-lightning:free; openrouter/free; poolside/laguna-s-2.1:free; poolside/laguna-xs-2.1:free; qwen/qwen3.8-27b:free; thinkingmachines/inkling-small:free; thinkingmachines/inkling:free.

Do not infer task suitability, production usage rights, provider availability, privacy guarantees or successful execution solely from these IDs. Some entries are specialized safety/code models. Registration does not assign them to agents or combos.

## Tests, including a failure found before owner execution

Initial 36 unit tests passed. The first real-source workflow failed with catalogue_ids_invalid for OpenRouter because it validated the complete heterogeneous catalogue, including unrelated entries. The corrected implementation first selects the permitted free variant IDs, then applies strict unique/safe-ID checks to those candidates. Bad/duplicate candidate IDs still fail; price checks were not weakened. The subsequent public-source workflow above passed.

Added five regression tests for unrelated IDs, bad and duplicate free IDs, trial exclusions and mutation-boundary enforcement. All 41 tests pass locally, using mocked Docker/network. They are included in the workflow in this final changeset. Script bytes are unchanged from the successfully checked 5285c38 revision.

Standalone script SHA-256:
0cf5cd914ddf47f61d382eeb5fc1c861a45c3b6f9415d7dd6f9b1b5063fb46e2
Git blob: 89dcc9d0e35259fb6c5c0b9361a19114aec7e84e.

## Owner action and its precise side effects

Run the checksum-pinned script from the delivery message in the same root Hostinger console, ending in --apply. Unlike recovery diagnostics, this requests real append-only gateway custom-model registrations. It reads the existing management credential locally and sends it only to gateway.firboai.app. It does not print or upload credentials, send prompts, buy credits, connect new providers, switch agents or explicitly modify combos. It creates a root-only local audit journal and reads back every new record.

Existing models and hidden choices are preserved. OmniRoute's internal catalogue hooks can run on model registration; the script compares pre/post existing models and combos and reports any unexpected changes, not an automatic rollback. A failed/ambiguous mutation is not silently retried. Send ONLY the resulting safe JSON; no keys, archives or raw Docker inspection.

Expected final status: catalogue_registered_execution_unverified, or no_new_models_for_connected_providers if nothing is missing. An absent OpenRouter connection is reported rather than auto-created. The exact number of additions requires the real gateway read-back, which has NOT happened yet.

## Important remaining limitations

This is catalogue expansion, not a complete dynamic Free Models UI or free-only inference policy. The currently deployed free-budget tab still uses OmniRoute's static source. isFree is point-in-time metadata; discontinued entries are not silently deleted or relabeled. A future isolated firbo-free policy needs refreshed price/availability, actual scoped keys, capability checks, zero-cost enforcement and no paid fallback. Economy/Quality remain unchanged intentionally.

Free promotions can expire and some providers retain prompts or prohibit confidential/personal data. Keep test inputs public. NVIDIA/OpenCode trial-related entries are withheld automatically. No blanket production-use clearance for any provider is implied.

Native API installation, consistent DB/volume backups and off-host restore, distinct scoped keys, mission/audio consolidation, durable request/budget accounting, provider lifecycle, requested adapters, migrations, MCP/shifts and real account/role/mobile/microphone QA remain in FIRBO-PRODUCTION-PLAN.md. Do not restart the audit or advertise full production readiness.

Evidence:
https://github.com/conpol84/javris-clone/actions/runs/37102769504
https://opencode.ai/docs/zen/
https://opencode.ai/zen/v1/models
https://openrouter.ai/api/v1/models
https://openrouter.ai/docs/guides/routing/model-variants/free
