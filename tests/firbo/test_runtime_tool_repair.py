"""Real HTTP probing and disposable update/rollback; no production services."""

import importlib.util
import json
import os
import subprocess
import sys
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
spec = importlib.util.spec_from_file_location(
    "tool_repair", ROOT / "deploy/hostinger/repair-openjarvis-tools.py"
)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)
CURRENT = (ROOT / "src/openjarvis/engine/_openai_compat.py").read_bytes()


@pytest.mark.parametrize("previous", [False, True])
def test_known_baselines_produce_exact_tested_engine(previous):
    source = CURRENT.decode().replace(
        repair.NEW_BLOCK, repair.PREVIOUS_BLOCK if previous else repair.OLD_BLOCK
    )
    assert repair.candidate(source.encode()) == CURRENT
    assert repair.candidate(CURRENT) == CURRENT


def test_unknown_change_is_preserved():
    with pytest.raises(RuntimeError, match="unknown_engine_code_preserved"):
        repair.candidate(CURRENT + b"\n# concurrent edit\n")


def original_package(tmp_path):
    path = tmp_path / "engine.py"
    path.write_bytes(
        CURRENT.decode().replace(repair.NEW_BLOCK, repair.OLD_BLOCK).encode()
    )
    path.chmod(0o640)
    return path


def test_atomic_install_and_idempotence(tmp_path):
    path = original_package(tmp_path)
    before = path.read_bytes()
    commands = []
    result = repair.install(path, tmp_path, command=commands.append)
    assert path.read_bytes() == CURRENT
    assert path.stat().st_mode & 0o777 == 0o640
    assert (Path(result["backup"]) / path.name).read_bytes() == before
    assert len(commands) == 4
    assert repair.install(path, tmp_path, command=commands.append) == {
        "already_installed": True
    }
    assert len(commands) == 4


def test_bad_health_rolls_back(tmp_path):
    path = original_package(tmp_path)
    before = path.read_bytes()
    commands = []

    def failed():
        raise RuntimeError("bad_health")

    with pytest.raises(RuntimeError, match="bad_health"):
        repair.install(path, tmp_path, command=commands.append, verify=failed)
    assert path.read_bytes() == before
    assert len(commands) == 8


def test_concurrent_edit_survives(tmp_path):
    path = original_package(tmp_path)
    commands = []

    def command(args):
        commands.append(args)
        if args[1] == "stop":
            path.write_bytes(b"concurrent work")

    with pytest.raises(RuntimeError, match="concurrent_changes_preserved"):
        repair.install(path, tmp_path, command=command)
    assert path.read_bytes() == b"concurrent work"
    assert commands[-1] == ["systemctl", "start", "openjarvis-box.service"]


def test_symlink_refused(tmp_path):
    path = original_package(tmp_path)
    link = tmp_path / "link.py"
    link.symlink_to(path)
    with pytest.raises(RuntimeError, match="unexpected_engine_path"):
        repair.install(link, tmp_path)


