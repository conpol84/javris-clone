"""Actual native agent/HTTP handlers, fake inference only; never paid work."""

import asyncio
import threading
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from openjarvis.agents.orchestrator import OrchestratorAgent
from openjarvis.server.models import ChatCompletionRequest
from openjarvis.server.output_budget import BudgetEngine, OutputBudgetError
from openjarvis.server.routes import _handle_agent, chat_completions, server_info


def completion(tokens, content="answer", finish="stop"):
    return {
        "content": content,
        "finish_reason": finish,
        "usage": {"prompt_tokens": 12, "completion_tokens": tokens},
    }


class Engine:
    engine_id = "fixture"

    def __init__(self, results):
        self.results = iter(results)
        self.limits = []

    def generate(self, messages, **kwargs):
        self.limits.append(kwargs["max_tokens"])
        result = next(self.results)
        if isinstance(result, Exception):
            raise result
        return result


def agent(engine):
    return OrchestratorAgent(
        engine,
        "original",
        tools=[],
        temperature=0,
        max_tokens=1024,
        max_turns=3,
        system_prompt="Fixture",
    )


def request(cap=10, **kwargs):
    return ChatCompletionRequest(
        model="chosen",
        messages=[{"role": "user", "content": "hi"}],
        firbo_include_execution=True,
        max_tokens=cap,
        **kwargs,
    )


def test_real_continuations_share_one_budget_and_return_complete_usage():
    engine = Engine(
        [
            completion(4, "one", "length"),
            completion(3, "two", "length"),
            completion(2, "three"),
        ]
    )
    native = agent(engine)
    result = _handle_agent(native, "chosen", request())
    assert engine.limits == [10, 6, 3]
    assert result.choices[0].message.content == "onetwothree"
    assert result.usage.completion_tokens == 9
    assert result.usage.prompt_tokens == 36
    assert result.usage.total_tokens == 45
    assert native._engine is engine
    assert native._max_tokens == 1024
    assert native._model == "original"


def test_exhausted_continuation_never_dispatches_again_and_restores_agent():
    engine = Engine([completion(10, finish="length"), completion(1)])
    native = agent(engine)
    with pytest.raises(HTTPException) as exc:
        _handle_agent(native, "chosen", request())
    assert exc.value.detail == "output_budget_exhausted"
    assert engine.limits == [10]
    assert native._engine is engine and native._max_tokens == 1024
    assert native._model == "original"


@pytest.mark.parametrize(
    "usage",
    [
        None,
        {},
        {"prompt_tokens": 1},
        {"prompt_tokens": 1, "completion_tokens": -1},
        {"prompt_tokens": 1, "completion_tokens": True},
        {"prompt_tokens": 1, "completion_tokens": 11},
        {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 99},
    ],
)
def test_unknown_usage_permanently_blocks_further_dispatch(usage):
    engine = Engine([{"content": "not evidence", "usage": usage}, completion(1)])
    bounded = BudgetEngine(engine, 10)
    with pytest.raises(OutputBudgetError):
        bounded.generate([], max_tokens=10)
    with pytest.raises(OutputBudgetError, match="uncertain"):
        bounded.generate([], max_tokens=10)
    assert engine.limits == [10]


def test_provider_failure_is_never_retried():
    engine = Engine([TimeoutError("do not expose me"), completion(1)])
    bounded = BudgetEngine(engine, 10)
    with pytest.raises(TimeoutError):
        bounded.generate([], max_tokens=10)
    with pytest.raises(OutputBudgetError, match="uncertain"):
        bounded.generate([], max_tokens=10)
    assert len(engine.limits) == 1


def test_plain_request_without_explicit_cap_retains_legacy_behavior():
    engine = Engine([{"content": "legacy", "usage": {}}])
    native = agent(engine)
    req = ChatCompletionRequest(
        model="chosen",
        messages=[{"role": "user", "content": "hi"}],
        firbo_include_execution=True,
    )
    assert _handle_agent(native, "chosen", req).choices[0].message.content == "legacy"
    assert engine.limits == [1024]


def test_complexity_cannot_raise_an_explicit_execution_cap(monkeypatch):
    from openjarvis.learning.routing import complexity

    monkeypatch.setattr(
        complexity,
        "score_complexity",
        lambda _: SimpleNamespace(suggested_max_tokens=9999, score=1.0, tier="complex"),
    )
    monkeypatch.setattr(complexity, "adjust_tokens_for_model", lambda n, _: n)
    engine = Engine([completion(2)])
    native = agent(engine)
    state = SimpleNamespace(
        engine=engine,
        agent=native,
        config=None,
        bus=None,
        trace_store=None,
        model="chosen",
    )
    req = request()
    result = asyncio.run(
        chat_completions(req, SimpleNamespace(app=SimpleNamespace(state=state)))
    )
    assert req.max_tokens == 10
    assert result.usage.completion_tokens == 2
    assert engine.limits == [10]


@pytest.mark.parametrize(
    "extra",
    [
        {"stream": True},
        {
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "no_dispatch",
                        "parameters": {"type": "object"},
                    },
                }
            ]
        },
    ],
)
def test_unsupported_routes_reject_before_any_generation(extra):
    engine = Engine([completion(1)])
    state = SimpleNamespace(engine=engine, agent=agent(engine))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            chat_completions(
                request(**extra), SimpleNamespace(app=SimpleNamespace(state=state))
            )
        )
    assert exc.value.status_code == 400
    assert engine.limits == []


def test_concurrent_requests_restore_engine_model_and_budget():
    engine = Engine([completion(1) for _ in range(8)])
    native = agent(engine)
    errors = []

    def run(cap):
        try:
            assert (
                _handle_agent(native, str(cap), request(cap)).usage.completion_tokens
                == 1
            )
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=run, args=(cap,)) for cap in range(2, 10)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
        assert not thread.is_alive()
    assert not errors
    assert sorted(engine.limits) == list(range(2, 10))
    assert native._engine is engine and native._model == "original"
    assert native._max_tokens == 1024


def test_info_advertises_native_scope_without_input_or_invoice_claim():
    native = agent(Engine([]))
    state = SimpleNamespace(agent=native, model="m", engine_name="multi")
    result = asyncio.run(server_info(SimpleNamespace(app=SimpleNamespace(state=state))))
    assert result["output_budget"]["supported"] is True
    assert result["output_budget"]["input_budget"] is False


def test_actual_tool_turn_and_continuation_are_all_accounted():
    from openjarvis.tools.calculator import CalculatorTool

    first = completion(3)
    first["tool_calls"] = [
        {
            "id": "one",
            "name": "calculator",
            "arguments": '{"expression":"2+2"}',
        }
    ]
    engine = Engine([first, completion(2, "four", "length"), completion(1, "!")])
    native = OrchestratorAgent(
        engine,
        "original",
        tools=[CalculatorTool()],
        temperature=0,
        max_tokens=1024,
        max_turns=3,
        system_prompt="Fixture",
    )
    result = _handle_agent(native, "chosen", request())
    assert engine.limits == [10, 7, 5]
    assert result.usage.completion_tokens == 6
    assert result.usage.prompt_tokens == 36
    assert result.execution["tool_count"] == 1
    assert result.execution["failed_count"] == 0


@pytest.mark.parametrize("cap", [0, -1, 100001])
def test_invalid_execution_cap_never_runs_engine(cap):
    engine = Engine([completion(1)])
    state = SimpleNamespace(engine=engine, agent=agent(engine))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            chat_completions(
                request(cap), SimpleNamespace(app=SimpleNamespace(state=state))
            )
        )
    assert exc.value.status_code == 400
    assert engine.limits == []
