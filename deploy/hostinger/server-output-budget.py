#!/usr/bin/env python3
"""Inspect or install the pinned output-budget repair; no inference/config writes.

Requires the unchanged update-openjarvis-engine.py beside this script. Its exact
hash is checked before executing its atomic replacement/rollback primitives.
"""

import argparse
import hashlib
import importlib.util
import json
import os
import re
import socket
import stat
import tempfile
import time
from pathlib import Path
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

BASE_HASH = "a583753fb538b298d87b48faa4407597f7c24af4f15c9a241164d8f303d38d06"
MANIFEST = {
    "routes.py": (
        "a7f73bb266da83e01ced8faa6add7f295f087ca857908240a511df77e94bc8ad",
        "3413231f4462b8f50b221da77bfac84a1429a85e4d353cbca3f17a835c3deda7",
    ),
    "output_budget.py": (
        None,
        "bd227b067b85cef573b93e3bae225cd9d82f29cf127371d830316214c994aaf5",
    ),
}
PORTS = {"openjarvis.service": 8765, "openjarvis-box.service": 8766}

# The real installed handler and native agent, with an entirely fake engine.
# Configure isolation BEFORE imports; no user files, paid inference or tools.
SELFTEST = r"""
import os, tempfile
with tempfile.TemporaryDirectory(prefix="firbo-budget-test-") as isolated:
    os.environ["OPENJARVIS_HOME"] = isolated
    os.environ.pop("OPENJARVIS_CONFIG", None)
    from openjarvis.agents.orchestrator import OrchestratorAgent
    from openjarvis.server.models import ChatCompletionRequest
    from openjarvis.server.routes import _handle_agent
    from fastapi import HTTPException
    class Engine:
        engine_id = "fixture"
        def __init__(self, values):
            self.values, self.limits = iter(values), []
        def generate(self, messages, **kwargs):
            self.limits.append(kwargs["max_tokens"])
            tokens, finish = next(self.values)
            return {"content":"fixture", "finish_reason":finish,
                "usage":{"prompt_tokens":12,"completion_tokens":tokens}}
    for exhausted in (False, True):
        engine = Engine([(10,"length")] if exhausted else
                        [(4,"length"),(3,"length"),(2,"stop")])
        agent = OrchestratorAgent(engine,"original",tools=[],temperature=0,
            max_tokens=1024,max_turns=3,system_prompt="Fixture")
        req = ChatCompletionRequest(model="chosen",max_tokens=10,
            firbo_include_execution=True,messages=[{"role":"user","content":"hi"}])
        try:
            result = _handle_agent(agent,"chosen",req)
            assert not exhausted
            assert result.usage.completion_tokens == 9
            assert result.usage.prompt_tokens == 36
            assert engine.limits == [10,6,3]
        except HTTPException as exc:
            assert exhausted and exc.detail == "output_budget_exhausted"
            assert engine.limits == [10]
        assert agent._engine is engine and agent._max_tokens == 1024
        assert agent._model == "original"
print("firbo_output_budget_selftest_passed")
"""


