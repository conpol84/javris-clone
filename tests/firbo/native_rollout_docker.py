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
root = Path(tempfile.mkdtemp(prefix="firbo-native-ci-", dir="/tmp"))
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


def download_local(dest):
    for name, expected in r.SOURCE_HASHES.items():
        data = (HERE / "src/openjarvis/server" / name).read_bytes()
        assert r.digest(data) == expected
        r.private_write(dest / name, data)


r.download_sources = download_local

# Test the actual Docker-network route from the untouched Caddy stand-in. This
# deliberately does not claim public TLS, real Caddy/Vercel or user-token acceptance.
read_script = r"""
import json,urllib.request,urllib.error
out={}
for path in ('/health','/v1/firbo/session'):
 try:x=urllib.request.urlopen('http://firbo-api:8000'+path,timeout=2)
 except urllib.error.HTTPError as e:x=e
 with x:out[path]={'code':x.code,'body':json.loads(x.read())}
print(json.dumps(out))
"""


def public_probe(native=False):
    try:
        data = json.loads(
            r.docker("exec", "firbo-caddy", "python", "-c", read_script, timeout=6)
        )
        if data["/health"]["code"] != 200:
            return False
        if not native:
            return data["/health"]["body"].get("status") == "ok"
        return (
            data["/health"]["body"].get("contract") == "firbo-control/v1"
            and data["/v1/firbo/session"]["code"] == 401
        )
    except (r.Blocked, ValueError, KeyError):
        return False


r.public_probe = public_probe
records = []
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
        if public_probe():
            break
        time.sleep(1)
    else:
        raise AssertionError("Original fixture failed to boot")
    orig = {n: r.identity(r.inspect(n)) for n in r.NAMES}
    # Real script: no bypass of its environment/path/config/identity checks.
    sys.argv = ["native_control_rollout.py", "--apply"]
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        code = r.main()
    report = json.loads(stdout.getvalue())
    records.append(report)
    assert code == 0 and report["status"] == "native_api_deployed_read_only", report
    assert (
        report["canary"]["boot_verified"]
        and report["canary"]["gateway_read"]["models"] == 1
    )
    assert public_probe(True)
    assert all(r.identity(r.inspect(n)) == orig[n] for n in r.NAMES[1:])
    # Ordinary default compose config must retain the new image after installation.
    default = json.loads(
        r.docker("compose", "-p", project, "config", "--format", "json", cwd=stack)
    )
    assert default["services"]["firbo-api"]["image"] == report["candidate_image_id"]
    assert "build" not in default["services"]["firbo-api"]
    # Repetition must be harmless and must not recreate the API.
    current = r.inspect("firbo-api")["Id"]
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        code = r.main()
    repeated = json.loads(stdout.getvalue())
    records.append(repeated)
    assert code == 0 and repeated["status"] == "native_api_already_present"
    assert r.inspect("firbo-api")["Id"] == current
    # Manual rollback: actual Docker recreates the original image/configuration.
    sys.argv = ["native_control_rollout.py", "--rollback", report["release_directory"]]
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        code = r.main()
    rollback = json.loads(stdout.getvalue())
    records.append(rollback)
    assert (
        code == 0
        and rollback["rollback_verified"]
        and public_probe()
        and not public_probe(True)
    ), rollback
    # Fresh release with an intentionally failing external acceptance gate must
    # roll the real API container back automatically. Canary tests stay real.
    r.public_probe = lambda native=False: False if native else public_probe()
    sys.argv = ["native_control_rollout.py", "--apply"]
    stdout = io.StringIO()
    with contextlib.redirect_stdout(stdout):
        code = r.main()
    failed = json.loads(stdout.getvalue())
    records.append(failed)
    assert code == 1 and failed.get("rollback_verified") is True, failed
    assert r.inspect("firbo-api")["Image"] == orig["firbo-api"]["Image"]
    assert public_probe() and not public_probe(True)
    assert (stack / ".env").read_text() == files[".env"]
    assert all(r.identity(r.inspect(n)) == orig[n] for n in r.NAMES[1:])
    assert not list(r.ROOT.glob("*/canary.env"))
    print("FIRBO_NATIVE_DOCKER_LIFECYCLE_PASSED")
finally:
    out = Path("/tmp/firbo-native-evidence")
    out.mkdir(exist_ok=True)
    # Reports contain safe booleans/counts/image hashes, never inspected env values.
    (out / "docker-results.json").write_text(
        json.dumps(
            {
                "scope": "Disposable Docker; synthetic gateway; no public endpoint or real user verification",
                "records": records,
            },
            indent=2,
        )
    )
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
