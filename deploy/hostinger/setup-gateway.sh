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
gw = os.environ["GW"]
k_api, k_man = os.environ["INF"], os.environ["MAN"]
def call(method, path, key, body=None):
    req = urllib.request.Request(gw + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode()[:200]}
# Which key can manage the gateway? Test both (prints only status numbers, never the keys).
rows = {}
for name, key in (("OMNIROUTE_API_KEY", k_api), ("OMNIROUTE_MANAGEMENT_KEY", k_man)):
    rows[name] = (len(key), call("GET", "/api/combos", key)[0], call("GET", "/v1/models", key)[0])
    print(f"  {name}: length {rows[name][0]}, manage-check HTTP {rows[name][1]}, models HTTP {rows[name][2]}")
if k_api == k_man:
    print("  note: both settings hold the SAME key. Make a second key (firbo-manage) in the gateway and run ./set-gateway-keys.sh --show")
man_ok = [n for n, r in rows.items() if r[1] == 200]
if not man_ok:
    sys.exit("No saved key has manage access. In the gateway: API Keys -> create a key, turn ON Management Access, then run ./set-gateway-keys.sh --show (inference key first, manage key second).")
man = k_man if "OMNIROUTE_MANAGEMENT_KEY" in man_ok else k_api
inf = k_api if man == k_man else k_man
if man != k_man:
    open("/tmp/.firbo-swap", "w").write("1")
    print("The manage key was in the wrong slot; it will be moved to OMNIROUTE_MANAGEMENT_KEY.")
st, data = call("GET", "/v1/models", inf)
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
existing = {c["name"]: c.get("id") for c in cur.get("combos", [])}
for name, models, desc in (("firbo-economy", econ, "Firbo: free models first, cheap paid last"), ("firbo-quality", qual or econ, "Firbo: best model first")):
    if name in existing:
        call("DELETE", f"/api/combos/{existing[name]}", man)
    st, out = call("POST", "/api/combos", man, {"name": name, "description": desc, "models": models, "strategy": "priority"})
    print(f"{name}: {'created' if st in (200, 201) else 'FAILED ' + str(st) + ' ' + str(out)}  ({len(models)} models)")
PY
if [ -f /tmp/.firbo-swap ]; then
  rm -f /tmp/.firbo-swap
  setv() { if grep -qE "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi; }
  setv OMNIROUTE_API_KEY "$MAN"
  setv OMNIROUTE_MANAGEMENT_KEY "$INF"
  chmod 600 .env
  echo "Keys moved in .env. Restarting the API..."
  docker compose up -d firbo-api >/dev/null 2>&1 || true
fi
