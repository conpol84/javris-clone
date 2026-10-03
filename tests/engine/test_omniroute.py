"""Tests for the OmniRoute gateway engine backend."""

from __future__ import annotations

import httpx
import pytest
import respx

from openjarvis.core.config import JarvisConfig
from openjarvis.core.registry import EngineRegistry
from openjarvis.core.types import Message, Role
from openjarvis.engine._discovery import _make_engine
from openjarvis.engine.openai_compat_engines import OmniRouteEngine


@pytest.fixture()
def engine() -> OmniRouteEngine:
    EngineRegistry.register_value("omniroute", OmniRouteEngine)
    return OmniRouteEngine(host="http://testhost:20128", api_key="sk-test")


class TestOmniRouteEngineBasics:
    def test_engine_id(self) -> None:
        assert OmniRouteEngine.engine_id == "omniroute"

    def test_default_host(self) -> None:
        assert OmniRouteEngine._default_host == "http://localhost:20128"

    def test_api_prefix(self) -> None:
        assert OmniRouteEngine._api_prefix == "/v1"

    def test_env_overrides(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("OMNIROUTE_HOST", "http://gateway:20128")
        monkeypatch.setenv("OMNIROUTE_API_KEY", "sk-env")
        eng = OmniRouteEngine()
        try:
            assert eng._host == "http://gateway:20128"
            assert eng._api_key == "sk-env"
        finally:
            eng.close()

    def test_config_host_is_used_by_discovery(self) -> None:
        EngineRegistry.register_value("omniroute", OmniRouteEngine)
        cfg = JarvisConfig()
        cfg.engine.omniroute.host = "http://cfg-host:20128"
        eng = _make_engine("omniroute", cfg)
        try:
            assert eng._host == "http://cfg-host:20128"
        finally:
            eng.close()


class TestOmniRouteRequests:
    @respx.mock
    def test_generate_sends_bearer_and_v1_path(self, engine: OmniRouteEngine) -> None:
        route = respx.post("http://testhost:20128/v1/chat/completions").mock(
            return_value=httpx.Response(
                200,
                json={
                    "choices": [
                        {"message": {"content": "hi"}, "finish_reason": "stop"}
                    ],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                },
            )
        )
        result = engine.generate(
            [Message(role=Role.USER, content="hello")], model="auto"
        )
        assert result["content"] == "hi"
        assert route.calls.last.request.headers["authorization"] == "Bearer sk-test"
