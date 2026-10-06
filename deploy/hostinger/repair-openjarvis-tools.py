#!/usr/bin/env python3
"""Inspect the active FIRBO route; optionally install the bounded tool fix.

No endpoint guessing, port publishing, config edits or provider switching.
--apply updates a known engine file and repairs measured agent tool loss only
at a recognized forwarding site, with backup and rollback on failed health.
--verify-execution additionally asks the admin agent to printf a unique marker.
--diagnose-native tests safe native tools without modifying installed files.
--apply-temperature-fix installs the measured route workaround, verifies both
ordinary native executions and rolls back on failure.
--trace-native also traces installed adapter/server/prompt boundaries, without
executing any tools in the diagnostic worker or printing request/response prose.
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
AGENT_TARGET = PACKAGE / "agents/_stubs.py"
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
PRE_TEMPERATURE_SHA = "673f96dd99d9070bba33c0e7d9b0b9511ac902cad94d643448d9519551f38b61"
CANDIDATE_SHA = "d833c6cd073ee235ac1f47f74f668317397524ee31c37889b87e2e0393b8b395"
TEMPERATURE_HELPER = '''\
    def _prepare_firbo_tool_payload(self, payload: Dict[str, Any]) -> None:
        """Use gateway sampling defaults on the measured FIRBO tool route.

        The owner's repeated A/B test returned tools only when temperature
        was omitted. Keep this compatibility workaround endpoint/model scoped;
        never remove tools or relax an explicit tool_choice.
        """
        from urllib.parse import urlsplit

        endpoint = urlsplit(self._host)
        if (
            payload.get("tools")
            and payload.get("model") == "firbo-quality"
            and endpoint.scheme == "https"
            and endpoint.hostname == "gateway.firboai.app"
            and endpoint.port in (None, 443)
        ):
            payload.pop("temperature", None)

'''
TEMPERATURE_CALL = "        self._prepare_firbo_tool_payload(payload)\n"


def digest(data):
    return hashlib.sha256(data).hexdigest()


class RepairError(RuntimeError):
    """A fixed, non-secret diagnostic produced by this script."""


def candidate(data):
    if digest(data) == CANDIDATE_SHA:
        return data
    if digest(data) not in BASELINES | {PRE_TEMPERATURE_SHA}:
        raise RepairError("unknown_engine_code_preserved")
    source = data.decode()
    if digest(data) != PRE_TEMPERATURE_SHA:
        block = PREVIOUS_BLOCK if PREVIOUS_BLOCK in source else OLD_BLOCK
        if source.count(block) != 1:
            raise RepairError("unexpected_engine_structure")
        source = source.replace(block, NEW_BLOCK, 1)
    if digest(source.encode()) != PRE_TEMPERATURE_SHA:
        raise RepairError("pre_temperature_hash_mismatch")
    anchor = '            payload["tool_choice"] = "auto"\n'
    if source.count(anchor) != 3 or source.count("    def generate(") != 1:
        raise RepairError("unexpected_temperature_structure")
    source = source.replace(
        "    def generate(", TEMPERATURE_HELPER + "    def generate(", 1
    )
    source = source.replace(anchor, anchor + TEMPERATURE_CALL)
    result = source.encode()
    ast.parse(result)
    if digest(result) != CANDIDATE_SHA:
        raise RepairError("candidate_hash_mismatch")
    return result


AGENT_FORWARDING = """        # FIRBO: retain runtime tools after option filtering.
        for _firbo_key in ("tools", "tool_choice"):
            if _firbo_key in extra_kwargs:
                gen_kwargs[_firbo_key] = extra_kwargs[_firbo_key]