def regular_bytes(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
        raise RuntimeError("unsafe_local_file")
    if info.st_size > 1024 * 1024:
        raise RuntimeError("oversized_local_file")
    return path.read_bytes()


def load_base():
    path = Path(__file__).with_name("update-openjarvis-engine.py")
    data = regular_bytes(path)
    if hashlib.sha256(data).hexdigest() != BASE_HASH:
        raise RuntimeError("updater_helper_hash_mismatch")
    # Compile the validated bytes rather than reopening a mutable source file.
    spec = importlib.util.spec_from_loader("firbo_budget_updater_base", loader=None)
    module = importlib.util.module_from_spec(spec)
    exec(compile(data, str(path), "exec"), module.__dict__)
    module.MANIFEST = MANIFEST
    return module


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def runtime(base, service):
    pid = base.run(["systemctl", "show", service, "-p", "MainPID", "--value"])
    if not pid.isdigit() or pid == "0":
        raise RuntimeError("service_not_running")
    raw = Path("/proc", pid, "environ").read_bytes()
    env = dict(x.decode().split("=", 1) for x in raw.split(b"\0") if b"=" in x)
    key = env.get("OPENJARVIS_API_KEY", "")
    if not key or any(ord(char) < 32 for char in key):
        raise RuntimeError("local_service_auth_unavailable")
    request = Request(
        f"http://127.0.0.1:{PORTS[service]}/v1/info",
        headers={"Authorization": "Bearer " + key},
    )
    with build_opener(ProxyHandler({}), NoRedirect()).open(
        request, timeout=3
    ) as response:
        data = json.loads(response.read(65536))
    if data.get("agent") != "orchestrator" or data.get("model") != "firbo-quality":
        raise RuntimeError("unexpected_live_agent_preserved")
    if data.get("runtime", {}).get("agent_loaded") is not True:
        raise RuntimeError("native_agent_not_loaded")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.source):
        raise RuntimeError("immutable_source_required")
    if os.geteuid() != 0 or socket.gethostname() != "srv2027143":
        raise RuntimeError("run_as_root_on_srv2027143")
    base = load_base()
    base.SOURCE = args.source
    folder = base.PACKAGE
    if folder.resolve() != folder:
        raise RuntimeError("unexpected_package_symlink")
    if (
        Path("/home/jarvis/.openjarvis-box/.venv").resolve()
        != base.PYTHON.parent.parent
    ):
        raise RuntimeError("box_uses_different_environment")
    installed = base.run(
        [
            "runuser",
            "-u",
            "jarvis",
            "--",
            str(base.PYTHON),
            "-B",
            "-c",
            "import openjarvis; print(openjarvis.__file__)",
        ]
    )
    if Path(installed).resolve().parent / "server" != folder:
        raise RuntimeError("unexpected_python_package")
    for name in MANIFEST:
        path = folder / name
        if path.exists() or path.is_symlink():
            regular_bytes(path)
    found = base.inventory(folder)
    base.check_baseline(found)
    before = {}
    for service in PORTS:
        if (
            base.run(["systemctl", "show", service, "-p", "User", "--value"])
            != "jarvis"
        ):
            raise RuntimeError("unexpected_service_user")
        before[service] = runtime(base, service)
    print(
        json.dumps(
            {
                "preflight_passed": True,
                "installed_hashes": found,
                "apply": args.apply,
                "inference_performed": False,
            }
        ),
        flush=True,
    )
    if not args.apply:
        return
    candidates = {name: base.download(name) for name in MANIFEST}

    def verify():
        if base.inventory(folder) != {
            name: hashes[1] for name, hashes in MANIFEST.items()
        }:
            raise RuntimeError("installed_hash_mismatch")
        result = base.run(
            ["runuser", "-u", "jarvis", "--", str(base.PYTHON), "-B", "-c", SELFTEST]
        )
        if result != "firbo_output_budget_selftest_passed":
            raise RuntimeError("installed_selftest_failed")
        for service in PORTS:
            for attempt in range(10):
                try:
                    after = runtime(base, service)
                    break
                except Exception:
                    if attempt == 9:
                        raise RuntimeError("service_health_failed") from None
                    time.sleep(1)
            if any(
                after.get(k) != before[service].get(k)
                for k in ("model", "engine", "agent")
            ):
                raise RuntimeError("runtime_identity_changed")
            if after.get("runtime") != before[service].get("runtime"):
                raise RuntimeError("runtime_tools_changed")
            budget = after.get("output_budget", {})
            if (
                budget.get("contract") != "firbo-native-output-budget/v1"
                or budget.get("supported") is not True
            ):
                raise RuntimeError("live_budget_contract_missing")

    if all(found[name] == hashes[1] for name, hashes in MANIFEST.items()):
        verify()
        print(json.dumps({"already_installed": True, "verified": True}))
        return
    backup = Path(tempfile.mkdtemp(prefix="firbo-output-budget-", dir="/var/backups"))
    backup.rmdir()
    base.transact(folder, candidates, backup, list(PORTS), verify=verify)
    print(
        json.dumps(
            {
                "installed": True,
                "verified": True,
                "backup": str(backup),
                "inference_performed": False,
                "input_budget_verified": False,
                "provider_pricing_verified": False,
                "full_plan_complete": False,
            }
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Network/process exceptions can contain response bodies or credentials.
        print(
            json.dumps(
                {
                    "installed": False,
                    "error_type": type(error).__name__,
                    "error": str(error)
                    if type(error) is RuntimeError
                    else "operation_failed",
                }
            )
        )
        raise SystemExit(1) from None
