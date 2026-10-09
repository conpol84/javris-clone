"""Explicit FIRBO output budgets across native-agent turns and continuations.

This bounds dispatched generation limits and verifies reported usage. It is not
a provider invoice, input-token reservation, or a budget for model-using tools.
"""

from __future__ import annotations

import threading
from contextlib import contextmanager


class OutputBudgetError(RuntimeError):
    """Fixed diagnostic codes only; callers must not replay ambiguous work."""


def requested_budget(request):
    if (
        not request.firbo_include_execution
        or "max_tokens" not in request.model_fields_set
    ):
        return None
    cap = request.max_tokens
    if type(cap) is not int or not 1 <= cap <= 100_000:
        raise OutputBudgetError("invalid_output_budget")
    return cap


class BudgetEngine:
    """One request, one underlying engine; no retry after uncertain dispatch."""

    def __init__(self, engine, cap):
        if type(cap) is not int or not 1 <= cap <= 100_000:
            raise OutputBudgetError("invalid_output_budget")
        self._engine = engine
        self.remaining = cap
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.calls = 0
        self.uncertain = False
        self._lock = threading.Lock()

    @property
    def engine_id(self):
        return getattr(self._engine, "engine_id", "")

    @property
    def _publishes_events(self):
        return getattr(self._engine, "_publishes_events", False)

    def generate(self, messages, **kwargs):
        if not self._lock.acquire(blocking=False):
            raise OutputBudgetError("concurrent_budget_dispatch")
        try:
            if self.uncertain:
                raise OutputBudgetError("output_usage_uncertain")
            if self.remaining < 1 or self.calls >= 100:
                raise OutputBudgetError("output_budget_exhausted")
            requested = kwargs.get("max_tokens")
            if type(requested) is not int or requested < 1:
                raise OutputBudgetError("invalid_generation_limit")
            allocation = min(requested, self.remaining)
            kwargs["max_tokens"] = allocation
            self.remaining -= allocation
            self.uncertain = True
            self.calls += 1
            result = self._engine.generate(messages, **kwargs)
            usage = result.get("usage") if isinstance(result, dict) else None
            if not isinstance(usage, dict):
                raise OutputBudgetError("output_usage_missing")
            prompt = usage.get("prompt_tokens")
            completion = usage.get("completion_tokens")
            if (
                type(prompt) is not int
                or not 0 <= prompt <= 1_000_000_000
                or type(completion) is not int
                or not 0 <= completion <= allocation
            ):
                raise OutputBudgetError("output_usage_invalid")
            if "total_tokens" in usage and (
                type(usage["total_tokens"]) is not int
                or usage["total_tokens"] != prompt + completion
            ):
                raise OutputBudgetError("output_usage_invalid")
            self.prompt_tokens += prompt
            self.completion_tokens += completion
            self.remaining += allocation - completion
            self.uncertain = False
            return result
        finally:
            self._lock.release()

    def usage(self):
        if self.uncertain or self.calls == 0:
            raise OutputBudgetError("output_usage_unverified")
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.prompt_tokens + self.completion_tokens,
        }


def supports_budget(agent):
    from openjarvis.agents.orchestrator import OrchestratorAgent

    # Other implementations may bypass _engine.generate, spawn subagents, or
    # retain another engine reference. Do not advertise unverified coverage.
    return type(agent) is OrchestratorAgent


@contextmanager
def agent_output_budget(agent, request):
    """Caller holds the agent model lock for swap/run/usage/restore."""
    cap = requested_budget(request)
    if cap is None:
        yield None
        return
    if not supports_budget(agent):
        raise OutputBudgetError("unsupported_budget_agent")
    engine, tokens = agent._engine, agent._max_tokens
    bounded = BudgetEngine(engine, cap)
    agent._engine, agent._max_tokens = bounded, cap
    try:
        yield bounded
    finally:
        agent._engine, agent._max_tokens = engine, tokens
