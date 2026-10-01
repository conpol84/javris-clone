"""Tests for the OmniRoute gateway overview proxy."""

from __future__ import annotations

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from openjarvis.server import gateway_routes
from openjarvis.server.gateway_routes import router

HOST = "http://omni.test:20128"


@pytest.fixture(autouse=True)
def _env(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("OMNIROUTE_HOST", HOST)
    monkeypatch.setenv("OMNIROUTE_MANAGEMENT_KEY", "sk-manage")
    monkeypatch.delenv("OMNIROUTE_API_KEY", raising=False)
    gateway_routes._cache.update({"at": 0.0, "key": "", "value": None})
    yield


@pytest.fixture()
def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _mock_all() -> None:
    respx.get(f"{HOST}/api/health").mock(
        return_value=httpx.Response(200, json={"status": "ok"})
    )
    respx.get(f"{HOST}/v1/models").mock(
        return_value=httpx.Response(
            200,
            json={
                "data": [
                    {"id": "auto", "owned_by": "combo"},
                    {"id": "openai/gpt-x", "owned_by": "openai"},
                    {"id": "openai/gpt-y", "owned_by": "openai"},
                    {"id": "claude/sonnet", "owned_by": "claude"},
                ]
            },
        )
    )
    respx.get(f"{HOST}/api/providers").mock(
        return_value=httpx.Response(
            200,
            json={
                "connections": [
                    {
                        "provider": "openai",
                        "isActive": True,
                        "testStatus": "active",
                        "apiKey": "sk-secret",
                        "email": "me@example.com",
                        "name": "My Account",
                    },
                    {"provider": "openai", "isActive": False, "testStatus": "error"},
                    {
                        "provider": "groq",
                        "isActive": True,
                        "rateLimitedUntil": 9_999_999_999_999,
                    },
                ]
            },
        )
    )
    respx.get(f"{HOST}/api/combos").mock(
        return_value=httpx.Response(
            200,
            json={
                "combos": [
                    {"name": "dev", "strategy": "cost-optimized", "models": [1, 2]}
                ]
            },
        )
    )
    respx.get(f"{HOST}/api/provider-stats").mock(
        return_value=httpx.Response(
            200,
            json={
                "providers": [
                    {
                        "provider": "OpenAI",
                        "totalRequests": 10,
                        "successfulRequests": 9,
                        "avgLatencyMs": 420,
                        "totalTokensIn": 100,
                        "totalTokensOut": 50,
                    }
                ]
            },
        )
    )


@respx.mock
def test_overview_normalizes_and_hides_secrets(client: TestClient) -> None:
    _mock_all()
    body = client.get("/v1/gateway/overview").json()

    assert body["connected"] is True
    assert body["has_key"] is True
    assert body["models"]["total"] == 3
    assert body["models"]["providers"][0] == {"provider": "openai", "models": 2}
    assert body["models"]["combo_ids"] == ["auto"]
    openai = next(c for c in body["connections"] if c["provider"] == "openai")
    assert openai == {
        "provider": "openai",
        "connections": 2,
        "active": 1,
        "healthy": 1,
        "limited": 0,
    }
    groq = next(c for c in body["connections"] if c["provider"] == "groq")
    assert groq["limited"] == 1
    assert body["combos"] == [{"name": "dev", "strategy": "cost-optimized", "steps": 2}]
    assert body["stats"][0]["success_rate"] == 0.9
    assert body["errors"] == {}
    dumped = str(body)
    for secret in ("sk-secret", "me@example.com", "My Account", "sk-manage"):
        assert secret not in dumped


@respx.mock
def test_sends_management_bearer_token(client: TestClient) -> None:
    _mock_all()
    client.get("/v1/gateway/overview")
    sent = respx.calls.last.request.headers["authorization"]
    assert sent == "Bearer sk-manage"


@respx.mock
def test_degrades_gracefully_when_gateway_is_down(client: TestClient) -> None:
    respx.route(host="omni.test").mock(side_effect=httpx.ConnectError("refused"))
    body = client.get("/v1/gateway/overview").json()
    assert body["connected"] is False
    assert body["models"]["total"] == 0
    assert body["connections"] == []
    assert set(body["errors"]) == {"health", "models", "providers", "combos", "stats"}


@respx.mock
def test_reports_unauthorized_management_calls(client: TestClient) -> None:
    _mock_all()
    respx.get(f"{HOST}/api/providers").mock(return_value=httpx.Response(401))
    body = client.get("/v1/gateway/overview").json()
    assert body["connected"] is True
    assert body["errors"] == {"providers": "unauthorized"}
    assert body["connections"] == []


@respx.mock
def test_host_with_v1_suffix_is_normalized(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OMNIROUTE_HOST", HOST + "/v1")
    _mock_all()
    assert client.get("/v1/gateway/overview").json()["connected"] is True


class TestSupabaseAuth:
    """Browsers authenticate with their Firbo (Supabase) session, not the server API key."""

    @pytest.fixture(autouse=True)
    def _supabase(self, monkeypatch: pytest.MonkeyPatch):
        monkeypatch.setenv("SUPABASE_URL", "https://proj.supabase.test")
        monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "sb_publishable_x")
        gateway_routes._tokens.clear()
        yield
        gateway_routes._tokens.clear()

    @respx.mock
    def test_rejects_missing_token(self, client: TestClient):
        assert client.get("/v1/gateway/overview").status_code == 401

    @respx.mock
    def test_rejects_invalid_token(self, client: TestClient):
        respx.get("https://proj.supabase.test/auth/v1/user").mock(
            return_value=httpx.Response(401, json={"msg": "bad"})
        )
        resp = client.get(
            "/v1/gateway/overview", headers={"Authorization": "Bearer nope"}
        )
        assert resp.status_code == 401

    @respx.mock
    def test_accepts_valid_session_and_caches_it(self, client: TestClient):
        route = respx.get("https://proj.supabase.test/auth/v1/user").mock(
            return_value=httpx.Response(200, json={"id": "u1"})
        )
        _mock_all()
        headers = {"Authorization": "Bearer good"}
        assert client.get("/v1/gateway/overview", headers=headers).status_code == 200
        assert client.get("/v1/gateway/overview", headers=headers).status_code == 200
        assert route.call_count == 1  # second call served from the 60s token cache

    @respx.mock
    def test_auth_service_down_is_503_not_open(self, client: TestClient):
        respx.get("https://proj.supabase.test/auth/v1/user").mock(
            side_effect=httpx.ConnectError("down")
        )
        resp = client.get(
            "/v1/gateway/overview", headers={"Authorization": "Bearer good"}
        )
        assert resp.status_code == 503

    def test_api_key_middleware_defers_to_supabase_for_gateway_only(self):
        from openjarvis.server.auth_middleware import AuthMiddleware

        assert AuthMiddleware._requires_auth("/v1/gateway/overview") is False
        assert AuthMiddleware._requires_auth("/v1/chat/completions") is True
