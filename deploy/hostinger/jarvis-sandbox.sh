#!/usr/bin/env bash
# Second OpenJarvis instance for customers ("box"), next to the admin one (port 8765).
# - Port 8766, its own home (/home/jarvis/.openjarvis-box): no shared memory, sessions or files with the admin instance.
# - Only safe tools: Python runs in a throw-away Docker container (no network, 512 MB, 1 CPU, read-only, removed after each run).
# - No shell, no file or git tools, no memory injection.
# Run once as root. On the server, fetch it without changing the rest of the checkout:
#   cd ~/javris-clone && git fetch origin claude/gifted-dijkstra-rph5j8 && git show FETCH_HEAD:deploy/hostinger/jarvis-sandbox.sh > ~/jarvis-sandbox.sh && bash ~/jarvis-sandbox.sh
# It prints the new key to put in Supabase as OPENJARVIS_SANDBOX_API_KEY (never paste it in a chat).
set -euo pipefail

ADMIN_HOME=/home/jarvis/.openjarvis
BOX_HOME=/home/jarvis/.openjarvis-box
CADDYFILE=/root/javris-clone/deploy/hostinger/Caddyfile

[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
systemctl cat openjarvis >/dev/null 2>&1 || { echo "The admin service 'openjarvis' was not found"; exit 1; }
[ -f "$ADMIN_HOME/config.toml" ] || { echo "Missing $ADMIN_HOME/config.toml"; exit 1; }

PY=$(systemctl cat openjarvis | sed -n 's/^ExecStart=\([^ ]*\)jarvis .*/\1python/p' | head -1)
[ -x "$PY" ] || PY="$ADMIN_HOME/.venv/bin/python"
[ -x "$PY" ] || { echo "Could not find the OpenJarvis python ($PY)"; exit 1; }
echo "1/6 Docker SDK in the OpenJarvis environment"
"$PY" -m pip install -q 'docker>=7' 2>/dev/null || uv pip install -q --python "$PY" 'docker>=7'

echo "2/6 Sandbox image and Docker access"
docker pull -q python:3.12-slim >/dev/null
usermod -aG docker jarvis

echo "3/6 Config for the customer instance (only sandboxed tools, no memory)"
install -d -o jarvis -g jarvis -m 700 "$BOX_HOME"
"$PY" - "$ADMIN_HOME/config.toml" "$BOX_HOME/config.toml" <<'PYEOF'
import sys, tomllib
src, dst = sys.argv[1], sys.argv[2]
cfg = tomllib.load(open(src, 'rb'))
box = {k: cfg[k] for k in ('engine', 'intelligence') if k in cfg}
box['agent'] = {'default_agent': 'orchestrator', 'max_turns': 8, 'context_from_memory': False}
box['tools'] = {'enabled': ['code_interpreter_docker', 'calculator', 'think']}
box['server'] = {'agent': 'orchestrator'}
box['sandbox'] = {'enabled': True, 'runtime': 'docker', 'timeout': 60, 'max_concurrent': 4}
box['security'] = {'enabled': True, 'ssrf_protection': True, 'rate_limit_enabled': True, 'rate_limit_rpm': 60}
def val(v):
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (int, float)): return str(v)
    if isinstance(v, list): return '[' + ', '.join(val(x) for x in v) + ']'
    return '"' + str(v).replace('\\', '\\\\').replace('"', '\\"') + '"'
out = []
def emit(prefix, table):
    scalars = {k: v for k, v in table.items() if not isinstance(v, dict)}
    if scalars:
        out.append(f'[{prefix}]')
        out.extend(f'{k} = {val(v)}' for k, v in scalars.items())
        out.append('')
    for k, v in table.items():
        if isinstance(v, dict): emit(f'{prefix}.{k}', v)
for name, table in box.items(): emit(name, table)
open(dst, 'w').write('\n'.join(out))
PYEOF
KEY=$(openssl rand -hex 24)
VLLM=$(grep -h '^VLLM_API_KEY=' "$ADMIN_HOME/serve.env" 2>/dev/null | tail -1 || true)
umask 077
{ echo "OPENJARVIS_API_KEY=$KEY"; [ -n "$VLLM" ] && echo "$VLLM"; echo "OPENJARVIS_HOME=$BOX_HOME"; } > "$BOX_HOME/serve.env"
chown -R jarvis:jarvis "$BOX_HOME"

echo "4/6 Service openjarvis-box (port 8766)"
EXEC=$(systemctl cat openjarvis | sed -n 's/^ExecStart=//p' | head -1 | sed 's/--port[= ]*8765/--port 8766/')
echo "$EXEC" | grep -q 8766 || EXEC="$EXEC --port 8766"
cat > /etc/systemd/system/openjarvis-box.service <<UNIT
[Unit]
Description=OpenJarvis customer sandbox instance (Firbo)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=jarvis
Group=jarvis
SupplementaryGroups=docker
EnvironmentFile=$BOX_HOME/serve.env
Environment=OPENJARVIS_CONFIG=$BOX_HOME/config.toml
Environment=HOME=$BOX_HOME
Environment=XDG_CACHE_HOME=$BOX_HOME/.cache
WorkingDirectory=$BOX_HOME
ExecStart=$EXEC
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=$BOX_HOME
MemoryMax=1500M

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now openjarvis-box
ufw allow from 172.16.0.0/12 to any port 8766 proto tcp >/dev/null

echo "5/6 Route https://api.<domain>/jarvis-box/ in Caddy"
if ! grep -q 'handle_path /jarvis-box/\*' "$CADDYFILE"; then
  # Put the route before the /jarvis/ block when there is one, else before the API's catch-all line.
  if "$PY" - "$CADDYFILE" <<'PYEOF'
import sys
p = sys.argv[1]
s = open(p).read()
block = '\thandle_path /jarvis-box/* {\n\t\treverse_proxy 172.17.0.1:8766\n\t}\n'
for anchor in ('\thandle_path /jarvis/* {', '\treverse_proxy firbo-api:8000'):
    if anchor in s:
        open(p, 'w').write(s.replace(anchor, block + anchor, 1))
        sys.exit(0)
sys.exit(1)
PYEOF
  then
    docker restart firbo-caddy >/dev/null
  else
    echo "   Could not find where to add the route in $CADDYFILE."
    echo "   Add these 3 lines inside the api.<domain> block, then run: docker restart firbo-caddy"
    printf '\thandle_path /jarvis-box/* {\n\t\treverse_proxy 172.17.0.1:8766\n\t}\n'
  fi
fi

echo "6/6 Check"
for i in $(seq 1 30); do curl -fsS http://127.0.0.1:8766/health >/dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:8766/health && echo
curl -fsS -H "Authorization: Bearer $KEY" http://127.0.0.1:8766/v1/info && echo
echo
echo "================================================================"
echo "Put these two in Supabase -> Edge Functions -> Secrets:"
echo "  OPENJARVIS_SANDBOX_URL     = https://api.firboai.app/jarvis-box"
echo "  OPENJARVIS_SANDBOX_API_KEY = $KEY"
echo "Do not send the key in a chat."
echo "================================================================"