"""


def agent_candidate(data):
    """Patch only the recognized forwarding site; preserve every other byte."""
    source = data.decode()
    if AGENT_FORWARDING in source:
        return data
    tree = ast.parse(source)
    classes = [
        n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "BaseAgent"
    ]
    if len(classes) != 1:
        raise RepairError("unknown_agent_structure_preserved")
    methods = [
        n
        for n in classes[0].body
        if isinstance(n, ast.FunctionDef) and n.name == "_generate"
    ]
    if len(methods) != 1 or not methods[0].args.kwarg:
        raise RepairError("unknown_agent_structure_preserved")
    method = methods[0]
    if method.args.kwarg.arg != "extra_kwargs":
        raise RepairError("unknown_agent_structure_preserved")
    sites = [
        n
        for n in method.body
        if isinstance(n, ast.Assign)
        and isinstance(n.value, ast.Call)
        and ast.unparse(n.value.func) == "self._engine.generate"
        and any(
            k.arg is None
            and isinstance(k.value, ast.Name)
            and k.value.id == "gen_kwargs"
            for k in n.value.keywords
        )
    ]
    if len(sites) != 1 or not any(
        isinstance(n, ast.Assign)
        and n.lineno < sites[0].lineno
        and any(isinstance(t, ast.Name) and t.id == "gen_kwargs" for t in n.targets)
        for n in method.body
    ):
        raise RepairError("unknown_agent_structure_preserved")
    lines = source.splitlines(keepends=True)
    index = sites[0].lineno - 1
    if not lines[index].startswith("        result = self._engine.generate("):
        raise RepairError("unknown_agent_structure_preserved")
    result = "".join(lines[:index]) + AGENT_FORWARDING + "".join(lines[index:])
    ast.parse(result)
    if result.replace(AGENT_FORWARDING, "", 1) != source:
        raise RepairError("agent_patch_not_isolated")
    return result.encode()


AGENT_CHECK = r"""
import json
from types import SimpleNamespace
from openjarvis.agents._stubs import BaseAgent
seen = {}
def capture(messages, **kwargs):
    seen.update(kwargs)
    return {"content": "fixture", "usage": {}}
tools = [{"type": "function", "function": {"name": "firbo_probe"}}]
agent = SimpleNamespace(_bus=None, _engine=SimpleNamespace(generate=capture),
    _engine_options={}, _model="firbo-quality", _temperature=0.0, _max_tokens=16)
BaseAgent._generate(agent, [], tools=tools, tool_choice="required")
print(json.dumps({"tools_forwarded": seen.get("tools") == tools,
                 "tool_choice_forwarded": seen.get("tool_choice") == "required",
                 "tools_executed": False}))
