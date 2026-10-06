"""Actual agent handler receipt contract; no network, model or filesystem work."""

from types import SimpleNamespace

from openjarvis.agents._stubs import AgentResult
from openjarvis.core.types import ToolResult
from openjarvis.server.models import ChatCompletionRequest, ChatCompletionResponse
from openjarvis.server.routes import _handle_agent


def run(results, include=True, answer="Done"):
    agent = SimpleNamespace(_model="original")
    agent.run = lambda *a, **kw: AgentResult(content=answer, tool_results=results)
    request = ChatCompletionRequest(
        model="test",
        messages=[{"role": "user", "content": "test"}],
        firbo_include_execution=include,
    )
    response = _handle_agent(agent, "test", request)
    assert agent._model == "original"
    return response.model_dump()


def test_actual_tool_failure_survives_successful_model_answer():
    receipt = run([ToolResult("file_write", "Permission denied", success=False)])[
        "execution"
    ]
    assert receipt["failed_count"] == 1
    assert receipt["tools"][0] == {
        "name": "file_write",
        "output": "Permission denied",
        "success": False,
        "truncated": False,
    }


def test_no_receipt_inferred_from_model_text_or_legacy_default():
    assert run([], include=False)["execution"] is None
    assert ChatCompletionResponse().execution is None
    receipt = run([], answer="I ran shell_exec and saved the file")["execution"]
    assert receipt["tool_count"] == 0
    assert receipt["tools"] == []


def test_bounds_and_failures_beyond_visible_results():
    results = [
        ToolResult("file_read", "x" * 3000, metadata={"secret": "not-exported"})
        for _ in range(30)
    ]
    results[-1].success = False
    receipt = run(results)["execution"]
    assert receipt["tool_count"] == 30
    assert receipt["failed_count"] == 1
    assert len(receipt["tools"]) == 24
    assert sum(len(t["output"]) for t in receipt["tools"]) == 24000
    assert receipt["truncated"] is True
    assert "not-exported" not in str(receipt)


def test_multibyte_output_survives_json_and_name_bound():
    receipt = run([ToolResult("a" * 300, "Αρχείο έτοιμο ✅")])["execution"]
    assert len(receipt["tools"][0]["name"]) == 120
    assert receipt["tools"][0]["output"] == "Αρχείο έτοιμο ✅"
