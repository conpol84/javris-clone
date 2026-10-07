#!/usr/bin/env bash
# Hidden input, scope verification, atomic backup/write and verified API restart.
# Does not change provider connections, model routes or combos.
set -euo pipefail
if [ "$#" -ne 0 ]; then
  echo "Usage: ./set-gateway-keys.sh (keys are entered privately; --show is unsupported)" >&2
  exit 2
fi
exec python3 "$(dirname "$0")/gateway-credentials.py" set-gateway-keys
