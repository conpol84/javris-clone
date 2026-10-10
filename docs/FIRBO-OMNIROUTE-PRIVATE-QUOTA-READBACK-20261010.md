# FIRBO OmniRoute protected-stack quota readback — 2026-10-10

## Incident

Owner's first read-only quota attempt on Hostinger srv2027143 produced:

    {"read_only":true,"quota_telemetry_read":false,"reason":"management_key_required"}

This **does not prove expired credits, wrong credentials, or VPS failure**. The first probe required an exported OMNIROUTE_MANAGEMENT_KEY in root's terminal environment, while the reviewed FIRBO stack saves the existing key in the verified Docker Compose .env. The first probe sent zero requests to OmniRoute and consumed zero inference tokens.

The repository already contains hardened gateway-credentials.py which discovers the running firbo-api and firbo-omniroute Compose labels, checks they share the same stack/directory, and verifies owner/read-only file properties. Do not create a replacement key, manually paste .env contents into chat, leak tokens via grep or echo, use set -x, or restart the VPS.

## Second owner readback — unresolved protected Compose stage

The owner then ran PR #131's pinned three-script wrapper and received:

    {"quota_telemetry_read":false,"read_only":true,"reason":"verified_compose_credentials_unavailable"}

This indicates the wrapper's broad exception guard intercepted an error, **not** that a provider key has expired or credits are exhausted. The error previously combined source-load, container label, Compose ownership, private .env and parse failures into the same generic message.

The updated source differentiates a safe **stage**, without ever printing file paths or secrets:
- `load_reviewed_source` — sibling script loading failed
- `inspect_running_compose` — Docker container/Compose label/working-directory validation rejected or could not be read
- `read_verified_private_env` — protected .env failed file/ownership/symlink/permission checks
- `parse_private_key_presence` — expected key entries could not be safely parsed
- `read_gateway_telemetry` — protected quota probe unexpectedly failed
- `validate_quota_contract` — remote result failed strict shape validation

Only exact allowlisted error codes from the existing hardened gateway-credentials.py Blocked exception may appear, such as `mixed_compose_projects`, `wrong_compose_service`, `configuration_owned_by_another_user`, or `local_command_failed`. Unknown exceptions remain `stage_unavailable`. Never modify ownership, bypass symlink checks, scan other directories or restart containers to silence the guard.

## Source-only solution

- omniroute_ceo_quota_probe.py accepts an optional in-process management key; the existing environment fallback remains unchanged. Only fixed GET https://gateway.firboai.app/api/usage/quota.
- omniroute_ceo_quota_stack.py imports reviewed sibling scripts, calls the existing hardened Compose inspector, privately reads the authoritative .env and passes only the management key in memory. Never prints or exports keys; no changes to environment, Docker, models, combos, Supabase or passwords; no inference call.
- If management key is missing or same as inference key it fails closed. All unexpected path/Docker/parse exceptions return bounded codes, not raw exception text.

## On-server command: after exact-head GitHub CI green

Use the final PR commit SHA instead of main/latest. Copy exactly three scripts into one temporary mode-0700 directory. Run as the trusted root on srv2027143:

    set -e
    umask 077
    WORK="$(mktemp -d /tmp/firbo-quota-check.XXXXXXXX)"
    SRC="https://raw.githubusercontent.com/conpol84/javris-clone/REVIEWED_SHA/deploy/hostinger"
    for file in gateway-credentials.py omniroute_ceo_quota_probe.py omniroute_ceo_quota_stack.py; do
      curl --fail --silent --show-error --location --retry 1 "$SRC/$file" -o "$WORK/$file"
    done
    python3 "$WORK/omniroute_ceo_quota_stack.py"

Output is only sanitized provider count/cooldown state, or a guarded reason. Do not share .env or credentials. Temp directory contains only scripts, never copied keys or env. A quota_telemetry_read=true report is not an official provider balance or billing receipt.

Ubuntu may report 9 pending package updates and a required reboot, separately from CEO model errors. Don't reboot a production VPS until backups, health and a maintenance window.

## Source/release sequence

PR #127 provider diagnostics, PR #128 Piper CEO voice, PR #129 owner-only new-turn Ollama, PR #130 FreeLLMAPI/OmniRoute read-only audits; this follow-up is stacked directly on PR #130. Do not merge out of order or overwrite concurrent Claude/Codex work.

Never automatically replay existing reconcile_required model requests to test credits. Official provider account usage and billing (not OmniRoute synthetic quota %) is the source of truth for charges. No production changes from this source candidate.
