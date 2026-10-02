#!/usr/bin/env bash
# Saves the two gateway keys into .env without showing them on screen or in your shell history.
#   ./set-gateway-keys.sh
set -euo pipefail
cd "$(dirname "$0")"
setv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
echo "Paste the INFERENCE key (the one named firbo-inference) and press Enter. Nothing will show while you type:"
read -r -s A; echo
echo "Paste the MANAGEMENT key (firbo-manage, with manage scope) and press Enter:"
read -r -s B; echo
[ -n "$A" ] && [ -n "$B" ] || { echo "Both keys are needed. Nothing was saved."; exit 1; }
setv OMNIROUTE_API_KEY "$A"
setv OMNIROUTE_MANAGEMENT_KEY "$B"
chmod 600 .env
docker compose up -d firbo-api >/dev/null 2>&1 || docker compose up -d >/dev/null 2>&1 || true
echo "Saved. Now run: ./setup-gateway.sh"
