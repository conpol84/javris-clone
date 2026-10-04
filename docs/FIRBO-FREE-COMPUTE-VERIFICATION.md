# FREE-COMPUTE-1 — implementation/evidence handoff

4 October 2026. Continue PR #9 and MASTER-PLAN-V2. Read with FIRBO-DELIVERY-MATRIX.json (all 34 routes / 21 requirements remain), FIRBO-FREE-COMPUTE.md and the Dark/native checkpoints. A text-routing pilot is not a completed public Free subscription or a completed agent product.

## Exact source and verification

Starting head: 0b75baa5d97a8f1b60c531a8ca31ab06b01dbf26.
Final implementation: **1f8653479de78cb3e71a9c7ab1fe405779555bf8**, tree **1e0877d62e8f3773b32f8125c776e8141f192d0c**.
Reviewed preparation: 3d1db4af6eba58f7ceb80335fd0dbe80fbc13830, exact-head push run **37165823002**, job **111328377612**, SUCCESS. Checks applied a fixed SHA256 source package, verified before/after Git blob hashes and saved only the verified blobs. The connected GitHub tool then committed those same 13 source/doc/test blobs, added the read-only permanent workflow and removed the temporary transfer files/workflow. No background deployment was performed.

Downloaded artifact **11288838675**, firbo-free-pilot-reviewed, ZIP SHA256 **534628d7504780b304c0b15153a6e1efdbd3b82616d50463cfccef34399aaa1f**. Its reviewed-blobs.json, python.txt, node.txt, frontend.txt and build.txt were read directly. All 13 after-hashes match the final implementation.

Passed in that exact reviewed candidate:
- **98 Python tests**: existing native auth, real local SQLite concurrent admission/quotas/idempotency/provider leases/cooldowns, FastAPI route behavior and resource-probe contracts. HTTP identity/model responses were synthetic.
- **112 Node tests**: existing gateway routing, actual transformed Edge entrypoint handlers and new free-route contracts. No real Deno deployment or customer JWT was used.
- **319 frontend tests / 33 files**, strict Edge TypeScript check and production frontend build.

Local runs independently passed the 98 Python / 112 Node tests and strict Edge types. One early local route fixture incorrectly passed None instead of its mock transport and failed504; the fixture was corrected, not the runtime check, and all tests reran. No skipped assertion hides that failure. Existing deprecation, pytest cache and bundle-size warnings are not described as fixed.

Final compare from the starting head shows exactly 14 changed files: the 13 reviewed files and permanent workflow. There is NO change to frontend source, installed firbo_app.py/firbo_control.py, their pinned installer hashes, agent-speak or existing rollout scripts. No full-repository replacement from the older source archive occurred.

The final head also triggers the normal PR regression workflows. The preparation evidence above already proves the exact implementation tests; separate PR workflow results must be read before claiming that all of those workflows passed.

## Implemented

Optional native wrapper, off by default; original user JWT plus exact organization membership; server-only pilot-company selection. Internal fixed Ollama endpoint and exact reviewed local model list. Optional explicitly consented OpenRouter :free models with fresh zero-price checks, zero price ceilings and no generic provider fallback.

Real single-host SQLite admission caps and request identity prevent concurrent oversubscription of the configured pilot quota. Provider-pool cooldowns are shared by an account's models. Definite429/503 can move to another allowed pool; auth refusal, moderation refusal, partial/uncertain transport and invalid/charged responses stop. Exhaustion cannot enter paid fallback in either patched chat or runner pilot path. Input/history/output and request duration are bounded. Local serving fees are distinguished from infrastructure cost, which is NOT zeroed away.

The runner's Free lane is deliberately draft/text only: no outbound tool execution, proposed-action queue or synthetic cron identity. Non-pilot paid/gateway behavior is preserved. The wrapper bypasses mixed-price OmniRoute combos without creating another customer app; those combos are not safe enforcement for a no-paid product.

Private Ollama staging template has no published11434 port, an internal network, cloud disabled, explicit image/model-dir configuration and conservative one-model/one-parallel defaults. These are NOT confirmed adequate VPS resource settings. No model image or weights were downloaded here.

## Not done / not activated

No Hostinger container/configuration change, Supabase function/schema/secret deployment, provider connection/key use, real inference, Vercel production promotion, customer plan change or charge was performed. The source files and tests are in GitHub, not yet installed on the VPS.

No real model quality/Greek pronunciation/latency/throughput/RAM benchmark, no actual Ollama Docker boot or image/license/digest attestation, no full two-company real-account acceptance. The probe cannot promise users/sec.

The pilot is an operator allowlist, not subscription entitlement enforcement. Existing speech/listening/embeddings/other paid endpoints are not globally blocked by this code. Dark speech remains a separate paid synthesis path; a public Free tier needs a central feature entitlement gate and abuse controls or licensed local alternatives. Do not promise all app data stays on the VPS: chat/memory still use Supabase.

The single-host admission ledger is not a distributed financial ledger, streaming response replay system or exactly-once external-action guarantee. Long company/history prompts over the explicit small bound fail rather than silently dropping information. Customer-capacity promises require measurement.

## Owner action now: capacity read only

Current machine is **srv2027143**. Do not substitute an older Hostinger machine's specifications. No usable VPS execution connector was found; discovery returned Hostinger Mail only. The owner needs to run only this new read-only capacity snapshot in the existing Hostinger console:

```bash
(
set -euo pipefail
FILE="$(mktemp /tmp/firbo-capacity.XXXXXX.py)"
curl -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
  -fsSL --max-time 30 \
  'https://raw.githubusercontent.com/conpol84/javris-clone/1f8653479de78cb3e71a9c7ab1fe405779555bf8/deploy/hostinger/local_model_capacity.py' \
  -o "$FILE"
printf '%s  %s\n' \
  '1f2cb96c9fc95014686fb8bb3ef31a09f6d4b2b8153fe465c7dc0ed31d2f1d5b' "$FILE" \
  | sha256sum -c -
python3 "$FILE"
)
```

Expected report contract: firbo-local-capacity/v1; read_only=true, report_contains_secrets=false, model_execution_performed=false. This prints CPU/RAM/load/disk/GPU indicators and only whitelisted Docker statistics. It does not inspect .env, install/pull/start models or restart services. Return the safe JSON only. Keep all old runtime/recovery state; do not repeat native rollout or prior free catalogue registration.

Next sequence: hardware snapshot -> size isolated candidate with existing-stack headroom -> pin/license-review one small model -> benchmark -> matched API/Edge deployment for one real test company -> verify no-paid paths and all auxiliary feature gates -> public Free tier only after acceptance. See the companion design document for exact operator variables.

## Prior state/obligations preserved

Native read-only API was installed by owner and health corroborated; signed-in console acceptance/scoped distinct keys/guarded writes still open. Dark agent-speakv6 was deployed previously; full Dark frontend production promotion remains unconfirmed after prior422, with latest Vercel read still8e810ca. This work did not retry that failed promotion or alter domains.

Continue the useful-work path (instruction -> permitted tools -> saved/read-back deliverable -> receipt), signed Desktop/updater/pairing/revoke/offlineStop/visible browser/opt-inOSinput, actual integration consent/publishing/CRM/financial writes, home/car activation, remaining mobile/localization/real phones/voice, global budgets/Free entitlements, migration baseline/MCP/shifts, encrypted off-host restore, monitoring/performance and evidence-based final assessment. No requirement is closed by adding model names or passing synthetic tests.
