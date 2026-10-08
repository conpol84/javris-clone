# NATIVE-API-1 — diagnosed mismatch and API-only rollout

Checkpoint: 4 October 2026, Cyprus time (evidence timestamps below are UTC). Continue PR #9 and MASTER-PLAN-V2; do not restart the audit or drop any prior product requirement.

## Why the owner's native engine panel is unavailable

Fresh connected Vercel inspection resolves firboai.app to production READY **8e810ca8fc1c86725d8636e198ef8d95553b66dd**, deployment **dpl_8V7hub28KQT413dWPbjmnHH76muR**. This production promotion occurred outside this work.

Public-domain probes:
- 2026-10-03 22:55:42 UTC: `/firbo-backend-health` -> HTTP200 JSON `{"status":"ok"}`, Via Caddy, no-store.
- 2026-10-03 22:55:59 UTC: `/v1/firbo/session` -> HTTP404 JSON `{"detail":"Not Found"}`, Via Caddy, no-store.

The existing Vercel-to-Hostinger route reaches the old API, which lacks the native control endpoint expected by the newer UI. This is not solved by refreshing or promoting another frontend. The new native source returns a firbo-control/v1 health contract and an unauthenticated native session request returns 401 sign_in_required, not 404.

Live Supabase METADATA ONLY was read: is_platform_admin() exists, returns boolean, is callable by authenticated users and checks auth.uid() against platform_admins. Its existence does not prove a particular login has admin access. No user roles, schema or functions were changed.

## Implemented remedy

`deploy/hostinger/native_control_rollout.py` is a standalone standard-library installer for the existing Firbo VPS. It defaults to inspection; --apply is the actual deployment. It reads actual Docker/Compose identity and fails closed on unexpected paths, environment/configuration/mount drift, public ports or privileges.

It builds a small derivative of the CURRENT API image, replacing only the two reviewed native control modules, whose pinned source/hash are verified. There is no git pull, full application rebuild, pip install/dependency upgrade, database migration or image pruning in the installer. A private, unprivileged, read-only canary with no published ports or persistent mounts must boot first. The canary verifies exact source hashes, native health, anonymous denial and read-only gateway catalogue access.

Only firbo-api is recreated, using --no-deps --no-build --pull never. Existing OmniRoute/Redis/Caddy identities must remain unchanged. The active Compose override is persisted so a normal subsequent Compose invocation retains the new image. Existing configuration and the original local image are kept for rollback. Public native endpoints are checked after cutover; a failed check attempts automatic rollback. Concurrent configuration edits cause a stop rather than overwriting operator changes.

Gateway writes remain explicitly disabled with FIRBO_CONTROL_WRITES_ENABLED=false. The initial result is authenticated native control/read access, not a fully enabled mutation API or the complete OpenJarvis agent engine. Existing keys are reused locally; values never appear in the public report. If inference/management key values are equal, the report records keys_distinct=false; credential separation/rotation remains a later requirement.

## Exact tested source and checksum

Installer implementation: 54f3d6a6ae44a1060e9a961f9a057a619d539daf.
Final tested workflow/source head: **705b94b9921bf85733a64d9b5704ba7dbfafb0ce**.
The latter changes only isolated pytest configuration, not installer bytes.
Installer Git blob: ec6c7ede0ec5185117b42a8c22a527068a6f83ff.
Installer SHA256: **c97c13436eecc4019061a261d15640b629629fdcde0d7e3f2a2353f6d573eb77**.

Native modules are pinned to 8e810ca8fc1c86725d8636e198ef8d95553b66dd:
- firbo_app.py SHA256 80ee271e03b40892510114c11cda2fd4cfc0fa1a91330ebcaa87ffd0f9c5e8af
- firbo_control.py SHA256 d1f568fe4d915284f6e990b3362e28156595e5dae13741d8a32ab41adf211a71

## Passed and failed

**50 isolated native-control/installer unit tests passed** locally and in corrected CI. These mock network and Docker control flow; they are not live-machine tests.

The first CI run 37160753799 failed before collection because it loaded the unrelated top-level legacy OpenJarvis conftest. The workflow was corrected to the existing Firbo convention: explicit pytest config and --confcutdir=tests/firbo. No test or assertion was skipped to hide the failure.

