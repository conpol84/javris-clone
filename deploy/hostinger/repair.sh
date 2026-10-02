#!/usr/bin/env bash
# Repairs the server settings WITHOUT losing anything, restarts the stack and prints a health report.
# Safe to run any number of times. It never prints your passwords or keys.
#
#   cd ~/javris-clone/deploy/hostinger && git pull && ./repair.sh
#   ./repair.sh --fresh   also starts the gateway from a clean state (use if you cannot log in to its dashboard)
set -uo pipefail
cd "$(dirname "$0")"

[ -f .env ] || cp .env.example .env
STAMP="$(date +%Y%m%d-%H%M%S)"
cp .env ".env.backup.${STAMP}"
mkdir -p data/omniroute data/firbo
if [ -n "$(ls -A data/omniroute 2>/dev/null)" ]; then
  tar -czf "data-omniroute-backup-${STAMP}.tgz" data/omniroute 2>/dev/null && echo "==> Backed up the gateway data to data-omniroute-backup-${STAMP}.tgz"
fi

hex()  { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
pass() { head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16; }
get()  { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d ' '; }
setv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
ensure() { [ -n "$(get "$1")" ] || { setv "$1" "$2"; echo "   set $1"; }; }

echo "==> Checking .env (only missing values are filled in)"
ensure API_DOMAIN api.firboai.app
ensure GATEWAY_DOMAIN gateway.firboai.app
ensure FRONTEND_ORIGINS https://firboai.app
ensure SUPABASE_URL https://bfeinnsorgjycivozcau.supabase.co
ensure SUPABASE_PUBLISHABLE_KEY sb_publishable_tKMs6ANU1ywiwomvd-7wUg_hln8qSeu
ensure OPENJARVIS_API_KEY "$(hex)"
ensure JWT_SECRET "$(hex)"
ensure API_KEY_SECRET "$(hex)"
# Fixed once, never regenerated: it encrypts the provider keys stored in the gateway. If it changed, saved keys stop working.
ensure STORAGE_ENCRYPTION_KEY "$(hex)"
ensure MACHINE_ID_SALT "$(hex)"
ensure AUTH_COOKIE_SECURE true
P="$(get INITIAL_PASSWORD)"
NEWPASS=""
if [ -z "$P" ] || [ "$P" = "CHANGEME" ]; then NEWPASS="$(pass)"; setv INITIAL_PASSWORD "$NEWPASS"; echo "   set INITIAL_PASSWORD"; fi

if [ "${1:-}" = "--fresh" ]; then
  mv data/omniroute "data/omniroute.old-${STAMP}" && mkdir -p data/omniroute
  echo "==> Gateway data moved aside (kept in data/omniroute.old-${STAMP}); it will start clean with the new password"
fi

cp -n .env ".env.keep-${STAMP}" 2>/dev/null && chmod 600 ".env.keep-${STAMP}" && echo "==> Saved a copy of .env (.env.keep-${STAMP}); keep it: it holds the key that protects your provider keys"
# The gateway container runs as the unprivileged "node" user. If the data folder belongs to root it cannot save anything
# (EACCES), so every provider and key you add vanishes on the next restart. Give the folder to that user.
mkdir -p data/omniroute
NODE_UID="$(docker compose run --rm --no-deps --entrypoint id omniroute -u 2>/dev/null | tr -d '\r\n' || true)"
case "$NODE_UID" in ''|*[!0-9]*) NODE_UID=1000 ;; esac
chown -R "$NODE_UID:$NODE_UID" data/omniroute && echo "==> Gateway data folder now belongs to uid $NODE_UID (so it can save)"
echo "==> Restarting"
docker compose pull omniroute >/dev/null 2>&1 || true
docker compose up -d
sleep 25

echo
echo "================= HEALTH REPORT (safe to paste) ================="
docker compose ps --format 'table {{.Name}}\t{{.Status}}' 2>/dev/null || docker compose ps
echo
echo "-- settings present in .env (names only) --"
for k in STORAGE_ENCRYPTION_KEY MACHINE_ID_SALT API_DOMAIN GATEWAY_DOMAIN SUPABASE_URL SUPABASE_PUBLISHABLE_KEY OPENJARVIS_API_KEY JWT_SECRET API_KEY_SECRET INITIAL_PASSWORD OMNIROUTE_API_KEY OMNIROUTE_MANAGEMENT_KEY OMNIROUTE_IMAGE; do
  if [ -n "$(get "$k")" ]; then echo "  yes  $k"; else echo "  NO   $k"; fi
done
echo
echo "-- gateway: does it still run with auto-generated secrets (zero-config)? --"
if docker compose logs omniroute --tail 300 2>/dev/null | grep -qiE "auto-generat|zero-config|bootstrap"; then echo "  yes, see the lines below"; docker compose logs omniroute --tail 300 2>/dev/null | grep -iE "auto-generat|zero-config|bootstrap" | tail -3; else echo "  no, it uses the secrets from .env"; fi
echo
echo "-- can the gateway save its data? --"
if docker compose exec -T omniroute sh -c 'touch /app/data/.write-test && rm /app/data/.write-test' >/dev/null 2>&1; then echo "  yes"; else echo "  NO - providers and keys will be lost on restart (see README: data folder permissions)"; fi
echo
echo "-- gateway data folder (should keep growing, never reset) --"
du -sh data/omniroute 2>/dev/null; ls -la data/omniroute 2>/dev/null | head -8
echo
echo "-- last gateway errors --"
docker compose logs omniroute --tail 400 2>/dev/null | grep -iE "error|fail|denied|unauthor" | tail -6 || true
echo
echo "-- api health --"
curl -s -m 8 -o /dev/null -w "  api health: HTTP %{http_code}\n" "http://localhost:8000/health" 2>/dev/null || echo "  (checked from outside only)"
echo "================================================================="
if [ -n "$NEWPASS" ]; then
  echo
  echo "NEW gateway password (write it down): ${NEWPASS}"
fi
echo "Open https://$(get GATEWAY_DOMAIN) and log in."
