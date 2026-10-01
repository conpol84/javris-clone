#!/usr/bin/env bash
# One-shot prepare for a fresh Ubuntu/Debian VPS: Docker, firewall, secrets.
# Usage:  git clone <repo> && cd <repo>/deploy/hostinger && sudo ./setup.sh
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

if command -v ufw >/dev/null 2>&1; then
  echo "==> Firewall: allow SSH, HTTP, HTTPS only"
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  ufw --force enable >/dev/null
fi

cd "$(dirname "$0")"
if [ ! -f .env ]; then
  cp .env.example .env
  rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | cut -c1-48; }
  sed -i "s|^OPENJARVIS_API_KEY=.*|OPENJARVIS_API_KEY=$(rand)|" .env
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(rand)|" .env
  sed -i "s|^API_KEY_SECRET=.*|API_KEY_SECRET=$(rand)|" .env
  echo "==> Created .env with fresh secrets."
fi
mkdir -p data/omniroute data/firbo
# the API container runs as uid 10001
chown -R 10001:10001 data/firbo || true
echo
echo "Next: edit .env (SUPABASE_PUBLISHABLE_KEY, INITIAL_PASSWORD, domains), then:"
echo "  docker compose up -d --build"
