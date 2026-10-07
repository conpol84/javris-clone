#!/bin/bash
set -euo pipefail

# Approved FIRBO source, shared Connector release 3fd0c86.
# Stop the old Connector with Ctrl+C before running this file.
# Existing pairing, local permissions and journal remain in place.
if [ "$(uname -s)" != Darwin ]; then
  echo 'Run this file on the paired Mac.' >&2
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
echo 'Each browser plan and sensitive action still asks for local approval.'
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
ae0744fdb28c19baaa0aa40232ab38f7b7c825ca3c3eaa8d37e33c70288c5381  firbo-connector.mjs
2166612cec8fa1cc9b8e45433623a09625c4058e884e9a0a23f5c530df1d37a3  firbo-browser.mjs
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
