"""Disposable CI only: actual Docker build/canary/cutover/manual+automatic rollback.

The upstream gateway and identity are synthetic. No live server, model request,
provider credentials, Vercel or Supabase project is contacted. Native source is
copied byte-for-byte from this checkout, with installer hashes verified.
"""

import contextlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[2]
if (
    os.environ.get("GITHUB_ACTIONS") != "true"
    or os.environ.get("GITHUB_REPOSITORY") != "conpol84/javris-clone"
):
    raise SystemExit("This test is restricted to the disposable GitHub Actions runner.")
if os.geteuid() != 0:
    raise SystemExit("Run this disposable fixture via sudo.")
if subprocess.check_output(["docker", "ps", "-aq"]).strip():
    raise SystemExit(
        "Refusing to touch a Docker daemon that already contains containers."
    )
spec = importlib.util.spec_from_file_location(
    "rollout", HERE / "deploy/hostinger/native_control_rollout.py"
)
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
root = Path(tempfile.mkdtemp(prefix="firbo-local-ci-", dir="/tmp"))
root.chmod(0o700)
stack = root / "stack"
stack.mkdir()
(stack / "data").mkdir()
r.ROOT = root / "releases"
image = "firbo-native-ci-original:local"
project = "firbo_native_ci"

files = {
    "Dockerfile": """FROM python:3.12-slim-bookworm
COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt uvicorn==0.38.0
ENV PYTHONPATH=/app/src HOME=/home/openjarvis
COPY src /app/src
COPY gateway.py /fixture/gateway.py
WORKDIR /app
USER 10001:10001
ENTRYPOINT ["python","-m","uvicorn"]
CMD ["openjarvis.server.firbo_app:app","--host","0.0.0.0","--port","8000"]
""",
    "src/openjarvis/__init__.py": "",
    "src/openjarvis/server/__init__.py": "",
    "src/openjarvis/server/firbo_app.py": """from fastapi import FastAPI
app=FastAPI()
@app.get('/health')
def health():return {'status':'ok'}
""",
    "src/openjarvis/server/gateway_routes.py": """from fastapi import APIRouter
router=APIRouter(prefix='/v1/gateway')
@router.get('/overview')
def overview():return {'synthetic':True}
""",
    "gateway.py": """import json
from http.server import HTTPServer,BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
 def do_GET(self):
  routes={'/api/health':{'status':'ok'},'/api/providers':{'connections':[{'id':'fixture-provider','provider':'synthetic','name':'Synthetic','isActive':True}]},'/v1/models':{'data':[{'id':'synthetic/no-inference','owned_by':'synthetic'}]},'/api/combos':{'combos':[]}}
  if self.headers.get('Authorization')!='Bearer fixture-management-only' or self.path not in routes:
   self.send_response(403);self.end_headers();return
  body=json.dumps(routes[self.path]).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
 def log_message(self,*args):pass
HTTPServer(('0.0.0.0',20128),H).serve_forever()
""",
    ".env": """SUPABASE_URL=https://bfeinnsorgjycivozcau.supabase.co
SUPABASE_PUBLISHABLE_KEY=fixture-public-not-used
OMNIROUTE_HOST=http://omniroute:20128
OMNIROUTE_MANAGEMENT_KEY=fixture-management-only
OMNIROUTE_API_KEY=fixture-inference-not-used
OPENJARVIS_CORS_ORIGINS=https://firboai.app
""",
    "compose.yml": f"""services:
  firbo-api:
    image: {image}
    build: .
    container_name: firbo-api
    entrypoint: ["python","-m","uvicorn"]
    command: ["openjarvis.server.firbo_app:app","--host","0.0.0.0","--port","8000"]
    environment:
      SUPABASE_URL: ${{SUPABASE_URL}}
      SUPABASE_PUBLISHABLE_KEY: ${{SUPABASE_PUBLISHABLE_KEY}}
      OMNIROUTE_HOST: ${{OMNIROUTE_HOST}}
      OMNIROUTE_MANAGEMENT_KEY: ${{OMNIROUTE_MANAGEMENT_KEY}}
      OMNIROUTE_API_KEY: ${{OMNIROUTE_API_KEY}}
      OPENJARVIS_CORS_ORIGINS: ${{OPENJARVIS_CORS_ORIGINS}}
    volumes: ["./data:/home/openjarvis"]
  omniroute:
    image: {image}
    container_name: firbo-omniroute
    entrypoint: ["python"]
    command: ["/fixture/gateway.py"]
  caddy:
    image: {image}
    container_name: firbo-caddy
    entrypoint: ["python"]
    command: ["-c","import time;time.sleep(3600)"]
  redis:
    image: {image}
    container_name: firbo-redis
    entrypoint: ["python"]
    command: ["-c","import time;time.sleep(3600)"]
""",
}
for name, data in files.items():
    p = stack / name
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(data)
(stack / ".env").chmod(0o600)
shutil.copyfile(HERE / "tests/firbo/requirements.txt", stack / "requirements.txt")


