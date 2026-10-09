"""Disposable files and actual tools; no production service or provider requests."""

import copy
import importlib.util
import json
import os
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

import pytest

from openjarvis.agents._stubs import AgentResult
from openjarvis.server.models import ChatCompletionRequest
from openjarvis.server.routes import _handle_agent
from openjarvis.tools.file_read import FileReadTool
from openjarvis.tools.shell_exec import ShellExecTool

spec = importlib.util.spec_from_file_location(
    "artifact",
    Path(__file__).parents[2] / "deploy/hostinger/verify-openjarvis-artifact.py",
)
artifact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(artifact)


def envelope(tool):
    agent = SimpleNamespace(
        _model="test",
        run=lambda *a, **kw: AgentResult(
            content="Saved successfully", tool_results=[tool]
        ),
    )
    return _handle_agent(
        agent,
        "test",
        ChatCompletionRequest(model="test", messages=[], firbo_include_execution=True),
    ).model_dump()


def transport(directory, tamper=lambda result: result):
    calls = []

    def request(port, key, path, body, timeout):
        assert port == 8765 and path == "/v1/chat/completions"
        assert body["firbo_include_execution"] is True and "tools" not in body
        assert (
            "bypass an approval" in body["messages"][0]["content"]
            or "Preserve any required approval" in body["messages"][0]["content"]
        )
        calls.append(body)
        prompt = body["messages"][0]["content"]
        params = json.loads(re.search(r"with (\{.*\})\.", prompt)[1])
        # The synthetic test explicitly runs only its generated disposable command.
        if "command" in params:
            assert params["working_dir"] == str(directory)
            result = envelope(ShellExecTool().execute(**params))
        else:
            result = envelope(
                FileReadTool(allowed_dirs=[str(directory)]).execute(**params)
            )
        return tamper(result)

    return SimpleNamespace(
        PYTHON=Path(sys.executable),
        SERVICES={artifact.SERVICE: 8765},
        local_request=request,
    ), calls


def run(tmp_path, tamper=lambda value: value):
    tmp_path.chmod(0o700)
    api, calls = transport(tmp_path, tamper)
    result = artifact.verify(
        api,
        tmp_path,
        os.getuid(),
        {"OPENJARVIS_API_KEY": "synthetic"},
        {"model": "test"},
        "synthetic-reference",
    )
    return result, calls


def test_rust_shell_receipt_is_exactly_accepted(tmp_path):
    expected = "a" * 64
    from openjarvis.core.types import ToolResult

    result = envelope(
        ToolResult(
            "shell_exec",
            "Exit code: 0\n--- stdout ---\n" + expected + "\n\n--- stderr ---\n",
        )
    )
    assert artifact.receipt(
        result,
        "shell_exec",
        "Exit code: 0\n--- stdout ---\n" + expected + "\n\n--- stderr ---",
    )
    assert not artifact.receipt(result, "shell_exec", expected)


def test_actual_file_write_read_and_independent_hash(tmp_path):
    outcome, calls = run(tmp_path)
    assert outcome["artifact_verified"] is True
    assert outcome["website_delivery_verified"] is False
    assert outcome["full_parity_complete"] is False
    assert len(calls) == 2
    assert "synthetic-reference" in (tmp_path / "report.md").read_text()
    assert outcome["write_request_id"] != outcome["read_request_id"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("tool_count", 0),
        ("failed_count", 1),
        ("truncated", True),
        ("mode", "raw"),
        ("tool_count", True),
    ],
)
def test_invalid_write_receipt_stops_without_second_call(tmp_path, field, value):
    def tamper(result):
        result["execution"][field] = value
        return result

    outcome, calls = run(tmp_path, tamper)
    assert outcome["artifact_verified"] is False
    assert len(calls) == 1


def test_prose_is_not_evidence_and_no_retry(tmp_path):
    outcome, calls = run(
        tmp_path, lambda _: {"choices": [{"message": {"content": "All done"}}]}
    )
    assert not outcome["artifact_verified"] and len(calls) == 1


def test_read_receipt_without_file_fails_independent_check(tmp_path):
    def tamper(result):
        if result["execution"]["tools"][0]["name"] == "file_read":
            (tmp_path / "report.md").unlink()
        return result

    with pytest.raises(FileNotFoundError):
        run(tmp_path, tamper)


def test_replayed_request_id_is_rejected(tmp_path):
    def tamper(result):
        result["id"] = "chatcmpl-replayed"
        return result

    result, calls = run(tmp_path, tamper)
    assert not result["artifact_verified"] and len(calls) == 2


@pytest.mark.parametrize(
    "kind", ["symlink", "fifo", "hardlink", "permissions", "content", "directory"]
)
def test_filesystem_substitutions_refused(tmp_path, kind):
    tmp_path.chmod(0o700)
    p = tmp_path / "report.md"
    p.write_bytes(b"report")
    p.chmod(0o600)
    if kind in {"symlink", "fifo", "directory"}:
        p.unlink()
        if kind == "symlink":
            target = tmp_path / "other"
            target.write_bytes(b"report")
            p.symlink_to(target)
        elif kind == "fifo":
            os.mkfifo(p, 0o600)
        else:
            p.mkdir()
    elif kind == "hardlink":
        os.link(p, tmp_path / "other")
    elif kind == "permissions":
        p.chmod(0o644)
    else:
        p.write_bytes(b"forged")
    with pytest.raises((ValueError, OSError)):
        artifact.inspect_file(tmp_path, b"report", os.getuid())


