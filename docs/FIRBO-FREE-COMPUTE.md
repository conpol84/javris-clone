# FREE-COMPUTE-1 — no-paid text routing candidate

4 October 2026. Continue PR9 and MASTER-PLAN-V2; read this with FIRBO-DELIVERY-MATRIX.json, not instead of it. All34routes/21requirements remain. The owner requests self-hosted models and permitted quota fallback to support a sustainable Free package.

## Implemented scope — not activated

The current production API, Supabase functions, existing paid/gateway combos and customer settings are NOT changed by this code commit. No Ollama image/model has been installed or benchmarked on the owner's VPS. No inference request or provider key was used. There is no usable Hostinger VPS execution connector in the current session; plugin discovery returned Mail only.

Optional `firbo_free_app:app` wraps the existing Firbo control API. Its new `/v1/firbo/free/chat/completions` endpoint requires a real Firbo user JWT, revalidates exact company membership and requires explicit server-side pilot-company enablement. It uses an internal Ollama endpoint, or optionally an operator-reviewed zero-priced OpenRouter model. No user-provided URL, model, tool list or cloud permission is accepted. The installed `firbo_app.py` and its pinned native-rollout module hashes stay unchanged.

Existing agent-chat and agent-runner can select this lane via `FIRBO_FREE_ORGANIZATIONS`. Once selected, failures NEVER enter the paid legacy loop or ordinary OmniRoute economy/quality combos. The edge call forwards the caller's own JWT, not a service or gateway key; validates the returned free-policy/usage receipt; and records provider inference cost as0 with infrastructure explicitly excluded. Existing non-pilot behavior remains.

This initial runner lane generates text drafts only. It skips external web tools and does not queue proposed outbound actions. Existing cron pseudo-identity is not accepted by this new lane; cron requires later service-to-service identity design. The pilot is NOT the full iterative agent engine and NOT a public subscription Free tier.

## Capacity, limits and fallback

One private local SQLite database atomically coordinates admission across API workers sharing the SAME host/path:20requests/user/day across companies,100/company/day,500/global/day,2global admitted in-flight and1active per provider pool. These are conservative pilot policy settings, not benchmarked server capacity promises. Failed admitted requests also count. Stale/uncertain jobs are not automatically replayed. Duplicate organization/request IDs return409; this ledger intentionally stores no prompt/response and cannot replay a completed answer. Task IDs are used as task request IDs; retry needs operator reconciliation after ambiguity.

Text input is bounded at2800 UTF-8 JSON bytes,24messages,4096local context tokens and512maximum output tokens. Large history/company context is rejected rather than silently dropped. It is therefore a small-draft pilot, not long-document/full-history support. The first endpoint has no streaming, vision or tool execution.

Ollama routes use an exact model allowlist (`qwen3:1.7b`, `qwen3:4b`, `qwen3:8b`), fixed internal address and no cloud suffix. Tags must be resolved to reviewed model digests/licenses during installation; the candidate does not prove a particular model is present. Only one local model is recommended initially. A second model on the same CPU/RAM is not independent backup capacity.

Optional OpenRouter routes require explicit `owner/model:free` IDs and a separate key. Before generation, every reported pricing dimension must be finite zero. The request includes zero prompt/completion/request/image price ceilings, forbids provider fallback and requests data_collection=deny. Changed prices are skipped before generation. A nonzero or invalid reported response charge fails, not a fabricated zero. These are defensive API constraints, not a guarantee that an external provider will never change its service or misreport billing.

Only definite429/503 responses before a successful completion trigger another permitted route. Retry-After/cooldowns and capacity leases are shared across the account/provider, not multiplied by model/key count. Invalid auth, moderation refusal, partial/uncertain generation and transport failures are NOT silently retried elsewhere. Exhaustion returns a bounded error; no paid fallback. A busy local pool can try permitted cloud and vice versa, but cloud remains off by default.

## Privacy and economics

Default is local inference only. Operator-reviewed cloud providers must also be enabled per company by FIRBO_FREE_CLOUD_ORGANIZATIONS after real company consent/terms/privacy review. This protects model processing location, not the whole application: the existing SaaS still uses Supabase for company messages/memory. Do not promise that all app data stays on the VPS. Remote routes can receive system/company context, so do not enable them just because a model is called free.

Self-hosting removes third-party per-token inference fees, not CPU/RAM/GPU/storage/electricity/hosting/support costs or contention. Open-weight hosting is not training proprietary Firbo foundation models. A sustainable Free plan needs bounded usage, aggregate capacity, abuse controls and a paid tier/BYO capacity, not unlimited anonymous access.

IMPORTANT: agent-speak/listen, embeddings, paid browsing and other features are separate. This slice does not add a universal billing/entitlement gate across those endpoints. The current Dark voice uses paid synthesis; installing Ollama does NOT make voice free. Do not enable a public Free package until auxiliary paid endpoints are blocked/metered or replaced by separately licensed/tested local implementations. Browser voice is not advertised as identical Firbo Dark. Paid speech processing remains unchanged.

## Existing OmniRoute is retained

