#!/usr/bin/env bash
# Creates the two Firbo cost-level combos in the gateway from what is connected right now:
#   firbo-economy  free models first, a cheap paid model last (so work never stops)
#   firbo-quality  the best paid model first, free ones as a safety net
# Safe to run again any time (it replaces the two combos). Prints no secrets.
#   cd ~/javris-clone/deploy/hostinger && ./setup-gateway.sh
set -euo pipefail
cd "$(dirname "$0")"
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d ' '; }
GW="https://$(get GATEWAY_DOMAIN)"
INF="$(get OMNIROUTE_API_KEY)"
MAN="$(get OMNIROUTE_MANAGEMENT_KEY)"
[ -n "$INF" ] && [ -n "$MAN" ] || { echo "OMNIROUTE_API_KEY / OMNIROUTE_MANAGEMENT_KEY missing in .env (see README step: create the two gateway keys)"; exit 1; }
GW="$GW" INF="$INF" MAN="$MAN" python3 - <<'PY'
import json, os, re, sys, urllib.request, urllib.error
gw, inf, man = os.environ["GW"], os.environ["INF"], os.environ["MAN"]
def call(method, path, key, body=None):
    req = urllib.request.Request(gw + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:200]}
st, data = call("GET", "/v1/models", inf)
if st != 200:
    sys.exit(f"Could not list models ({st}). Is the inference key right? {data}")
ids = [m["id"] for m in data.get("data", []) if isinstance(m.get("id"), str) and not m["id"].startswith("firbo-")]
free = [i for i in ids if re.match(r"(aihorde|cfp|opencode|uncloseai|duckduckgo)", i)]
paid_pref = ["openai/gpt-5.5", "openai/gpt-5", "openai/gpt-4.1", "openai/gpt-4o"]
openai = [i for i in ids if i.startswith("openai/")]
best = next((p for p in paid_pref if p in ids), openai[0] if openai else None)
cheap = next((i for i in openai if re.search(r"mini|nano", i)), best)
print(f"free models found: {len(free)}   best paid: {best}   cheap paid: {cheap}")
if not best:
    print("note: no paid provider is connected yet (OpenAI?). firbo-quality will use free models until you connect one, then run this script again.")
econ = free[:6] + ([cheap] if cheap else [])
qual = ([best] if best else []) + free[:3]
if not econ:
    sys.exit("No usable models yet: connect at least one provider in the gateway first.")
st, cur = call("GET", "/api/combos", man)
if st in (401, 403):
    sys.exit("The management key was rejected. In the gateway: API Keys -> open firbo-manage -> turn ON the scope \"manage\" -> Save. Then run ./set-gateway-keys.sh --show again only if you made a new key, and ./setup-gateway.sh.")
existing = {c["name"]: c.get("id") for c in cur.get("combos", [])} if st == 200 else {}
for name, models, desc in (("firbo-economy", econ, "Firbo: free models first, cheap paid last"), ("firbo-quality", qual or econ, "Firbo: best model first")):
    if name in existing:
        call("DELETE", f"/api/combos/{existing[name]}", man)
    st, out = call("POST", "/api/combos", man, {"name": name, "description": desc, "models": models, "strategy": "priority"})
    print(f"{name}: {'created' if st in (200, 201) else 'FAILED ' + str(st) + ' ' + str(out)}  ({len(models)} models)")
PY