"""


def agent_forwarding_probe():
    return json.loads(
        run(["runuser", "-u", "jarvis", "--", str(PYTHON), "-B", "-c", AGENT_CHECK])
    )


def run(args, **kwargs):
    timeout = kwargs.pop("timeout", 180)
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=timeout, cwd="/tmp", **kwargs
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
    runtime = local_request(SERVICES[service], key, "/v1/info")
    pid = run(["systemctl", "show", service, "-p", "MainPID", "--value"])
    args = Path("/proc", pid, "cmdline").read_bytes().decode().split("\0")
    for index, argument in enumerate(args):
        if argument in {"--engine", "-e"} and index + 1 < len(args):
            runtime["engine_override"] = args[index + 1]
        elif argument.startswith("--engine="):
            runtime["engine_override"] = argument.split("=", 1)[1]
    return env, runtime


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
from openjarvis.engine._discovery import _make_engine, discover_engines, get_engine
from openjarvis.engine._openai_compat import _OpenAICompatibleEngine
inject_credentials()
config = load_config()
owners = []
route_source = "active_adapter_config"
if job["engine"] == "multi":
    from openjarvis.engine.multi import MultiEngine
    primary = get_engine(config, job.get("engine_override"), model=job["model"])
    if primary is None:
        raise RuntimeError("no_primary_engine")
    entries = [primary]
    entries.extend((key, item) for key, item in discover_engines(config)
                   if key != primary[0])
    owner = MultiEngine(entries)
    engine = owner._engine_for(job["model"])
    selected = next((key for key, item in reversed(entries) if item is engine), None)
    owners = [key for key, item in entries if job["model"] in item.list_models()]
    route_source = "reconstructed_from_current_config_and_catalogue"
else:
    selected = job["engine"]
    engine = _make_engine(selected, config)
    owner = engine
try:
    if not isinstance(engine, _OpenAICompatibleEngine):
        print(json.dumps({"selected_engine": selected,
                          "blocked": "selected_adapter_is_not_openai_compatible"}))
        raise SystemExit(0)
    target = urlsplit(engine._host)
    if target.scheme not in {"http", "https"} or not target.hostname:
        raise RuntimeError("invalid_configured_endpoint")
    report = {"engine": job["engine"], "selected_engine": selected,
              "route_source": route_source, "advertising_engines": owners,
              "model": job["model"],
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
    expected_name, expected_args = "firbo_probe", {"marker": marker}
    choices_to_test = ("auto", "required", "omitted")
    if job.get("native"):
        from types import SimpleNamespace
        from openjarvis.agents.orchestrator import OrchestratorAgent
        from openjarvis.tools.code_interpreter import CodeInterpreterTool
        from openjarvis.tools.calculator import CalculatorTool
        from openjarvis.tools.shell_exec import ShellExecTool
        expected_name = job["native"]["tool"]
        tool_class = {"code_interpreter": CodeInterpreterTool,
                      "calculator": CalculatorTool}[expected_name]
        tool = tool_class()
        if tool.spec.requires_confirmation:
            raise RuntimeError("native_probe_requires_confirmation")
        native_schema = tool.to_openai_function()
        expected_args = job["native"]["arguments"]
        body["tools"] = [native_schema]
        body["messages"] = [{"role": "user", "content": job["native"]["prompt"]}]
        captured = []
        def capture(messages, **kwargs):
            captured.append(kwargs)
            return {"content": "fixture complete", "usage": {}}
        fixture = OrchestratorAgent(
            SimpleNamespace(generate=capture), job["model"], tools=[tool],
            max_turns=1, temperature=0.0, max_tokens=256,
        )
        fixture.run(job["native"]["prompt"])
        report["native_schema"] = native_schema
        report["orchestrator_fixture"] = {
            "mode": getattr(fixture, "_mode", None),
            "generation_count": len(captured),
            "native_schema_forwarded": bool(captured) and
                captured[0].get("tools") == [native_schema],
            "tools_executed": False,
        }
        report["shell_requires_confirmation"] = (
            ShellExecTool().spec.requires_confirmation
        )
        report["probe_tool"] = expected_name
        choices_to_test = ("auto", "required")
    if job.get("trace"):
        import hashlib, importlib
        from pathlib import Path
        from openjarvis.core.types import Message, Role
        from openjarvis.core.events import EventBus
        from openjarvis.server.models import ChatCompletionRequest
        from openjarvis.server.routes import _handle_direct
        from openjarvis.prompt.builder import SystemPromptBuilder
        from openjarvis.telemetry.instrumented_engine import InstrumentedEngine

        def fingerprint(value):
            return hashlib.sha256(json.dumps(value, sort_keys=True,
                default=str).encode()).hexdigest()

        def call_summary(calls, nested=False):
            matched = False
            for call in calls:
                function = call.get("function", {}) if nested else call
                try:
                    arguments = json.loads(function.get("arguments", "{}"))
                except (ValueError, TypeError):
                    continue
                matched = matched or (function.get("name") == expected_name
                    and arguments == expected_args)
            return {"tool_calls": len(calls), "expected_call": matched}

        report["installed_sources"] = {}
        for name in ("engine._openai_compat", "engine.multi", "agents._stubs",
                     "agents.orchestrator", "server.routes", "server.models",
                     "telemetry.instrumented_engine", "security.guardrails"):
            module = importlib.import_module("openjarvis." + name)
            report["installed_sources"][name] = hashlib.sha256(
                Path(module.__file__).read_bytes()).hexdigest()
        report["trace_scope"] = "fresh_process_installed_code_not_live_process"
        report["trace_tools_executed"] = False
        report["stages"] = {}
        wire = []
        original_post = engine._client.post

        def traced_post(url, **kwargs):
            payload = kwargs.get("json") or {}
            messages = payload.get("messages") or []
            entry = {
                "request": {
                    "model_matches": payload.get("model") == job["model"],
                    "tool_count": len(payload.get("tools") or []),
                    "schema_matches": payload.get("tools") == [native_schema],
                    "tool_choice": payload.get("tool_choice")
                        if payload.get("tool_choice") in
                            (None, "auto", "required", "none")
                        else "named_or_other",
                    "temperature": payload.get("temperature"),
                    "max_tokens": payload.get("max_tokens"),
                    "roles": [m.get("role") if m.get("role") in
                        ("system", "user", "assistant", "tool") else "other"
                        for m in messages],
                    "prompt_retained": any(m.get("role") == "user" and
                        m.get("content") == job["native"]["prompt"] for m in messages),
                    "system_chars": sum(len(str(m.get("content", "")))
                        for m in messages if m.get("role") == "system"),
                    "messages_sha256": fingerprint(messages),
                },
            }
            wire.append(entry)
            # Bound every wire call even when the service default is 600s.
            kwargs["timeout"] = 25
            response = original_post(url, **kwargs)
            entry["http"] = response.status_code
            if response.is_success:
                data = response.json()
                choices = data.get("choices") or []
                choice = choices[0] if choices else {}
                message = choice.get("message") or {}
                entry["response"] = call_summary(
                    message.get("tool_calls") or [], nested=True)
                entry["response"]["content_chars"] = len(
                    str(message.get("content") or ""))
                finish = choice.get("finish_reason")
                entry["response"]["finish_reason"] = finish if finish in (
                    None, "stop", "length", "tool_calls", "content_filter") else "other"
            return response

        engine._client.post = traced_post

        def stage(name, generate):
            wire.clear()
            try:
                value = generate()
                if isinstance(value, dict):
                    result = call_summary(value.get("tool_calls") or [])
                else:
                    choices = value.choices or []
                    calls = choices[0].message.tool_calls if choices else []
                    result = call_summary(calls or [], nested=True)
                report["stages"][name] = {"wire": list(wire), "result": result}
            except Exception as error:
                report["stages"][name] = {
                    "wire": list(wire), "error_type": type(error).__name__}

        user_messages = [Message(role=Role.USER, content=job["native"]["prompt"])]
        stage("adapter_plain", lambda: owner.generate(user_messages,
            model=job["model"], tools=[native_schema], max_tokens=256, temperature=0.0))
        request = ChatCompletionRequest(model=job["model"],
            messages=body["messages"], tools=[native_schema],
            max_tokens=256, temperature=0.0)
        stage("server_identity", lambda: _handle_direct(owner, job["model"],
            request, app_config=config))

        # Reconstruct configured scanners/telemetry without audit stores, tools,
        # capability changes, or subscribers. This is not live-process state.
        wrapped = owner
        wrappers_ready = False
        try:
            if config.security.enabled:
                from openjarvis.security.guardrails import GuardrailsEngine
                from openjarvis.security.scanner import PIIScanner, SecretScanner
                from openjarvis.security.types import RedactionMode
                scanners = []
                if config.security.secret_scanner:
                    scanners.append(SecretScanner())
                if config.security.pii_scanner:
                    scanners.append(PIIScanner())
                if scanners:
                    wrapped = GuardrailsEngine(wrapped, scanners=scanners,
                        mode=RedactionMode(config.security.mode),
                        scan_input=config.security.scan_input,
                        scan_output=config.security.scan_output)
            wrapped = InstrumentedEngine(wrapped, EventBus())
            wrappers_ready = True
            stage("configured_wrappers", lambda: _handle_direct(wrapped,
                job["model"], request, app_config=config))
        except Exception as error:
            report["stages"]["configured_wrappers"] = {
                "error_type": type(error).__name__}

        # Capture the first configured agent request with a text-only fake
        # engine. Replay it only for inference; returned calls are NEVER run.
        try:
            if not wrappers_ready:
                raise RuntimeError("configured_wrappers_unavailable")
            captured_requests = []
            def capture_request(messages, **kwargs):
                captured_requests.append((list(messages), dict(kwargs)))
                return {"content": "capture complete", "usage": {}}
            builder = SystemPromptBuilder(
                agent_template=config.agent.default_system_prompt or "",
                memory_files_config=config.memory_files,
                system_prompt_config=config.system_prompt)
            configured_agent = OrchestratorAgent(
                SimpleNamespace(generate=capture_request), job["model"],
                tools=[tool], max_turns=1, prompt_builder=builder)
            configured_agent.run(job["native"]["prompt"])
            if len(captured_requests) != 1:
                raise RuntimeError("unexpected_capture_count")
            captured_messages, captured_kwargs = captured_requests[0]
            stage("configured_agent_request", lambda: wrapped.generate(
                captured_messages, **captured_kwargs))
        except Exception as error:
            report["stages"]["configured_agent_request"] = {
                "error_type": type(error).__name__}
        engine._client.post = original_post
        print(json.dumps(report))
        raise SystemExit(0)
    for choice in choices_to_test:
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
                    if (function.get("name") == expected_name
                            and isinstance(args, dict)
                            and all(args.get(k) == v
                                    for k, v in expected_args.items())):
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
    owner.close()
"""


