#!/usr/bin/env bash
# Finishes the server setup interactively: asks for the gateway password, fills .env, starts everything.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "Run ./setup.sh first."; exit 1; }

KEY="sb_publishable_tKMs6ANU1ywiwomvd-7wUg_hln8qSeu"   # public by design (same key the web app ships)
sed -i "s|^SUPABASE_PUBLISHABLE_KEY=.*|SUPABASE_PUBLISHABLE_KEY=${KEY}|" .env

while true; do
  read -r -s -p "Choose a password for the gateway dashboard (letters and numbers only, 12+ chars): " P; echo
  if [[ "$P" =~ ^[A-Za-z0-9]{12,}$ ]]; then break; fi
  echo "Please use only letters and numbers, at least 12 characters."
done
sed -i "s|^INITIAL_PASSWORD=.*|INITIAL_PASSWORD=${P}|" .env
unset P

echo "==> Starting the stack (first build takes 5-10 minutes)"
docker compose up -d --build
echo
docker compose ps
echo
echo "Done. Open https://gateway.firboai.app and log in with the password you just chose."
