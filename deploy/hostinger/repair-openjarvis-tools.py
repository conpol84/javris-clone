#!/usr/bin/env python3
"""Inspect the active FIRBO route; optionally install the bounded tool fix.

No endpoint guessing, port publishing, config edits or provider switching.
--apply updates one known engine file, with backup and rollback on failed health.
--verify-execution additionally asks the admin agent to printf a unique marker.
"""

import argparse
import ast
import hashlib
import json
import os
import socket
import stat
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PYTHON = Path("/home/jarvis/.openjarvis/.venv/bin/python")
PACKAGE = PYTHON.parent.parent / "lib/python3.13/site-packages/openjarvis"
TARGET = PACKAGE / "engine/_openai_compat.py"
SERVICES = {"openjarvis.service": 8765, "openjarvis-box.service": 8766}
BASELINES = {
    "f8771c8c7defb8eb06b979d621edae364dd1a1d44736ed782a9ff3532c594b96",
    "1fe122dc5001039958f18c9fc1932b99ee9a87da5196fe62645c629d62eaa6e2",
}
OLD_BLOCK = """            if resp.status_code == 400 and "tools" in payload:
                payload.pop("tools", None)
                payload.pop("tool_choice", None)
                resp = self._client.post(url, json=payload)
"""
PREVIOUS_BLOCK = """            if resp.status_code == 400 and "tools" in payload:
                if self.engine_id == "omniroute":
                    raise EngineConnectionError(
                        "OmniRoute rejected a request containing tools (HTTP 400). "
                        "No text-only retry was performed; "
                        "verify provider tool support."
                    )
                payload.pop("tools", None)
                payload.pop("tool_choice", None)
                resp = self._client.post(url, json=payload)
"""
NEW_BLOCK = """            if resp.status_code == 400 and "tools" in payload:
                # Host-installed FIRBO also uses the vLLM-compatible adapter.
                # Route policy must follow its aliases, not only adapter ID.
                if self.engine_id == "omniroute" or payload["model"] in {
                    "firbo-quality",
                    "firbo-economy",
                }:
                    # Some routed providers reject the optional auto selector.
                    # Omitting it preserves default auto semantics AND all tools.
                    # An explicit required/named selection must never be relaxed.
                    if payload.get("tool_choice") == "auto":
                        retry_payload = dict(payload)
                        retry_payload.pop("tool_choice")
                        resp = self._client.post(url, json=retry_payload)
                    if resp.status_code == 400:
                        raise EngineConnectionError(
                            "FIRBO gateway rejected tools (HTTP 400). "
                            "No text-only retry was performed; "
                            "verify provider tool support."
                        )
                else:
                    payload.pop("tools", None)
                    payload.pop("tool_choice", None)
                    resp = self._client.post(url, json=payload)
"""
CANDIDATE_SHA = "673f96dd99d9070bba33c0e7d9b0b9511ac902cad94d643448d9519551f38b61"


def digest(data):
    return hashlib.sha256(data).hexdigest()


class RepairError(RuntimeError):
    """A fixed, non-secret diagnostic produced by this script."""


def candidate(data):
    if digest(data) == CANDIDATE_SHA:
        return data
    if digest(data) not in BASELINES:
        raise RepairError("unknown_engine_code_preserved")
    source = data.decode()
    block = PREVIOUS_BLOCK if PREVIOUS_BLOCK in source else OLD_BLOCK
    if source.count(block) != 1:
        raise RepairError("unexpected_engine_structure")
    source = source.replace(block, NEW_BLOCK, 1)
    result = source.encode()
    ast.parse(result)
    if digest(result) != CANDIDATE_SHA:
        raise RepairError("candidate_hash_mismatch")
    return result


def run(args, **kwargs):
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=180, cwd="/tmp", **kwargs
    )
    if result.returncode:
        raise RepairError("command_failed:" + Path(args[0]).name)
    return result.stdout.strip()


def process_environment(service):
    if service not in SERVICES:
        raise RepairError("unknown_service")
    user = run(["systemctl", "show", service, "-p", "User", "--value"])
    pid = run(["systemctl", "show", service, "-p", "MainPID", "--value"])
    if user != "jarvis" or not pid.isdigit() or int(pid) <= 1:
        raise RepairError("service_not_running_as_jarvis")
    return dict(
        entry.decode().split("=", 1)
        for entry in Path("/proc", pid, "environ").read_bytes().split(b"\0")
        if b"=" in entry
    )


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def local_request(port, key, path, body=None, timeout=20):
    headers = {"Authorization": "Bearer " + key}
    if body is not None:
        headers["Content-Type"] = "application/json"
    request = Request(
        f"http://127.0.0.1:{port}" + path,
        headers=headers,
        data=json.dumps(body).encode() if body is not None else None,
    )
    with build_opener(ProxyHandler({}), NoRedirect()).open(
        request, timeout=timeout
    ) as response:
        return json.load(response)


