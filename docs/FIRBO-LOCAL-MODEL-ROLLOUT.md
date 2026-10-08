# LOCAL-MODEL-1 — actual model, guarded installation and existing Gateway interface

4 October 2026. Continue MASTER-PLAN-V2 and PR #9. This is a complete tested installation package and a usable local-text pilot, NOT completion of the entire Firbo product, public Free subscriptions, Desktop control or customer acceptance.

## Current host evidence — supplied by the owner

`firbo-local-capacity/v1`, 2026-10-04T00:59:08.524538Z, host **srv2027143**: x86_64, 2 logical/available CPUs, 7.75 GiB total RAM, 5.83 GiB available, no swap, 65.59 GiB free root disk, no GPU device/nvidia GPU. Existing API/OmniRoute/Caddy/Redis were running with low measured load. This is a point-in-time capacity snapshot, not a performance guarantee. Do NOT ask the owner to repeat it or substitute an older VPS's hardware.

The new installer rechecks current headroom before modifying anything, reserves a hard 3 GiB memory / 1.25 CPU limit for one Ollama container, limits generation to one concurrent request, 2048 context and 128 output tokens. This is for short drafts and validation, not large documents or production throughput claims. No swap or host OS change is made.

## Exact source and external artifacts

**Final implementation: e5890ec79cfeec03f8ab9efa63ddb21b89e78aef**, tree513b0ba63d9a2906a687d7cb4306a1e120db425c.
Installer: `deploy/hostinger/local_model_rollout.py`.
Installer SHA256: **7f0c17d1b8dcae67130e465b9a975a75c1c9f1f97f8721031ad6db05a04e30fd**.

Pinned Ollama image: `ollama/ollama@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c` (verified0.35.1).
Model: `qwen3:1.7b`, Q4_K_M, approximately1.4GB model download, Apache2.0. Manifest SHA256 **8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7**. Installer verifies the manifest and every config/layer blob hash/size and checks the included license. Docker image download is additional to the model download.

The old native installer is imported ONLY as a verified validation helper; its install routine is NOT executed again. Native helper ref705b94b9921bf85733a64d9b5704ba7dbfafb0ce/SHA256c97c13436eecc4019061a261d15640b629629fdcde0d7e3f2a2353f6d573eb77. Existing firbo_app.py/firbo_control.py bytes remain unchanged.

## Implemented runtime and UI

The installer creates a non-root, read-only-root Ollama container with no published11434 port, no Docker socket, no app/data mounts and cloud disabled. Model acquisition is separate; serving uses an internal Docker network and read-only verified model files. Only the existing Firbo API and the owned model/probe containers join the intended runtime path.

The API derivative adds only the two pinned reviewed Free-runtime modules. Original native identity, gateways and mounted data remain; an additional private SQLite admission ledger is separate. Native mutation controls stay off. API-only recreation uses no-deps/no-build/pull-never, and ordinary Compose invocations retain the selected override. Existing OmniRoute/Caddy/Redis identities must remain unchanged.

Access is an **existing-platform-admin pilot**, still requiring exact organization membership and the normal Firbo JWT. No roles are assigned. Ordinary customer plan/model preferences and current chat/task routing are NOT switched. Optional cloud/free models are explicitly empty/disabled in this installation; the local pilot never falls through to paid providers. A missing/slow local model fails honestly instead.

In the EXISTING Gateway -> Free models tab, `LocalComputePanel` now offers explicit connection check, short local generation, Stop waiting, result display and a downloadable Markdown draft. No automatic generation or new navigation item is introduced. The status verifies the model identity, not merely a running container. Scope changes discard late results. Stop cancels client waiting and fences late responses; it is not certification that a server process or PC job stopped. The draft download is generated in the browser, not an artifact executed/read-back from a user's PC. Existing holographic/voice/device screens remain.

The new panel's labels cover eight languages. Actual browser samples cover EN/EL/AR and stated widths only; this is NOT full all-page mobile/translation certification. The small output limit can truncate a longer requested draft; this pilot is deliberately short-form and must not be sold as long-report completion.

## Actual verification — evidence read, not only workflow badges