SAFE_WORKER = (
    "try:\n    exec(" + repr(WORKER) + ")\n"
    "except Exception as error:\n"
    '    import json; print(json.dumps({"worker_error": '
    "type(error).__name__}))\n"
)


def gateway_probe(env, runtime, native=None, trace=False):
    if runtime.get("engine") not in {"vllm", "omniroute", "multi"}:
        return {"blocked": "unsupported_active_engine", "engine": runtime.get("engine")}
    job = {
        "env": env,
        "engine": runtime["engine"],
        "model": runtime["model"],
        "engine_override": runtime.get("engine_override"),
        "native": native,
        "trace": trace,
    }
    return json.loads(
        run(
            ["runuser", "-u", "jarvis", "--", str(PYTHON), "-B", "-c", SAFE_WORKER],
            input=json.dumps(job),
            timeout=300 if trace else 180,
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


def install(
    path, backup_root, command=run, verify=lambda: None, candidate_fn=candidate
):
    if path.is_symlink() or path.resolve() != path or not path.is_file():
        raise RepairError("unexpected_engine_path")
    before = path.read_bytes()
    after = candidate_fn(before)
    if after == before:
        return {"already_installed": True}
    metadata = path.stat()
    backup = Path(tempfile.mkdtemp(prefix="firbo-tools-", dir=backup_root))
    saved = backup / path.name
    saved.write_bytes(before)
    saved.chmod(0o600)
    print(
        json.dumps({"backup": str(backup), "phase": "before_service_restart"}),
        flush=True,
    )
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
        print(
            json.dumps({"rollback_completed": True, "backup": str(backup)}), flush=True
        )
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


def native_case(service, runtime):
    name = "code_interpreter" if service == "openjarvis.service" else "calculator"
    names = (runtime.get("runtime") or {}).get("tool_names") or []
    if name not in names:
        raise RepairError("safe_probe_tool_not_loaded:" + name)
    seed = int(uuid.uuid4().hex[:8], 16)
    left, right = 10000 + seed % 90000, 100 + (seed // 90000) % 900
    expression = f"{left} * {right} + 7"
    arguments = (
        {"code": "print(" + expression + ")"}
        if name == "code_interpreter"
        else {"expression": expression}
    )
    return {
        "tool": name,
        "arguments": arguments,
        "expected": str(float(left * right + 7))
        if name == "calculator"
        else str(left * right + 7),
        "prompt": "Use the "
        + name
        + " tool with exactly these arguments: "
        + json.dumps(arguments)
        + ". Execute the tool and report its result. "
        "Do not just acknowledge the request. Do not use other tools, "
        "read or change files, use the network, or bypass an approval.",
    }


def native_receipt(result, case):
    receipt = result.get("execution") or {}
    tools = receipt.get("tools") or []
    verified = receipt.get("contract") == "openjarvis-execution/v1" and any(
        t.get("name") == case["tool"]
        and t.get("success") is True
        and str(t.get("output", "")).strip() == case["expected"]
        for t in tools
    )
    return {
        "tool": case["tool"],
        "native_receipt_verified": verified,
        "tool_count": receipt.get("tool_count"),
        "failed_count": receipt.get("failed_count"),
        "approval_blocked": any(
            "confirmation" in str(t.get("output", "")).lower()
            and t.get("success") is False
            for t in tools
        ),
        "artifact_verified": False,
    }


def native_diagnostics(service, env, runtime, trace=False):
    case = native_case(service, runtime)
    gateway = gateway_probe(
        env, runtime, native=case, **({"trace": True} if trace else {})
    )
    schema = gateway.pop("native_schema", None)
    print(json.dumps({"service": service, "native_gateway": gateway}), flush=True)
    body = {
        "model": runtime["model"],
        "stream": False,
        "firbo_include_execution": True,
        "messages": [{"role": "user", "content": case["prompt"]}],
    }
    if schema:
        try:
            raw = local_request(
                SERVICES[service],
                env["OPENJARVIS_API_KEY"],
                "/v1/chat/completions",
                {**body, "tools": [schema]},
                timeout=145,
            )
            choices = raw.get("choices") or []
            message = choices[0].get("message", {}) if choices else {}
            calls = message.get("tool_calls") or []
            print(
                json.dumps(
                    {
                        "service": service,
                        "server_direct": {
                            "tool_calls": len(calls),
                            "native_tool_call": any(
                                c.get("function", {}).get("name") == case["tool"]
                                for c in calls
                            ),
                            "tools_executed": False,
                            "agent_receipt_present": isinstance(
                                raw.get("execution"), dict
                            ),
                            "reported_executed_tools": (raw.get("execution") or {}).get(
                                "tool_count"
                            ),
                        },
                    }
                ),
                flush=True,
            )
        except Exception as error:
            print(
                json.dumps(
                    {"service": service, "server_direct_error": type(error).__name__}
                ),
                flush=True,
            )
    result = local_request(
        SERVICES[service],
        env["OPENJARVIS_API_KEY"],
        "/v1/chat/completions",
        body,
        timeout=145,
    )
    print(
        json.dumps(
            {"service": service, "native_execution": native_receipt(result, case)}
        ),
        flush=True,
    )


def verify_native_execution():
    """Fail the transaction unless both ordinary agent routes execute arithmetic."""
    verify_health()
    for service in SERVICES:
        env, runtime = info(service)
        case = native_case(service, runtime)
        result = local_request(
            SERVICES[service],
            env["OPENJARVIS_API_KEY"],
            "/v1/chat/completions",
            {
                "model": runtime["model"],
                "stream": False,
                "firbo_include_execution": True,
                "messages": [{"role": "user", "content": case["prompt"]}],
            },
            timeout=145,
        )
        receipt = native_receipt(result, case)
        print(json.dumps({"service": service, "native_execution": receipt}), flush=True)
        if (
            not receipt["native_receipt_verified"]
            or receipt["failed_count"] != 0
            or receipt["tool_count"] != 1
        ):
            raise RepairError("native_execution_not_verified:" + service)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--apply-temperature-fix", action="store_true")
    parser.add_argument("--verify-execution", action="store_true")
    parser.add_argument("--diagnose-native", action="store_true")
    parser.add_argument("--trace-native", action="store_true")
    args = parser.parse_args()
    if args.apply_temperature_fix and (
        args.apply or args.verify_execution or args.diagnose_native or args.trace_native
    ):
        parser.error("temperature repair runs alone and verifies native execution")
    if (args.diagnose_native or args.trace_native) and (
        args.apply or args.verify_execution
    ):
        parser.error("native diagnostics run alone and do not install code")
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
    if args.apply_temperature_fix:
        for service in SERVICES:
            _, runtime = info(service)
            if runtime.get("model") != "firbo-quality":
                raise RepairError("unmeasured_model_preserved")
            native_case(service, runtime)
        outcome = install(TARGET, "/var/backups", verify=verify_native_execution)
        if outcome.get("already_installed"):
            verify_native_execution()
        print(
            json.dumps(
                {
                    **outcome,
                    "configuration_changed": False,
                    "native_execution_verified": True,
                    "full_parity_complete": False,
                }
            ),
            flush=True,
        )
        return
    if args.diagnose_native or args.trace_native:
        for service in SERVICES:
            try:
                env, runtime = info(service)
                native_diagnostics(service, env, runtime, trace=args.trace_native)
            except Exception as error:
                print(
                    json.dumps(
                        {
                            "service": service,
                            "native_error": type(error).__name__,
                            "reason": str(error)
                            if isinstance(error, RepairError)
                            else None,
                        }
                    ),
                    flush=True,
                )
        print(
            json.dumps(
                {
                    "installed_files_changed": False,
                    "configuration_changed": False,
                    "full_parity_complete": False,
                }
            )
        )
        return
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
    try:
        forwarding = agent_forwarding_probe()
        print(json.dumps({"agent_forwarding": forwarding}), flush=True)
        if args.apply and (
            not forwarding["tools_forwarded"] or not forwarding["tool_choice_forwarded"]
        ):

            def verify_agent():
                verify_health()
                after = agent_forwarding_probe()
                if not after["tools_forwarded"] or not after["tool_choice_forwarded"]:
                    raise RepairError("agent_forwarding_verification_failed")

            print(
                json.dumps(
                    {
                        "agent_repair": install(
                            AGENT_TARGET,
                            "/var/backups",
                            verify=verify_agent,
                            candidate_fn=agent_candidate,
                        )
                    }
                ),
                flush=True,
            )
            print(
                json.dumps({"agent_forwarding": agent_forwarding_probe()}), flush=True
            )
    except Exception as error:
        print(
            json.dumps(
                {
                    "agent_repair_error": type(error).__name__,
                    "reason": str(error) if isinstance(error, RepairError) else None,
                }
            ),
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
