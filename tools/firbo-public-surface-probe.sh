#!/usr/bin/env bash
# Public unauthenticated FIRBO endpoints only. No secrets, no response bodies.
set -euo pipefail

check() {
  local label="$1" address="$2" host="$3" output result=0
  echo "::group::$label"
  if getent ahostsv4 "$host" >/dev/null; then echo 'DNS=RESOLVED'; else echo 'DNS=UNRESOLVED'; fi
  output="$(curl --silent --show-error --max-time 15 --connect-timeout 7 --request GET \
    --output /dev/null --dump-header /tmp/firbo-probe-headers \
    --write-out 'http=%{http_code} tls_verification=%{ssl_verify_result} type=%{content_type} total_seconds=%{time_total}' \
    "$address" 2>&1)" || result=$?
  echo "curl_exit=$result $output"
  if [[ $result -eq 0 ]]; then
    # No cookies, auth headers, Location query strings, or HTML are printed.
    grep -iE '^(www-authenticate|server):' /tmp/firbo-probe-headers | head -4 || true
  fi
  echo "::endgroup::"
}
check 'OpenJarvis dedicated VPS dashboard' 'https://jarvis.firboai.app/' 'jarvis.firboai.app'
check 'OpenJarvis login form' 'https://jarvis.firboai.app/_firbo/login' 'jarvis.firboai.app'
check 'OpenJarvis anonymous API protection' 'https://jarvis.firboai.app/v1/info' 'jarvis.firboai.app'
check 'FIRBO native API health' 'https://api.firboai.app/health' 'api.firboai.app'
check 'Native Jarvis model info on API root (anonymous)' 'https://api.firboai.app/v1/info' 'api.firboai.app'
check 'Native Jarvis model info on API subroute (anonymous)' 'https://api.firboai.app/jarvis/v1/info' 'api.firboai.app'
check 'FIRBO Vercel-proxied backend health' 'https://firboai.app/firbo-backend-health' 'firboai.app'
check 'FIRBO customer frontend' 'https://javris.firboai.app/' 'javris.firboai.app'
