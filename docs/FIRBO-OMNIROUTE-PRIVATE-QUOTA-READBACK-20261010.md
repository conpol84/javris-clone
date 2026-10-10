# FIRBO OmniRoute protected-stack quota readback — 2026-10-10

## Incident

Owner's first read-only quota attempt on Hostinger srv2027143 produced:

    {"read_only":true,"quota_telemetry_read":false,"reason":"management_key_required"}

This **does not prove expired credits, wrong credentials, or VPS failure**. The first probe required an exported OMNIROUTE_MANAGEMENT_KEY in root's terminal environment, while the reviewed FIRBO stack saves the existing key in the verified Docker Compose .env. The first probe sent zero requests to OmniRoute and consumed zero inference tokens.

The repository already contains hardened gateway-credentials.py which discovers the running firbo-api and firbo-omniroute Compose labels, checks they share the same stack/directory, and verifies owner/read-only file properties. Do not create a replacement key, manually paste .env contents into chat, leak tokens via grep or echo, use set -x, or restart the VPS.

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