def test_rollback_recovers_file_and_attempts_both_services_on_restart_failure(tmp_path):
    path = original_package(tmp_path)
    before = path.read_bytes()
    commands = []

    def command(args):
        commands.append(args)
        if args == ["systemctl", "start", "openjarvis.service"]:
            raise RuntimeError("restart_failed")

    with pytest.raises(repair.RepairError, match="rollback_needs_attention_backup"):
        repair.install(path, tmp_path, command=command)
    assert path.read_bytes() == before
    assert commands[-1] == ["systemctl", "start", "openjarvis-box.service"]


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("multi", [False, True])
def test_worker_uses_configured_vllm_route_and_never_drops_tools(
    tmp_path, legacy, multi
):
    received = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"data":[{"id":"firbo-quality"}]}')

        def do_POST(self):
            payload = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            received.append((self.path, self.headers.get("Authorization"), payload))
            if payload.get("tool_choice") == "auto":
                self.send_response(400)
                result = {"error": "unsupported tool_choice PRIVATE_DO_NOT_PRINT"}
            else:
                self.send_response(200)
                result = {
                    "choices": [
                        {
                            "message": {
                                "tool_calls": [
                                    {
                                        "function": {
                                            "name": "firbo_probe",
                                            "arguments": '{"marker":"FIRBO_TOOL_PROBE_OK"}',
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(result).encode())

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    endpoint = f"http://127.0.0.1:{server.server_port}"
    config = tmp_path / "config.toml"
    section = (
        f'vllm_host = "{endpoint}"'
        if legacy
        else (f'[engine.vllm]\nhost = "{endpoint}"')
    )
    config.write_text('[engine]\ndefault = "vllm"\n' + section + "\n")
    env = {
        **os.environ,
        "OPENJARVIS_HOME": str(tmp_path),
        "OPENJARVIS_CONFIG": str(config),
        "VLLM_API_KEY": "private-test-key",
        "OMNIROUTE_HOST": "http://wrong-host:20128",
        "VLLM_HOST": "http://wrong-env-host:8000",
        "PYTHONPATH": str(ROOT / "src"),
    }
    try:
        worker = repair.WORKER
        if multi:
            # Real MultiEngine/HTTP adapter; isolate discovery from other ports.
            worker = (
                """
from types import SimpleNamespace
from openjarvis.engine import _discovery
_discovery.get_engine = lambda cfg, key, model: (
    "vllm", _discovery._make_engine("vllm", cfg))
_discovery.discover_engines = lambda cfg: [
    ("fixture", SimpleNamespace(list_models=lambda: [], close=lambda: None))]
"""
                + worker
            )
        result = subprocess.run(
            [sys.executable, "-B", "-c", worker],
            input=json.dumps(
                {
                    "env": env,
                    "engine": "multi" if multi else "vllm",
                    "model": "firbo-quality",
                }
            ),
            capture_output=True,
            text=True,
            env=env,
            timeout=30,
        )
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["selected_engine"] == "vllm"
    if multi:
        assert report["advertising_engines"] == ["vllm"]
        assert (
            report["route_source"] == "reconstructed_from_current_config_and_catalogue"
        )
    assert report["endpoint"]["port"] == server.server_port
    assert report["probes"]["auto"] == {
        "http": 400,
        "probe_call": False,
        "mentions": ["tool_choice"],
    }
    assert report["probes"]["required"]["probe_call"] is True
    assert report["probes"]["omitted"]["probe_call"] is True
    assert len(received) == 3
    assert all(path == "/v1/chat/completions" for path, _, _ in received)
    assert all(auth == "Bearer private-test-key" for _, auth, _ in received)
    assert all(body["tools"] for _, _, body in received)
    assert "private-test-key" not in result.stdout
    assert "PRIVATE_DO_NOT_PRINT" not in result.stdout


@pytest.mark.parametrize(
    "tools,expected",
    [
        ([], False),
        (
            [{"name": "shell_exec", "success": False, "output": "FIRBO_EXEC_test"}],
            False,
        ),
        ([{"name": "shell_exec", "success": True, "output": "FIRBO_EXEC_test"}], True),
    ],
)
def test_execution_needs_successful_matching_receipt(monkeypatch, tools, expected):
    class ID:
        hex = "test"

    monkeypatch.setattr(repair.uuid, "uuid4", ID)
    monkeypatch.setattr(
        repair,
        "local_request",
        lambda *a, **kw: {
            "choices": [{"message": {"content": "Executed successfully!"}}],
            "execution": {"contract": "openjarvis-execution/v1", "tools": tools},
        },
    )
    result = repair.execution_probe({"OPENJARVIS_API_KEY": "test"}, {"model": "test"})
    assert result["shell_receipt_verified"] is expected
    assert result["artifact_verified"] is False


def test_legacy_agent_patch_restores_tools_and_preserves_other_code(monkeypatch):
    source = (ROOT / "src/openjarvis/agents/_stubs.py").read_text()
    broken = source.replace(
        "for key, value in self._engine_options.items()",
        "for key, value in {**self._engine_options, **extra_kwargs}.items()",
    ).replace("        gen_kwargs.update(extra_kwargs)\n", "")
    before = types.ModuleType("firbo_agent_before")
    after = types.ModuleType("firbo_agent_after")
    monkeypatch.setitem(sys.modules, before.__name__, before)
    monkeypatch.setitem(sys.modules, after.__name__, after)
    exec(compile(broken, "before.py", "exec"), before.__dict__)
    patched = repair.agent_candidate(broken.encode())
    assert patched.decode().replace(repair.AGENT_FORWARDING, "", 1) == broken
    assert repair.agent_candidate(patched) == patched
    exec(compile(patched, "after.py", "exec"), after.__dict__)
    for module, forwards in [(before, False), (after, True)]:
        captured = {}

        def capture(messages, **kwargs):
            captured.update(kwargs)
            return {"content": "fixture"}

        agent = types.SimpleNamespace(
            _bus=None,
            _engine=types.SimpleNamespace(generate=capture),
            _engine_options={"unknown_stored_option": "must_stay_filtered"},
            _model="test",
            _temperature=0,
            _max_tokens=16,
        )
        tools = [{"type": "function", "function": {"name": "probe"}}]
        module.BaseAgent._generate(agent, [], tools=tools, tool_choice="required")
        assert (captured.get("tools") == tools) is forwards
        assert (captured.get("tool_choice") == "required") is forwards
        assert "unknown_stored_option" not in captured


def test_unknown_agent_structure_is_not_changed():
    with pytest.raises(repair.RepairError, match="unknown_agent_structure_preserved"):
        repair.agent_candidate(b"class BaseAgent:\n    pass\n")


def test_installed_agent_behavior_probe_has_no_tool_execution(tmp_path):
    env = {
        **os.environ,
        "PYTHONPATH": str(ROOT / "src"),
        "OPENJARVIS_HOME": str(tmp_path),
    }
    result = subprocess.run(
        [sys.executable, "-B", "-c", repair.AGENT_CHECK],
        capture_output=True,
        text=True,
        env=env,
        timeout=20,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "tools_forwarded": True,
        "tool_choice_forwarded": True,
        "tools_executed": False,
    }
