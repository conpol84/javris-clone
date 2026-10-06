"""Gateway tool rejection must not silently become a prose-only success."""

import json

import httpx
import pytest

from openjarvis.core.types import Message, Role
from openjarvis.engine._base import EngineConnectionError
from openjarvis.engine.openai_compat_engines import OmniRouteEngine


def test_gateway_rejection_preserves_tools_and_does_not_retry():
    requests = []

    def handle(request):
        requests.append(json.loads(request.content))
        return httpx.Response(400, json={"error": "private upstream detail"})

    engine = OmniRouteEngine(host="http://test-gateway")
    engine._client.close()
    engine._client = httpx.Client(
        base_url="http://test-gateway", transport=httpx.MockTransport(handle)
    )
    tools = [{"type": "function", "function": {"name": "probe"}}]
    try:
        with pytest.raises(EngineConnectionError, match="No text-only retry") as caught:
            engine.generate(
                [Message(role=Role.USER, content="probe")],
                model="firbo-quality",
                tools=tools,
            )
    finally:
        engine.close()
    assert len(requests) == 1
    assert requests[0]["tools"] == tools
    assert "private upstream detail" not in str(caught.value)


def test_gateway_tool_call_reaches_orchestrator_format():
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

    engine = OmniRouteEngine(host="http://test-gateway")
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
