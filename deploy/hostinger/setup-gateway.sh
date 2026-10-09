#!/usr/bin/env bash
# Creates the two Firbo cost-level combos in the gateway from what is connected right now:
#   firbo-economy  free models first, a cheap paid model last (so work never stops)
#   firbo-quality  the best paid model first, free ones as a safety net
# Explicit routing setup: it replaces the two combos. Not a credential recovery step.
# Prints no secrets. Refuses shared/unverified management and inference keys.
#   cd ~/javris-clone/deploy/hostinger && ./setup-gateway.sh
set -euo pipefail
cd "$(dirname "$0")"
python3 ./gateway-credentials.py check-gateway-keys --require-directory "$PWD"
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d ' '; }
GW="https://$(get GATEWAY_DOMAIN)"
INF="$(get OMNIROUTE_API_KEY)"
MAN="$(get OMNIROUTE_MANAGEMENT_KEY)"
[ -n "$INF" ] && [ -n "$MAN" ] || { echo "OMNIROUTE_API_KEY / OMNIROUTE_MANAGEMENT_KEY missing in .env"; exit 1; }
PYRC=0
GW="$GW" INF="$INF" MAN="$MAN" python3 - <<'PY' || PYRC=$?
import json, os, re, sys, urllib.request, urllib.error
gw = os.environ["GW"]
k_api, k_man = os.environ["INF"], os.environ["MAN"]
def call(method, path, key, body=None):
    req = urllib.request.Request(gw + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": "http_error"}
    except Exception:
        return 0, {"error": "gateway_unreachable"}
if not k_api or not k_man or k_api == k_man:
    sys.exit("Distinct inference-only and management keys are required; no settings changed.")
man, inf = k_man, k_api
if call("GET", "/api/combos", man)[0] != 200:
    sys.exit("Management key is not accepted; no settings changed.")
if call("GET", "/api/combos", inf)[0] not in (401, 403):
    sys.exit("Inference key management scope cannot be safely excluded; no settings changed.")
st, data = call("GET", "/v1/models", inf)
if st != 200:
    sys.exit("Inference key is not accepted; no settings changed.")
ids = [m["id"] for m in data.get("data", []) if isinstance(m.get("id"), str) and not m["id"].startswith("firbo-")]
free = [i for i in ids if re.match(r"(aihorde|cfp|opencode|uncloseai|duckduckgo)", i)]
paid_pref = ["openai/gpt-5.5", "openai/gpt-5", "openai/gpt-4.1", "openai/gpt-4o"]
openai = [i for i in ids if i.startswith("openai/")]
best = next((p for p in paid_pref if p in ids), openai[0] if openai else None)
cheap = next((i for i in openai if re.search(r"mini|nano", i)), best)
print(f"models seen: {len(ids)}   free: {len(free)}   best paid: {best}   cheap paid: {cheap}")
if not best:
    print("note: no paid provider is connected yet (OpenAI?). firbo-quality will use free models until you connect one, then run this script again.")
econ = free[:6] + ([cheap] if cheap else [])
qual = ([best] if best else []) + free[:3]
if not econ:
    sys.exit("No usable models yet: in the gateway open Providers, connect OpenAI (key + Test) and/or a free provider, then run this script again.")
st, cur = call("GET", "/api/combos", man)
if st != 200:
    sys.exit("Could not read existing combos; no routing changes made.")
existing = {c["name"]: c.get("id") for c in cur.get("combos", [])}
failed = False
for name, models, desc in (("firbo-economy", econ, "Firbo: free models first, cheap paid last"), ("firbo-quality", qual or econ, "Firbo: best model first")):
    if name in existing:
        deleted, _ = call("DELETE", f"/api/combos/{existing[name]}", man)
        if deleted not in (200, 204):
            print(f"{name}: FAILED deleting existing combo, HTTP {deleted}")
            failed = True
            continue
    st, out = call("POST", "/api/combos", man, {"name": name, "description": desc, "models": models, "strategy": "priority"})
    print(f"{name}: {'created' if st in (200, 201) else 'FAILED HTTP ' + str(st)}  ({len(models)} models)")
    failed = failed or st not in (200, 201)
if failed:
    sys.exit("Some routing changes failed; inspect the two combos before retrying.")
PY
exit "${PYRC:-0}"