# The production native API modules must remain byte-identical through the rollout.
for module in ["firbo_app.py", "firbo_control.py"]:
    shutil.copyfile(
        HERE / "src/openjarvis/server" / module,
        stack / "src/openjarvis/server" / module,
    )
spec2 = importlib.util.spec_from_file_location(
    "local_rollout", HERE / "deploy/hostinger/local_model_rollout.py"
)
rollout = importlib.util.module_from_spec(spec2)
spec2.loader.exec_module(rollout)
rollout.ROOT = root / "local-releases"
rollout.load_native = lambda: r
rollout.check_resources = lambda: {
    "scope": "CI test bypasses hostname/capacity gate only; not user-VPS capacity",
    "logical_cpus": os.cpu_count(),
}


def local_source(ref, path, expected):
    raw = (HERE / path).read_bytes()
    assert rollout.sha(raw) == expected
    return raw


rollout.download = local_source


def remote(path):
    code = (
        """import urllib.request,urllib.error,json
try:r=urllib.request.urlopen('http://firbo-api:8000'+%r,timeout=2)
except urllib.error.HTTPError as e:r=e
with r:print(json.dumps({'code':r.code,'body':json.loads(r.read(10000))}))
"""
        % path
    )
    return json.loads(r.docker("exec", "firbo-caddy", "python", "-c", code, timeout=6))


def native_ok(native=False):
    try:
        h = remote("/health")
        return h == {
            "code": 200,
            "body": {"status": "ok", "contract": "firbo-control/v1"},
        }
    except Exception:
        return False


r.public_probe = native_ok


def new_ready(_):
    try:
        return native_ok(True) and remote("/v1/firbo/free/status") == {
            "code": 401,
            "body": {"detail": "sign_in_required"},
        }
    except Exception:
        return False


rollout.public_ready = new_ready
records = []


def invoke(argv):
    sys.argv = argv
    capture = io.StringIO()
    with contextlib.redirect_stdout(capture):
        code = rollout.main()
    report = json.loads(capture.getvalue())
    records.append(report)
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return code, report


