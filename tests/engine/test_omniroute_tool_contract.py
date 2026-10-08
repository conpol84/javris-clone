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


@pytest.mark.parametrize("temperature", [0.0, 0.7, 1.0])
@pytest.mark.parametrize(
    "selection",
    [
        "auto",
        "required",
        "none",
        {"type": "function", "function": {"name": "calculator"}},
    ],
)
def test_measured_route_omits_sampling_but_preserves_tool_selection(
    temperature, selection
):
    tools = [{"type": "function", "function": {"name": "calculator"}}]
    seen = []

    def handle(request):
        body = json.loads(request.content)
        seen.append(body)
        assert "temperature" not in body
        assert body["tools"] == tools
        assert body["tool_choice"] == selection
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    engine = VLLMEngine(host="https://gateway.firboai.app")
    engine._client.close()
    engine._client = httpx.Client(
        base_url=engine._host, transport=httpx.MockTransport(handle)
    )
    try:
        engine.generate(
            [Message(role=Role.USER, content="test")],
            model="firbo-quality",
            temperature=temperature,
            tools=tools,
            tool_choice=selection,
        )
    finally:
        engine.close()
    assert len(seen) == 1


@pytest.mark.parametrize(
    "host,model,tools",
    [
        ("https://other.example", "firbo-quality", [{}]),
        ("https://gateway.firboai.app.evil.example", "firbo-quality", [{}]),
        ("http://gateway.firboai.app", "firbo-quality", [{}]),
        ("https://gateway.firboai.app:8443", "firbo-quality", [{}]),
        ("https://gateway.firboai.app", "firbo-economy", [{}]),
        ("https://gateway.firboai.app", "another-model", [{}]),
        ("https://gateway.firboai.app", "firbo-quality", []),
    ],
)
def test_unmeasured_routes_keep_sampling(host, model, tools):
    def handle(request):
        assert json.loads(request.content)["temperature"] == 0.0
        return httpx.Response(200, json={"choices": [{"message": {"content": "ok"}}]})

    engine = VLLMEngine(host=host)
    engine._client.close()
    engine._client = httpx.Client(base_url=host, transport=httpx.MockTransport(handle))
    try:
        engine.generate(
            [Message(role=Role.USER, content="test")],
            model=model,
            temperature=0.0,
            tools=tools,
        )
    finally:
        engine.close()


@pytest.mark.parametrize("method", ["stream", "stream_full"])
def test_streaming_requests_use_same_route_policy(method):
    import asyncio

    seen = []

    def handle(request):
        body = json.loads(request.content)
        seen.append(body)
        assert "temperature" not in body
        assert body["tool_choice"] == "required"
        assert body["tools"][0]["function"]["name"] == "calculator"
        data = {"choices": [{"delta": {"content": "ok"}, "finish_reason": "stop"}]}
        return httpx.Response(
            200, text="data: " + json.dumps(data) + "\n\ndata: [DONE]\n\n"
        )

    async def consume():
        engine = VLLMEngine(host="https://gateway.firboai.app")
        engine._async_transport = httpx.MockTransport(handle)
        try:
            chunks = [
                chunk
                async for chunk in getattr(engine, method)(
                    [Message(role=Role.USER, content="test")],
                    model="firbo-quality",
                    temperature=0.0,
                    tools=[{"type": "function", "function": {"name": "calculator"}}],
                    tool_choice="required",
                )
            ]
            assert chunks
        finally:
            if engine._async_client is not None:
                await engine._async_client.aclose()
            engine.close()

    asyncio.run(consume())
    assert len(seen) == 1


def test_real_orchestrator_calculator_receipt_with_temperature_sensitive_transport():
    from openjarvis.agents.orchestrator import OrchestratorAgent
    from openjarvis.server.models import ChatCompletionRequest
    from openjarvis.server.routes import _handle_agent
    from openjarvis.tools.calculator import CalculatorTool

    seen = []

    def handle(request):
        body = json.loads(request.content)
        seen.append(body)
        if "temperature" in body:
            message = {"content": "I can calculate this"}
        elif any(m["role"] == "tool" for m in body["messages"]):
            message = {"content": "42"}
        else:
            message = {
                "content": None,
                "tool_calls": [
                    {
                        "id": "arithmetic-1",
                        "type": "function",
                        "function": {
                            "name": "calculator",
                            "arguments": '{"expression":"6*7"}',
                        },
                    }
                ],
            }
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": message,
                        "finish_reason": "tool_calls"
                        if "tool_calls" in message
                        else "stop",
                    }
                ]
            },
        )

    engine = VLLMEngine(host="https://gateway.firboai.app")
    engine._client.close()
    engine._client = httpx.Client(
        base_url=engine._host, transport=httpx.MockTransport(handle)
    )
    agent = OrchestratorAgent(
        engine,
        "firbo-quality",
        tools=[CalculatorTool()],
        temperature=0.7,
        max_tokens=256,
        max_turns=3,
    )
    request = ChatCompletionRequest(
        model="firbo-quality",
        messages=[{"role": "user", "content": "Use calculator to calculate 6*7"}],
        firbo_include_execution=True,
    )
    try:
        response = _handle_agent(agent, "firbo-quality", request).model_dump()
    finally:
        engine.close()
    receipt = response["execution"]
    assert receipt["tool_count"] == 1
    assert receipt["failed_count"] == 0
    assert receipt["tools"][0]["name"] == "calculator"
    assert receipt["tools"][0]["output"].strip() == "42.0"
    assert len(seen) == 2
    assert all("temperature" not in body for body in seen)
