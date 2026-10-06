"""Gateway tool rejection must not silently become a prose-only success."""

import json

import httpx
import pytest

from openjarvis.core.types import Message, Role
from openjarvis.engine._base import EngineConnectionError
from openjarvis.engine.openai_compat_engines import OmniRouteEngine, VLLMEngine


@pytest.mark.parametrize("engine_class", [OmniRouteEngine, VLLMEngine])
@pytest.mark.parametrize("model", ["firbo-quality", "firbo-economy"])
def test_gateway_rejection_never_retries_without_tools(engine_class, model):
    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(400, json={"error": "private upstream detail"})

    engine = engine_class(host="http://test-gateway")
    engine._client.close()
    engine._client = httpx.Client(
        base_url="http://test-gateway", transport=httpx.MockTransport(handle)
    )
    tools = [{"type": "function", "function": {"name": "probe"}}]
    try:
        with pytest.raises(EngineConnectionError, match="No text-only retry") as caught:
            engine.generate(
                [Message(role=Role.USER, content="probe")],
                model=model,
                tools=tools,
            )
    finally:
        engine.close()
    assert len(requests) == 2
    assert all(request["tools"] == tools for request in requests)
    assert "tool_choice" not in requests[1]
    assert "private upstream detail" not in str(caught.value)


@pytest.mark.parametrize("engine_class", [OmniRouteEngine, VLLMEngine])
def test_gateway_tool_call_reaches_orchestrator_format(engine_class):
    def handle(request):
        assert json.loads(request.content)["tools"]
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "probe-1",
                                    "type": "function",
                                    "function": {
                                        "name": "probe",
                                        "arguments": '{"marker":"ok"}',
                                    },
                                }
                            ],
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        )

    engine = engine_class(host="http://test-gateway")
    engine._client.close()
    engine._client = httpx.Client(
        base_url="http://test-gateway", transport=httpx.MockTransport(handle)
    )
    try:
        result = engine.generate(
            [Message(role=Role.USER, content="probe")],
            model="firbo-quality",
            tools=[{"type": "function", "function": {"name": "probe"}}],
        )
    finally:
        engine.close()
    assert result["tool_calls"][0]["name"] == "probe"
    assert json.loads(result["tool_calls"][0]["arguments"]) == {"marker": "ok"}


@pytest.mark.parametrize("engine_class", [OmniRouteEngine, VLLMEngine])
def test_auto_rejection_can_recover_without_discarding_tools(engine_class):
    requests = []

    def handle(request):
        body = json.loads(request.content)
        requests.append(body)
        if "tool_choice" in body:
            return httpx.Response(400, json={"error": "unsupported tool_choice"})
        assert body["tools"] == tools
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "tool_calls": [
                                {
                                    "id": "real-call",
                                    "type": "function",
                                    "function": {"name": "probe", "arguments": "{}"},
                                }
                            ]
                        },
                        "finish_reason": "tool_calls",
                    }
                ]
            },
        )

    tools = [{"type": "function", "function": {"name": "probe"}}]
    engine = engine_class(host="http://test-gateway")
    engine._client.close()
    engine._client = httpx.Client(
        base_url="http://test-gateway", transport=httpx.MockTransport(handle)
    )
    try:
        result = engine.generate(
            [Message(role=Role.USER, content="probe")],
            model="firbo-quality",
            tools=tools,
        )
    finally:
        engine.close()
    assert result["tool_calls"][0]["name"] == "probe"
    assert len(requests) == 2
    assert requests[0]["tool_choice"] == "auto"
    assert requests[0]["messages"] == requests[1]["messages"]


@pytest.mark.parametrize(
    "selection", ["required", {"type": "function", "function": {"name": "probe"}}]
)
def test_explicit_tool_selection_is_never_relaxed(selection):
    calls = []

    def handle(request):
        calls.append(json.loads(request.content))
        return httpx.Response(400)

    engine = VLLMEngine(host="http://test-gateway")
    engine._client.close()
    engine._client = httpx.Client(
        base_url="http://test-gateway", transport=httpx.MockTransport(handle)
    )
    try:
        with pytest.raises(EngineConnectionError, match="No text-only retry"):
            engine.generate(
                [Message(role=Role.USER, content="probe")],
                model="firbo-quality",
                tools=[{"type": "function"}],
                tool_choice=selection,
            )
    finally:
        engine.close()
    assert len(calls) == 1
    assert calls[0]["tool_choice"] == selection