def info(service):
    env = process_environment(service)
    key = env.get("OPENJARVIS_API_KEY", "")
    if not key:
        raise RepairError("missing_active_api_key")
    return env, local_request(SERVICES[service], key, "/v1/info")


# Runs under the service user, with its active environment passed over stdin.
# Construct exactly the installed config/engine, including legacy config migration
# and credential injection. Never emit keys, config contents or response prose.
WORKER = r"""
import json, logging, os, sys
from urllib.parse import urlsplit
logging.disable(logging.CRITICAL)
job = json.load(sys.stdin)
os.environ.clear()
os.environ.update(job["env"])
from openjarvis.core.credentials import inject_credentials
from openjarvis.core.config import load_config
from openjarvis.engine._discovery import _make_engine
from openjarvis.engine._openai_compat import _OpenAICompatibleEngine
inject_credentials()
engine = _make_engine(job["engine"], load_config())
try:
    if not isinstance(engine, _OpenAICompatibleEngine):
        raise RuntimeError("unsupported_adapter")
    target = urlsplit(engine._host)
    if target.scheme not in {"http", "https"} or not target.hostname:
        raise RuntimeError("invalid_configured_endpoint")
    report = {"engine": job["engine"], "model": job["model"],
              "endpoint": {"scheme": target.scheme, "host": target.hostname,
                           "port": target.port or
                               (443 if target.scheme == "https" else 80)},
              "probes": {}}
    marker = "FIRBO_TOOL_PROBE_OK"
    body = {"model": job["model"], "stream": False, "max_tokens": 256,
            "messages": [{"role": "user", "content":
                "Call firbo_probe with marker " + marker + ". Use the function."}],
            "tools": [{"type": "function", "function": {
                "name": "firbo_probe", "description": "A harmless test marker.",
                "parameters": {"type": "object", "properties": {
                    "marker": {"type": "string"}}, "required": ["marker"]}}}]}
    for choice in ("auto", "required", "omitted"):
        payload = dict(body)
        if choice != "omitted":
            payload["tool_choice"] = choice
        try:
            response = engine._client.post(engine._api_prefix + "/chat/completions",
                                           json=payload, timeout=40)
            entry = {"http": response.status_code, "probe_call": False}
            if response.is_success:
                data = response.json()
                choices = data.get("choices") or []
                message = choices[0].get("message", {}) if choices else {}
                calls = message.get("tool_calls") or []
                entry["tool_calls"] = len(calls)
                for call in calls:
                    function = call.get("function", {})
                    try:
                        args = json.loads(function.get("arguments", "{}"))
                    except (TypeError, ValueError):
                        continue
                    if (function.get("name") == "firbo_probe"
                            and args == {"marker": marker}):
                        entry["probe_call"] = True
            else:
                # Classify only; upstream error bodies may contain credentials.
                detail = response.text.lower()
                entry["mentions"] = [name for name in
                    ("tool_choice", "tools", "temperature", "max_tokens", "model")
                    if name in detail]
            report["probes"][choice] = entry
        except Exception as error:
            cause, number = error, None
            for _ in range(8):
                number = getattr(cause, "errno", None) or number
                cause = cause.__cause__ or cause.__context__
                if cause is None:
                    break
            report["probes"][choice] = {"error_type": type(error).__name__,
                "errno": number, "probe_call": False}
    print(json.dumps(report))
finally:
    engine.close()
"""


SAFE_WORKER = (
    "try:\n    exec(" + repr(WORKER) + ")\n"
    "except Exception as error:\n"
    '    import json; print(json.dumps({"worker_error": '
    "type(error).__name__}))\n"
)


def gateway_probe(env, runtime):
    if runtime.get("engine") not in {"vllm", "omniroute"}:
        return {"blocked": "unsupported_active_engine", "engine": runtime.get("engine")}
    job = {"env": env, "engine": runtime["engine"], "model": runtime["model"]}
    return json.loads(
        run(
            ["runuser", "-u", "jarvis", "--", str(PYTHON), "-B", "-c", SAFE_WORKER],
            input=json.dumps(job),
        )
    )