### Preliminary actual Ollama run
Run37166927411 / artifact11289479677, ZIP SHA25631c4fc4ce2928ddeff0902a755b89826e9682a1031e9c7593ba40b2c2a26a884: actual Ollama/model generation under1.25CPU/3GiB on disposable CI. Obtained version/image/model identities and short English/Greek/arithmetic outputs. The source snapshot from this run preserved existing work before the next edits.

### Complete reviewed installation package
Exact reviewed source preparation head **2c05f47350a6be2872fc290e56702c49f6111c7a**; **run37167972309, job111334835450 SUCCESS**. Fixed before/after blob hashes were checked, tests ran, then only verified blobs were stored. The connected GitHub action explicitly committed those exact ten blobs as e5890ec7. Temporary source-transfer files and both preparation workflows were removed from final source; permanent regression workflow remains.

Downloaded **artifact11290557044**, `firbo-local-install-verified`, ZIP SHA256 **44009b860c7826cdf7821788621af127155a4b1ec5a057c969ebac913f620d46**. Directly read verified-blobs.json, docker-results.json, browser/results.json, python/frontend/build logs. All10 saved hashes match local reviewed files and the committed implementation.

- **115 Python tests PASS**: native identity and Free admission, actual SQLite behavior, local status authorization, installer guards.
- **319 frontend tests / 33 files PASS**, TypeScript/production build and isolated actual-page build. Existing deprecation/cache/chunk warnings remain.
- **12/12 actual Gateway browser cases PASS**: layout320EN/EL,390EL/AR,768EN,1440EN; missing backend, denied identity, Stop/late result, identity switch, rejected paid-looking response and draft download. These use synthetic identity/model HTTP responses, not real customer sessions. Three screenshots retained; Greek320 and desktop1440 visually inspected. No clipping was hidden to manufacture a pass.
- **Actual complete Docker + Qwen lifecycle PASS**, not a mocked model: model acquisition/hash verification; real local English/Greek/arithmetic inference; private canary; API-only cutover; persistent default Compose config; harmless repeated invocation; manual restoration; second install with deliberately failed final acceptance and VERIFIED automatic restoration. Companion container IDs remained unchanged. No paid API call was made.

Real-model first installation outputs: FIRBO_OK (2.712s/5tokens), έτοιμο (1.676s/7tokens), 50 (1.184s/3tokens). Snapshot memory1.585GiB/3GiB. These are three tiny CI requests, not peak memory, tokens-per-second capacity, long-context quality or the customer's CPU latency. Do not advertise these as the VPS performance.

The CI lifecycle uses actual Ollama and Docker but synthetic old API/gateway/identity and Caddy/Redis stand-ins. It replaces hostname/capacity checks with the disposable-host test gate and public TLS probes with actual Docker-network probes. Thus public_local_routes_verified in THAT artifact is not evidence of real Vercel/Hostinger TLS or the owner's login. The installer will run the actual gates on srv2027143.

## Exact preview and production boundary

READY preview: **dpl_8WJgY3ngkaEeQPWqLQhjaUg7Eqht**, sourcee5890ec7.
**https://jarvis-command-center-fduv4vkcg-conpol84s-projects.vercel.app/gateway**
Fetched actual /gateway HTTP200 at2026-10-04 01:35:25UTC, index-lAypBHO9.js, Dark voice-sN0G-nwK.js retained. The project is bound to the existing LIVE Firbo Supabase environment; no separate hosted staging DB was created. Status/generation will not work before the owner installs the matching native runtime. No real account/device inference was performed by the assistant in the hosted preview.

Fresh production read at the beginning of this work still8e810ca/dpl_8V7hub28KQT413dWPbjmnHH76muR. No frontend production promotion, direct alias reassignment, Supabase DDL/function/secret write or Hostinger execution was performed by the assistant. Native rollout already done by owner and agent-speakv6 already deployed stay completed in their recorded scope; Dark frontend promotion previously422 remains unconfirmed. Use this new exact preview rather than assuming the normal domain has changed.

## ONE required owner operation: install and verify on the current VPS

No usable Hostinger VPS execution connector is available (fresh discovery again returned Mail only). Do not hand the owner code tasks possible through GitHub; only actual VPS execution is needed here. In the existing **root@srv2027143** console:

```bash
(
set -euo pipefail
FILE="$(mktemp /tmp/firbo-local.XXXXXX.py)"
curl -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
  -fsSL --max-time 30 \
  'https://raw.githubusercontent.com/conpol84/javris-clone/e5890ec79cfeec03f8ab9efa63ddb21b89e78aef/deploy/hostinger/local_model_rollout.py' \
  -o "$FILE"
printf '%s  %s\n' \
  '7f0c17d1b8dcae67130e465b9a975a75c1c9f1f97f8721031ad6db05a04e30fd' "$FILE" \
  | sha256sum -c -
python3 "$FILE" --source-ref e5890ec79cfeec03f8ab9efa63ddb21b89e78aef --apply
)
```

This is REAL installation, not another read-only check: downloads a pinned image/one model, consumes bounded CPU/RAM, adds one model container/private network, then briefly recreates only firbo-api if model and canary checks pass. Keep the console open; no simultaneous Docker, configuration or provider changes. No new key is requested or printed.

Expected safe report: contractfirbo-local-rollout/v1, statuslocal_model_deployed_admin_pilot, model_smoke.all_matched=true, public_local_routes_verified=true, companions_unchanged=true, customer_routing_changed=false, paid_api_calls=0, signed_in_acceptance=pending_browser_test. A blocked status is not success. Return only the safe JSON; never .env, backups, tokens or docker-inspect environment. Do not bypass a guard or retry blindly.

Private600/700 configuration copies contain secrets, are not separately encrypted and not copied off-host. They and the retained current image are rollback aids, NOT full database/volume disaster recovery. Do not prune them. Automatic rollback is attempted after a failed API cutover; rollback_verified states the result. Concurrent edits stop the procedure rather than being overwritten. Manual rollback uses the exact returned release directory only after checking state.

After success: open exact preview -> Gateway -> Free models -> Local AI/Ollama -> Check connection -> one short non-confidential prompt -> Generate locally -> Download draft. Use existing owner/admin account/company. A legitimate403 requires role diagnosis, not relaxing authorization. Stop waiting must prevent a late UI result. Other preview features still use their existing cloud services and may cost money.

## All remaining agreed work — preserved, not reclassified as done

1. Release clarity: matched production frontend/backend, actual login acceptance, clear version info. New local panel is a preview until reviewed/promoted; old Dark promotion failure not magically fixed.
2. Useful-work engine: one instruction -> scoped task -> iterative authorized tools -> persisted/read-back artifact/receipt -> Tasks/Computers/Activity. A local downloaded draft does not close this.
3. Desktop/Computer Manager: Firbo signed installer/update chain; real pairing/revoke/heartbeat; independent local permissions and offline Stop; visible dedicated browser; then opt-in OS mouse/keyboard, takeover/lock/sleep handling. Existing E1 remains.
4. Actual integrations: matched schema/function/provider apps, real OAuth consent/refresh/revoke/read acceptance; then approved TikTok/YouTube publishing, Salesforce writes and appropriately controlled accounting actions. Read adapters are not executed writes.
5. Voice/holographic/mobile: original visual acceptance, real natural speech/mic, sustained dialogue/long narration where needed; actual work/approval/error states; all remaining pages/popups/8languages/physicalAndroid/iOS. Local text does not make paid Dark STT/TTS free.
6. Devices: real HomeAssistant/Traccar restricted activation and security/load tests. Work/Home/Travel continuity and future watches/displays/NAS/AR remain proposals, not devices paired automatically.
7. Cost and Free: real load/quality benchmark, server-side subscription entitlement for ALL paid features, abuse controls, privacy consent, global ledger/atomic budgets, optional legitimate zero-priced fallback. Adminpilot is not a public unlimited Free package; normal customer chat/tasks currently remain unchanged.
8. Operations/security: distinct rotated gateway keys, guarded writes/audit, complete migration baseline, MCP/shifts fixes, two-company/device adversarial tests, encrypted off-host data backups/actual restore, monitoring/performance/dependencies and final evidence-based assessment.

Do not restart completed capacity/native/archive-format/free-catalogue work. Do not claim all work complete or best-in-world from these tests. Finish each real dependency while preserving the whole inventory.

## Primary references

https://docs.ollama.com/docker
https://docs.ollama.com/faq
https://ollama.com/library/qwen3:1.7b
https://github.com/ollama/ollama/releases/tag/v0.35.1