def test_truncated_or_failed_read_output_is_not_accepted():
    from openjarvis.core.types import ToolResult

    original = envelope(ToolResult("file_read", "report"))
    for field, value in [
        ("truncated", True),
        ("success", False),
        ("output", "other"),
        ("name", "calculator"),
    ]:
        altered = copy.deepcopy(original)
        altered["execution"]["tools"][0][field] = value
        assert not artifact.receipt(altered, "file_read", "report")


@pytest.fixture
def root_writer(monkeypatch):
    if os.geteuid() != 0:
        pytest.skip("Actual root/service separation requires root")
    base = Path(tempfile.mkdtemp(prefix="firbo-writer-test-"))
    base.chmod(0o755)
    try:
        folder = base / "report"
        folder.mkdir(mode=0o700)
        try:
            os.chown(folder, 65534, 65534)
        except OSError as error:
            if error.errno == 22 and not os.environ.get("FIRBO_REQUIRE_UID_TEST"):
                pytest.skip("Local UID mapping unavailable; required in CI")
            raise
        root = base / "approval"
        root.mkdir(mode=0o755)
        monkeypatch.setattr(artifact, "WRITER_ROOT", root)
        yield base, folder, root
    finally:
        shutil.rmtree(base)


def test_real_root_writer_short_command_and_independent_acceptance(root_writer):
    from openjarvis.core.types import ToolResult

    _, folder, root = root_writer
    calls = []

    def issuer(body, arguments):
        command = shlex.split(arguments["command"])
        assert len(command) == 3 and command[1] == "-B"
        writer = Path(command[2])
        assert writer.parent == root / "writers"
        assert writer.stat().st_uid == 0
        assert stat.S_IMODE(writer.stat().st_mode) == 0o444
        assert stat.S_IMODE(writer.parent.stat().st_mode) == 0o711
        assert not (folder / "report.md").exists()
        return "a" * 64

    def request(port, key, path, body, timeout):
        calls.append(body)
        params = json.loads(
            re.search(r"with (\{.*\})\.", body["messages"][0]["content"])[1]
        )
        if "command" in params:
            assert body["firbo_native_approval"] == "a" * 64
            completed = subprocess.run(
                shlex.split(params["command"]),
                user=65534,
                group=65534,
                extra_groups=[],
                cwd=folder,
                capture_output=True,
                text=True,
                timeout=10,
                env={"PATH": "/usr/bin:/bin"},
            )
            assert completed.returncode == 0, completed.stderr
            return envelope(ToolResult("shell_exec", completed.stdout))
        assert "firbo_native_approval" not in body
        return envelope(FileReadTool(allowed_dirs=[str(folder)]).execute(**params))

    api = SimpleNamespace(
        PYTHON=Path(sys.executable),
        SERVICES={artifact.SERVICE: 8765},
        local_request=request,
    )
    outcome = artifact.verify(
        api,
        folder,
        65534,
        {"OPENJARVIS_API_KEY": "synthetic"},
        {"model": "test"},
        "short-command-test",
        issuer,
    )
    assert outcome["artifact_verified"] and len(calls) == 2
    assert (folder / "report.md").stat().st_uid == 65534
    assert stat.S_IMODE((folder / "report.md").stat().st_mode) == 0o600


def test_real_root_writer_cannot_be_changed_or_executed_by_root(root_writer):
    _, folder, root = root_writer
    writer = artifact.prepare_writer(folder, 65534, b"exact report")
    assert not (folder / "report.md").exists()
    refused = subprocess.run(
        [sys.executable, "-B", str(writer)], capture_output=True, timeout=10
    )
    assert refused.returncode != 0 and not (folder / "report.md").exists()
    change = """import pathlib, sys
p = pathlib.Path(sys.argv[1])
for action in (lambda: p.write_text('forged'), lambda: p.unlink(),
               lambda: (p.parent / 'extra.py').write_text('forged')):
    try:
        action()
    except PermissionError:
        continue
    raise SystemExit('service changed writer')
"""
    child = subprocess.run(
        [sys.executable, "-B", "-c", change, str(writer)],
        user=65534,
        group=65534,
        extra_groups=[],
        cwd=folder,
        env={"PATH": "/usr/bin:/bin"},
        capture_output=True,
        timeout=10,
    )
    assert child.returncode == 0, child.stderr
    target = root / "untouched"
    target.write_bytes(b"keep")
    (folder / "report.md").symlink_to(target)
    child = subprocess.run(
        [sys.executable, "-B", str(writer)],
        user=65534,
        group=65534,
        extra_groups=[],
        cwd=folder,
        env={"PATH": "/usr/bin:/bin"},
        capture_output=True,
        timeout=10,
    )
    assert child.returncode != 0 and target.read_bytes() == b"keep"


def test_approval_denial_is_reported_without_retry(tmp_path):
    from openjarvis.core.types import ToolResult

    calls = []

    def request(*args, **kwargs):
        calls.append(True)
        return envelope(
            ToolResult(
                "shell_exec",
                "Tool 'shell_exec' execution denied by user.",
                success=False,
            )
        )

    api = SimpleNamespace(
        PYTHON=Path(sys.executable),
        SERVICES={artifact.SERVICE: 8765},
        local_request=request,
    )
    outcome = artifact.verify(
        api,
        tmp_path,
        os.getuid(),
        {"OPENJARVIS_API_KEY": "synthetic"},
        {"model": "test"},
        "denial-test",
    )
    assert outcome["approval_blocked"] and len(calls) == 1
    assert outcome["write_execution_summary"]["failed_count"] == 1
    assert not (tmp_path / "report.md").exists()