def atomic_write(path, data, metadata):
    fd, temporary = tempfile.mkstemp(prefix=".firbo-tools-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def install(path, backup_root, command=run, verify=lambda: None):
    if path.is_symlink() or path.resolve() != path or not path.is_file():
        raise RepairError("unexpected_engine_path")
    before = path.read_bytes()
    after = candidate(before)
    if after == before:
        return {"already_installed": True}
    metadata = path.stat()
    backup = Path(tempfile.mkdtemp(prefix="firbo-tools-", dir=backup_root))
    saved = backup / path.name
    saved.write_bytes(before)
    saved.chmod(0o600)
    changed = False
    try:
        for service in SERVICES:
            command(["systemctl", "stop", service])
        if path.read_bytes() != before:
            raise RepairError("concurrent_changes_preserved")
        atomic_write(path, after, metadata)
        changed = True
        for service in SERVICES:
            command(["systemctl", "start", service])
        verify()
    except BaseException:
        recovery_failed = False
        if changed:
            for service in SERVICES:
                try:
                    command(["systemctl", "stop", service])
                except Exception:
                    recovery_failed = True
            try:
                atomic_write(path, before, metadata)
            except Exception:
                recovery_failed = True
        for service in SERVICES:
            try:
                command(["systemctl", "start", service])
            except Exception:
                recovery_failed = True
        if recovery_failed:
            raise RepairError(
                "rollback_needs_attention_backup:" + str(backup)
            ) from None
        raise
    return {"installed": True, "backup": str(backup), "sha256": digest(after)}


def verify_health():
    for service in SERVICES:
        for attempt in range(20):
            try:
                info(service)
                break
            except Exception:
                if attempt == 19:
                    raise RepairError("service_health_failed") from None
                time.sleep(1)


def execution_probe(env, runtime):
    marker = "FIRBO_EXEC_" + uuid.uuid4().hex
    result = local_request(
        8765,
        env["OPENJARVIS_API_KEY"],
        "/v1/chat/completions",
        {
            "model": runtime["model"],
            "stream": False,
            "firbo_include_execution": True,
            "messages": [
                {
                    "role": "user",
                    "content": "Use shell_exec to run exactly: printf "
                    + marker
                    + "\nDo not change files, use the network, "
                    "read secrets or bypass approval. "
                    "Report the actual result.",
                }
            ],
        },
        timeout=145,
    )
    receipt = result.get("execution") or {}
    tools = receipt.get("tools") or []
    verified = receipt.get("contract") == "openjarvis-execution/v1" and any(
        tool.get("name") == "shell_exec"
        and tool.get("success") is True
        and marker in str(tool.get("output", ""))
        for tool in tools
    )
    return {
        "shell_receipt_verified": verified,
        "tool_count": receipt.get("tool_count"),
        "failed_count": receipt.get("failed_count"),
        "artifact_verified": False,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verify-execution", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "srv2027143":
        raise RepairError("run_as_root_on_srv2027143")
    if Path("/home/jarvis/.openjarvis-box/.venv").resolve() != PYTHON.parent.parent:
        raise RepairError("different_sandbox_environment")
    installed = run(
        [
            "runuser",
            "-u",
            "jarvis",
            "--",
            str(PYTHON),
            "-B",
            "-c",
            "import openjarvis; print(openjarvis.__file__)",
        ]
    )
    if Path(installed).resolve().parent != PACKAGE:
        raise RepairError("unexpected_installed_package")
    for service in SERVICES:
        _, runtime = info(service)
        print(
            json.dumps(
                {
                    "service": service,
                    "engine": runtime.get("engine"),
                    "model": runtime.get("model"),
                }
            ),
            flush=True,
        )
    if args.apply:
        print(
            json.dumps(install(TARGET, "/var/backups", verify=verify_health)),
            flush=True,
        )
    for service in SERVICES:
        try:
            env, runtime = info(service)
            print(
                json.dumps(
                    {"service": service, "gateway": gateway_probe(env, runtime)}
                ),
                flush=True,
            )
            if service == "openjarvis.service" and args.verify_execution:
                print(
                    json.dumps({"execution": execution_probe(env, runtime)}), flush=True
                )
        except Exception as error:
            print(
                json.dumps(
                    {
                        "service": service,
                        "error_type": type(error).__name__,
                        "http": error.code if isinstance(error, HTTPError) else None,
                    }
                ),
                flush=True,
            )
    print(json.dumps({"configuration_changed": False, "full_parity_complete": False}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {
                    "repair_failed": type(error).__name__,
                    "reason": str(error) if isinstance(error, RepairError) else None,
                }
            )
        )
        raise SystemExit(1) from None