Paid/canary routing stays in OmniRoute. The new no-paid pilot goes through the same Firbo API but bypasses generic mixed-price combos, so changing a normal combo cannot accidentally turn Free requests into paid ones. No third customer UI or replacement dashboard is added. A future native Gateway policy adapter can expose the restricted lane in the existing console after runtime proof; it must preserve per-company auth, privacy and budget constraints. Ollama's OpenAI-compatible API is technically compatible with gateway integration, but that alone does not enforce a Free product policy.

## Deployment gates and exact operator configuration

1. Run `deploy/hostinger/local_model_capacity.py` on the CURRENT srv2027143. This only reads CPU/RAM/load/disk/GPU signals and whitelisted Docker statistics. No env dumps, network, restart or inference. Do not substitute specifications from an older Hostinger machine.
2. Size a staging container with headroom for the existing stack. `compose.ollama-candidate.yaml` is a non-activated template, not a production overlay. It requires a reviewed image digest and existing correctly owned model directory, no public port, internal network, no cloud,1parallel/1loaded model. Actual Docker boot, health/user compatibility, image advisories and model installation are unverified here.
3. Separately download/license-review/pin ONE model. Benchmark actual Greek/English tasks, short output, first-token latency, throughput, memory peak, cancellation, restarts and concurrent existing application load. Do not pull a large model or claim customer capacity before this.
4. Prepare matched API image using `openjarvis.server.firbo_free_app:app`, private durable ledger directory owned by API user, private network access and appropriate cleanup/retention/backup. Keep FIRBO_FREE_ENABLED off until tested. Configure local model list + ledger path; no cloud key required for local mode.
5. For one consented test organization, configure FIRBO_FREE_ORGANIZATIONS in BOTH API and matched Edge functions and enable FIRBO_FREE_ENABLED=true in API only after validation. Deploy matching agent-chat/runner + shared helper; preserve rollback copies first. Do not use the previous native2-file rollout to install these new modules. If any part is missing, selected requests fail rather than pay.
6. Cloud is optional, default OFF. Requires FIRBO_FREE_CLOUD_REVIEWED=true, exact FIRBO_FREE_OPENROUTER_MODELS, private FIRBO_FREE_OPENROUTER_KEY and per-company FIRBO_FREE_CLOUD_ORGANIZATIONS. Inspect real quotas, terms and account billing, not only directory labels. Default local-first; FIRBO_FREE_CLOUD_FIRST=true is explicit operator policy only.
7. Verify real2-company authorization, every paid bypass/auxiliary endpoint, subscription entitlements, abuse controls, cost accounting, local request cancellation and quota/cooldown across concurrent workers. No public Free release before these gates.

## Local verification obtained

98 Python tests passed, including existing native guards, real SQLite admission/duplicate/parallel/pool/cooldown tests, HTTP-construction/fallback tests and actual FastAPI route tests with fake remote identity/model services.112 Node tests passed across existing gateway/actual edge entrypoints and new free-route contracts. TypeScript strict edge typecheck passed. No external model, customer session, server hardware or Docker runtime was tested. The first route test exposed a mock transport fixture passing None instead of the test transport; fixed the fixture, kept the production assertions, reran all98 successfully.

The review package uses hashes of the exact current chat/runner/test blobs to prevent overwriting other work. CI outcomes are recorded in the follow-up checkpoint/comment after checking them; local counts are not claims of all frontend/mobile regressions or complete product acceptance.

## Research checked4October2026

- https://github.com/mnfst/awesome-free-llm-apis — useful discovery directory, not installable weights or a guarantee of permanent/commercial free use.
- https://docs.ollama.com/faq — local-only mode, CPU/GPU inspection, context/concurrency/queue resource behavior.
- https://docs.ollama.com/docker — official container setup.
- https://docs.ollama.com/api/openai-compatibility — OpenAI-compatible inference interface.
- https://huggingface.co/Qwen/Qwen3-4B — primary model/license card; actual quantization/performance must be tested.
- https://openrouter.ai/docs/guides/routing/provider-selection — price ceilings/data policy/provider fallback.
- https://openrouter.ai/docs/api-reference/limits — account/model rate and credit limits; no duplicated-key quota assumption.
- https://developers.cloudflare.com/workers-ai/platform/pricing/ — daily10000Neuron allocation, not10000per model; paid overages after upgrading; some models paid-only. Candidate future provider, NOT integrated here.
- https://ai.google.dev/gemini-api/terms — current terms require Paid Services for API Clients made available to EEA/Swiss/UK users. Do not default a Cyprus/EEA consumer product to Gemini unpaid capacity.

## All previous obligations survive

Dark frontend production promotion422 remains unresolved (fresh Vercel read still8e810ca); agent-speakv6 previously deployed, human timbre/mic acceptance pending. Native read-only rollout done; don't repeat old scripts. Keep iterative tools/artifact receipts, signed Desktop/updater, pairing/revoke/localStop/browser/OSinput, actual provider consents/publishing/CRM/financial integrations, home/car activation, remaining mobile/localization/physical devices, full distributed financial ledger/budgets, migrations/MCP/shifts, encrypted off-host data restore, monitoring/performance and final assessment. This commit does not close them.
