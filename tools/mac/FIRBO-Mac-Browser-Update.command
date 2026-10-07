#!/bin/bash
set -euo pipefail

# Approved FIRBO source, shared Connector release 3fd0c86.
# Stop the old Connector with Ctrl+C before running this file.
# Existing pairing, local permissions and journal remain in place.
if [ "$(uname -s)" != Darwin ]; then
  echo 'Run this file on the paired Mac.' >&2
  exit 1
fi
# Current Playwright supported macOS baseline; check before downloads or installs.
firbo_macos=$(sw_vers -productVersion 2>/dev/null) || {
  echo 'Cannot read macOS version. No FIRBO installation or permissions were changed.' >&2
  exit 1
}
if [[ ! "$firbo_macos" =~ ^([0-9]{1,2})\.[0-9]{1,2}(\.[0-9]{1,2})?$ ]]; then
  echo 'Cannot validate macOS version. No FIRBO installation or permissions were changed.' >&2
  exit 1
fi
firbo_macos_major=$((10#${BASH_REMATCH[1]}))
if [ "$firbo_macos_major" -lt 14 ]; then
  echo "macOS $firbo_macos is outside the supported FIRBO browser baseline (macOS 14 Sonoma or newer)." >&2
  echo 'Existing pairing, Connector files and permissions were not changed.' >&2
  echo 'Check your Mac model before choosing an OS upgrade or another supported computer.' >&2
  exit 1
fi
command -v node >/dev/null || { echo 'Install Node.js LTS from https://nodejs.org first.' >&2; exit 1; }
node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22||(a===22&&b<13)){console.error("Node.js 22.13 or newer is required; install LTS from https://nodejs.org.");process.exit(1)}'
if [ ! -f "$HOME/.firbo-connector.json" ]; then
  echo 'Existing pairing was not found. No new pairing has been created.' >&2
  exit 1
fi

firbo_site="${1:-https://firboai.app}"
echo 'Stop the old Connector with Ctrl+C in its terminal first.'
echo "This run will allow browser tasks only for: $firbo_site"
echo 'Full Control runs the owner-approved browser plan without duplicate prompts; credentials, private networks and destructive/system actions stay blocked.'
read -r -p 'Continue with the existing pairing? [y/N] ' firbo_answer
case "$firbo_answer" in y|Y|yes|YES) ;; *) exit 0 ;; esac

firbo_stage=$(mktemp -d "${TMPDIR:-/tmp}/firbo-update.XXXXXX")
trap 'rm -rf "$firbo_stage"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://firboai.app/firbo-connector.mjs -o "$firbo_stage/firbo-connector.mjs"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  https://firboai.app/firbo-browser.mjs -o "$firbo_stage/firbo-browser.mjs"
(
  cd "$firbo_stage"
  shasum -a 256 -c <<'HASHES'
3f6fb470629750c2c003caa3a3a96eed8b414b1d82c0dbd81f48db29c28ee4ad  firbo-connector.mjs
d0c2a419dde6e3af2369279073390d84cbd29b0a321f3accaa623fa6ad47a083  firbo-browser.mjs
HASHES
)
node --check "$firbo_stage/firbo-connector.mjs"
node --check "$firbo_stage/firbo-browser.mjs"
npm install --prefix "$HOME/.firbo-browser-runtime" --save-exact --ignore-scripts playwright@1.63.0
node "$HOME/.firbo-browser-runtime/node_modules/playwright/cli.js" install chromium

mkdir -p "$HOME/Downloads"
firbo_backup="$HOME/Downloads/firbo-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$firbo_backup"
for firbo_file in firbo-connector.mjs firbo-browser.mjs; do
  if [ -f "$HOME/Downloads/$firbo_file" ]; then
    cp -p "$HOME/Downloads/$firbo_file" "$firbo_backup/$firbo_file"
  fi
  install -m 600 "$firbo_stage/$firbo_file" "$HOME/Downloads/$firbo_file"
done
echo "Previous files are kept in $firbo_backup"
read -r -p 'Enable FIRBO Full Control for apps, allowed files and reviewed browser work? [y/N] ' firbo_full
case "$firbo_full" in
  y|Y|yes|YES) node "$HOME/Downloads/firbo-connector.mjs" full-control ;;
  *) echo 'Full Control was not enabled. Existing local permissions remain.' ;;
esac
echo 'Starting the updated Connector. Keep this terminal open.'
echo 'Press Ctrl+C at any time to request Stop.'
node "$HOME/Downloads/firbo-connector.mjs" run --browser-site "$firbo_site" --browser-site "https://javris.firboai.app"