**Actual disposable Docker lifecycle passed** in exact-head push run **37160905221**, job **111313944924**, on 705b94b. It builds a real image, starts real containers, creates the isolated canary, cuts over only the API, verifies a harmless second invocation, restores the old image/configuration manually, then installs again and forces the final acceptance gate to fail to prove automatic rollback. Companion container IDs/start times remained unchanged. The corresponding PR rollout run **37160908142** also succeeded.

Downloaded artifact **11286999890**, `firbo-native-rollout-evidence`; ZIP SHA256 **095b99e24b18131c7b28b70cacc04145c446778841216faa77edc7f960436483**. Read docker-results.json directly: four reports record successful install, no-op, successful manual rollback and intentionally blocked install with verified automatic rollback.

Important test boundary: the gateway, original API and Caddy/Redis stand-ins are synthetic services inside disposable CI Docker. The production public-probe function is replaced there by actual Docker-network probes from the Caddy stand-in. Therefore the artifact's public_native_routes_verified flag represents that substituted test gate, NOT verified public TLS/Caddy/Vercel on the owner's machine. There was no real Supabase session, provider credential, inference or customer data in CI. No local Docker runtime was available; actual-container evidence is from CI.

## The owner's one required operation

There is no usable Hostinger VPS execution connector in the current toolset; discovery returned Hostinger Mail, not VPS administration. Do not claim a remote deployment occurred. The prepared command must run in the existing root@srv2027143 Hostinger console, not Windows PowerShell or the Vercel console:

```bash
(
set -euo pipefail
FILE="$(mktemp /tmp/firbo-native.XXXXXX.py)"
curl -q --proto '=https' --proto-redir '=https' --tlsv1.2 \
  -fsSL --max-time 30 \
  'https://raw.githubusercontent.com/conpol84/javris-clone/705b94b9921bf85733a64d9b5704ba7dbfafb0ce/deploy/hostinger/native_control_rollout.py' \
  -o "$FILE"
printf '%s  %s\n' \
  'c97c13436eecc4019061a261d15640b629629fdcde0d7e3f2a2353f6d573eb77' "$FILE" \
  | sha256sum -c -
python3 "$FILE" --apply
)
```

This performs a real API-only change; a brief API interruption is possible during recreation. Do not run concurrent Docker/configuration/provider edits or close the console while it is running. It does not repeat the previous archive/model-registration work. It is not a full data backup: root-only configuration copies contain secrets, are not separately encrypted and have no verified off-host copy. Keep the original images/configurations; do not prune them.

Expected safe report contract: firbo-native-control-rollout/v1. A successful operation reports native_api_deployed_read_only and public_native_routes_verified=true, with authenticated_user_acceptance=pending_browser_check. A blocked result is not a successful install. Return only the safe JSON, not private configuration files, .env, tokens or Docker inspect output. Do not bypass guards or retry blindly. Manual rollback mode exists for the exact recorded release directory but should be used only after inspecting the report and current state.

## After successful deployment

Recheck real `/firbo-backend-health` for the contract and `/v1/firbo/session` unauthenticated for 401. Then use the normal Firbo login and open the native engine/Gateway panel. Confirm actual providers/models/combos load. Anonymous401 is expected; logged-in403 means a genuine role/authorization issue that must not be bypassed. Native routes loading does not prove all agents execute correctly.

No new Vercel Promote or frontend redeploy is required for this API installation. Mutation controls remain disabled deliberately until distinct keys, audit/rollback and real-account acceptance are ready.

## Not done by this change / continuation

No Hostinger runtime change has yet been performed by the assistant. No frontend redesign, new provider authorization, Supabase schema/function deployment, paid model call or desktop/device pairing occurred in this work unit.

The useful-work milestone remains: voice/phone request -> permitted task/device -> authorized execution -> saved/read-back report and receipt -> visible result. Full iterative OpenJarvis orchestration, native write controls, scoped keys, durable request ledger/atomic budgets/Free-only routing, signed Desktop/updater, pairing/revoke/local Stop, visible browser and OS input, real voice/device acceptance, outstanding mobile pages/translations, actual TikTok/YouTube/Salesforce/QuickBooks consent and writes, home/car activation, migration baseline, encrypted off-host restore, monitoring and final assessment ALL remain required.

Do not relabel the entire app complete or world number one from this control API rollout. It removes a verified integration blocker and preserves the route/device/voice work already done.
