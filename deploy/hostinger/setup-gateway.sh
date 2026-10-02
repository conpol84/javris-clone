#!/usr/bin/env bash
# Creates the two Firbo cost-level combos in the gateway from what is connected right now:
#   firbo-economy  free models first, a cheap paid model last (so work never stops)
#   firbo-quality  the best paid model first, free ones as a safety net
# Safe to run again any time (it replaces the two combos). Prints no secrets.
#   cd ~/javris-clone/deploy/hostinger && ./setup-gateway.sh
set -euo pipefail
cd "$(dirname "$0")"
rm -f /tmp/.firbo-changed
get() { grep -E "^$1=" .env | head -1 | cut -d= -f2- | sed 's/[[:space:]]*#.*//' | tr -d ' '; }
GW="https://$(get GATEWAY_DOMAIN)"
INF="$(get OMNIROUTE_API_KEY)"
MAN="$(get OMNIROUTE_MANAGEMENT_KEY)"
[ -n "$INF" ] && [ -n "$MAN" ] || { echo "OMNIROUTE_API_KEY / OMNIROUTE_MANAGEMENT_KEY missing in .env"; exit 1; }
PYRC=0
GW="$GW" INF="$INF" MAN="$MAN" python3 - <<'PY' || PYRC=$?
import json, os, re, sys, time, urllib.request, urllib.error
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
    except Exception as e:
        return 0, {"error": str(e)[:200]}
def setenv(name, value):
    lines = open(".env").read().split("\n")
    hit = False
    for i, l in enumerate(lines):
        if l.startswith(name + "="):
            lines[i] = f"{name}={value}"; hit = True
    if not hit:
        lines.append(f"{name}={value}")
    open(".env", "w").write("\n".join(lines))
def check():
    return {n: (len(k), call("GET", "/api/combos", k)[0], call("GET", "/v1/models", k)[0]) for n, k in (("OMNIROUTE_API_KEY", k_api), ("OMNIROUTE_MANAGEMENT_KEY", k_man))}
# The gateway can need a few seconds right after a restart: look again before deciding a key is bad.
for attempt in range(3):
    rows = check()
    for n, r in rows.items():
        print(f"  {n}: length {r[0]}, manage-check HTTP {r[1]}, models HTTP {r[2]}")
    if any(r[1] == 200 for r in rows.values()):
        break
    if attempt < 2:
        print("  (no key accepted yet; the gateway may still be starting, trying again in 8 s)")
        time.sleep(8)
if k_api == k_man:
    print("  note: both settings hold the SAME key.")
man = next((k for k, n in ((k_man, "OMNIROUTE_MANAGEMENT_KEY"), (k_api, "OMNIROUTE_API_KEY")) if rows[n][1] == 200), None)
if man is None:
    sys.exit("No saved key has manage access. In the gateway: API Keys -> create a key, turn ON Management Access, copy it, then edit .env (nano .env) and put it on BOTH lines OMNIROUTE_API_KEY= and OMNIROUTE_MANAGEMENT_KEY=.")
# Inference key: a different valid key if there is one, otherwise the manage key does both jobs.
inf = next((k for k, n in ((k_api, "OMNIROUTE_API_KEY"), (k_man, "OMNIROUTE_MANAGEMENT_KEY")) if k != man and rows[n][2] == 200), man)
if (inf, man) != (k_api, k_man):
    setenv("OMNIROUTE_API_KEY", inf)
    setenv("OMNIROUTE_MANAGEMENT_KEY", man)
    open("/tmp/.firbo-changed", "w").write("1")
    print("Fixed .env: the working manage key is now in OMNIROUTE_MANAGEMENT_KEY" + (" and also used for inference (the other key was not accepted)." if inf == man else "."))
st, data = call("GET", "/v1/models", inf)
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
existing = {c["name"]: c.get("id") for c in cur.get("combos", [])}
for name, models, desc in (("firbo-economy", econ, "Firbo: free models first, cheap paid last"), ("firbo-quality", qual or econ, "Firbo: best model first")):
    if name in existing:
        call("DELETE", f"/api/combos/{existing[name]}", man)
    st, out = call("POST", "/api/combos", man, {"name": name, "description": desc, "models": models, "strategy": "priority"})
    print(f"{name}: {'created' if st in (200, 201) else 'FAILED ' + str(st) + ' ' + str(out)}  ({len(models)} models)")
PY
if [ -f /tmp/.firbo-changed ]; then
  rm -f /tmp/.firbo-changed
  chmod 600 .env
  echo "Restarting the API so it uses the corrected keys..."
  docker compose up -d --force-recreate firbo-api >/dev/null 2>&1 || true
fi
exit "${PYRC:-0}"