try:
    r.docker("build", "-t", image, str(stack), timeout=240)
    r.docker(
        *r.compose_args(project, [stack / "compose.yml"]),
        "up",
        "-d",
        "--no-build",
        "--pull",
        "never",
        cwd=stack,
        timeout=60,
    )
    for _ in range(20):
        if native_ok():
            break
        time.sleep(1)
    else:
        raise AssertionError("Native fixture failed to boot")
    original = {n: r.identity(r.inspect(n)) for n in r.NAMES}
    code, report = invoke(
        ["local_model_rollout.py", "--source-ref", "a" * 40, "--apply"]
    )
    assert code == 0 and report["status"] == "local_model_deployed_admin_pilot", report
    assert report["model_smoke"]["all_matched"] is True
    assert new_ready(None)
    assert all(r.identity(r.inspect(n)) == original[n] for n in r.NAMES[1:])
    model_id = r.inspect("firbo-ollama")["Id"]
    api_id = r.inspect("firbo-api")["Id"]
    default = json.loads(
        r.docker("compose", "-p", project, "config", "--format", "json", cwd=stack)
    )
    assert (
        default["services"]["firbo-api"]["command"][0]
        == "openjarvis.server.firbo_free_app:app"
    )
    assert (
        default["services"]["firbo-api"]["environment"]["FIRBO_FREE_ADMIN_PILOT"]
        == "true"
    )
    assert (
        default["services"]["firbo-api"]["environment"]["FIRBO_FREE_ORGANIZATIONS"]
        == ""
    )
    assert (
        default["services"]["firbo-api"]["environment"]["FIRBO_FREE_OPENROUTER_MODELS"]
        == ""
    )
    # Test actual writable private SQLite as the real unprivileged API container user.
    sqlite_probe = "from openjarvis.server.firbo_free_app import engine; e=engine(); print(e.ledger.limits.global_parallel)"
    assert r.docker("exec", "firbo-api", "python", "-c", sqlite_probe).strip() == "1"
    # Native source was NOT replaced, only wrapper/new router modules were added.
    for module in ["firbo_app.py", "firbo_control.py"]:
        expected = rollout.sha((HERE / "src/openjarvis/server" / module).read_bytes())
        check = (
            "import hashlib,importlib.util;print(hashlib.sha256(open(importlib.util.find_spec('openjarvis.server.%s').origin,'rb').read()).hexdigest())"
            % module[:-3]
        )
        assert r.docker("exec", "firbo-api", "python", "-c", check).strip() == expected
    code, repeated = invoke(
        ["local_model_rollout.py", "--source-ref", "a" * 40, "--apply"]
    )
    assert code == 0 and repeated["status"] == "local_model_already_installed", repeated
    assert (
        r.inspect("firbo-api")["Id"] == api_id
        and r.inspect("firbo-ollama")["Id"] == model_id
    )
    code, rolled = invoke(
        ["local_model_rollout.py", "--rollback", report["release_directory"]]
    )
    assert code == 0 and rolled["rollback_verified"], rolled
    assert native_ok() and not new_ready(None)
    assert r.inspect("firbo-api")["Image"] == original["firbo-api"]["Image"]
    assert (stack / ".env").read_text() == files[".env"]
    # Force failure AFTER real model inference and actual API replacement.
    rollout.public_ready = lambda _: False
    code, failed = invoke(
        ["local_model_rollout.py", "--source-ref", "a" * 40, "--apply"]
    )
    assert code == 1 and failed.get("rollback_verified") is True, failed
    assert not failed.get("manual_recovery_required")
    assert (
        r.inspect("firbo-api")["Image"] == original["firbo-api"]["Image"]
        and native_ok()
    )
    assert all(r.identity(r.inspect(n)) == original[n] for n in r.NAMES[1:])
    assert not r.docker("ps", "-aq", "--filter", "name=^/firbo-ollama$").strip()
    assert (stack / ".env").read_text() == files[".env"]
    print("FIRBO_ACTUAL_LOCAL_ROLLOUT_AND_BOTH_ROLLBACKS_PASSED")
finally:
    out = Path("/tmp/firbo-local-evidence")
    out.mkdir(exist_ok=True)
    (out / "docker-results.json").write_text(
        json.dumps(
            {
                "scope": "ACTUAL Ollama/Qwen and Docker lifecycle; synthetic identity/gateway/native network probe, not customer VPS or public TLS",
                "records": records,
            },
            ensure_ascii=False,
            indent=2,
        )
    )
    # This is an empty, dedicated CI daemon; cleanup only names created by the test.
    for name in r.docker("ps", "-a", "--format", "{{.Names}}").splitlines():
        if (
            name.startswith(("firbo-model-", "firbo-local-canary-"))
            or name == "firbo-ollama"
        ):
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)
    subprocess.run(
        [
            "docker",
            *r.compose_args(project, [stack / "compose.yml"]),
            "down",
            "--remove-orphans",
        ],
        cwd=stack,
        capture_output=True,
    )
