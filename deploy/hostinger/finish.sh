#!/usr/bin/env bash
# Finishes the server setup with no typing: generates the gateway password, fills .env, starts everything.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Run ./setup.sh first."; exit 1; }

KEY="sb_publishable_tKMs6ANU1ywiwomvd-7wUg_hln8qSeu"   # public by design (same key the web app ships)
sed -i "s|^SUPABASE_PUBLISHABLE_KEY=.*|SUPABASE_PUBLISHABLE_KEY=${KEY}|" .env

# Keep an existing password (re-runs); otherwise generate a strong one.
P="$(grep '^INITIAL_PASSWORD=' .env | cut -d= -f2- | sed 's/#.*//' | tr -d ' ')"
if [ -z "$P" ]; then
  P="$(head -c 64 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | cut -c1-16)"
  sed -i "s|^INITIAL_PASSWORD=.*|INITIAL_PASSWORD=${P}|" .env
fi

echo "==> Starting the stack (first build takes 5-10 minutes)"
docker compose up -d --build
echo
docker compose ps
echo
echo "=============================================================="
echo " Done. Open https://gateway.firboai.app"
echo " Gateway password (write it down): ${P}"
echo "=============================================================="
