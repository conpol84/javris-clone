"""Disposable files and actual tools; no production service or provider requests."""

import copy
import importlib.util
import json
import os
import re
import sys
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
