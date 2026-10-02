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


class TestExtraEndpoints:
    @pytest.fixture(autouse=True)
    def _clear(self):
        gateway_routes._extra_cache.clear()
        yield
        gateway_routes._extra_cache.clear()

    @respx.mock
    def test_usage_is_normalized_and_secret_free(self, client: TestClient):
        respx.get(f"{HOST}/api/usage/analytics").mock(
            return_value=httpx.Response(
                200,
                json={
                    "summary": {
                        "totalRequests": 10,
                        "promptTokens": 1000,
                        "completionTokens": 500,
                        "successRatePct": 90,
                        "avgLatencyMs": 812.4,
                        "totalCost": 0.1234567,
                        "fallbackCount": 2,
                    },
                    "byModel": [
                        {"model": "gpt-x", "provider": "openai", "requests": 6, "totalTokens": 900, "cost": 0.05, "avgLatencyMs": 700, "apiKeyName": "secret-name"}
                    ],
                    "byProvider": [{"provider": "openai", "requests": 6, "totalTokens": 900, "cost": 0.05}],
                    "dailyTrend": [{"date": "2026-10-01", "requests": 4, "totalTokens": 400, "cost": 0.02}],
                    "byApiKey": [{"name": "should-not-leak", "key": "sk-leak"}],
                },
            )
        )
        body = client.get("/v1/gateway/usage?range=30d").json()
        assert body["available"] and body["range"] == "30d"
        assert body["requests"] == 10 and body["tokens_in"] == 1000 and body["cost"] == 0.1235
        assert body["success_rate"] == 0.9 and body["fallbacks"] == 2
        assert body["models"][0] == {"model": "gpt-x", "provider": "openai", "requests": 6, "tokens": 900, "cost": 0.05, "avg_latency_ms": 700}
        assert "sk-leak" not in str(body) and "should-not-leak" not in str(body)

    @respx.mock
    def test_usage_rejects_unknown_range_and_reports_unauthorized(self, client: TestClient):
        route = respx.get(f"{HOST}/api/usage/analytics").mock(return_value=httpx.Response(401))
        body = client.get("/v1/gateway/usage?range=bogus").json()
        assert body["range"] == "7d" and body["available"] is False and body["error"] == "unauthorized"
        assert route.calls[0].request.url.params["range"] == "7d"

    @respx.mock
    def test_calls_are_trimmed_to_metadata(self, client: TestClient):
        respx.get(f"{HOST}/api/usage/call-logs").mock(
            return_value=httpx.Response(
                200,
                json=[
                    {"id": "1", "timestamp": "2026-10-01T10:00:00Z", "providerDisplay": "OpenAI", "provider": "openai", "model": "gpt-x", "status": 200, "duration": 900, "tokens": {"in": 10, "out": 20}, "comboName": None, "requestBody": {"secret": "prompt"}},
                    {"id": "2", "timestamp": "2026-10-01T10:01:00Z", "provider": "groq", "model": "m", "status": 429, "duration": 50, "tokens": {"in": 1, "out": 0}, "error": "rate"},
                ],
            )
        )
        calls = client.get("/v1/gateway/calls?limit=999").json()["calls"]
        assert [c["provider"] for c in calls] == ["OpenAI", "groq"]
        assert calls[0]["tokens_out"] == 20 and calls[1]["failed"] is True
        assert "prompt" not in str(calls)

    @respx.mock
    def test_free_models_listing(self, client: TestClient):
        respx.get(f"{HOST}/api/free-models").mock(
            return_value=httpx.Response(
                200,
                json={"models": [{"provider": "groq", "modelId": "llama", "displayName": "Llama", "monthlyTokens": 1000000, "freeType": "monthly", "tos": "x"}]},
            )
        )
        body = client.get("/v1/gateway/free-models").json()
        assert body["models"] == [{"provider": "groq", "model": "llama", "name": "Llama", "monthly_tokens": 1000000, "free_type": "monthly"}]

    @respx.mock
    def test_quota_is_normalized_and_names_come_from_connections(self, client: TestClient):
        respx.get(f"{HOST}/api/usage/provider-limits").mock(
            return_value=httpx.Response(
                200,
                json={
                    "caches": {
                        "c1": {
                            "quotas": {
                                "daily": {"remainingPercentage": 42.04, "resetAt": "2026-10-02T00:00:00Z"},
                                "tokens": {"used": 10, "total": 100, "remaining": 90},
                                "free": {"unlimited": True},
                            },
                            "plan": {"name": "Pro", "token": "secret-token"},
                            "fetchedAt": "2026-10-01T10:00:00Z",
                        },
                        "c2": {"quotas": None},
                    }
                },
            )
        )
        respx.get(f"{HOST}/api/providers").mock(
            return_value=httpx.Response(200, json={"connections": [{"id": "c1", "provider": "openai", "name": "Main", "apiKey": "sk-leak"}]})
        )
        body = client.get("/v1/gateway/quota").json()
        assert body["available"] and len(body["providers"]) == 1
        p = body["providers"][0]
        assert p["provider"] == "openai" and p["name"] == "Main" and p["plan"] == "Pro"
        w = {x["name"]: x for x in p["windows"]}
        assert w["daily"]["remaining_pct"] == 42.0 and w["daily"]["reset_at"]
        assert w["tokens"]["remaining_pct"] == 90.0
        assert w["free"]["unlimited"] is True
        assert "sk-leak" not in str(body) and "secret-token" not in str(body)

    @respx.mock
    def test_keys_never_include_key_values(self, client: TestClient):
        respx.get(f"{HOST}/api/keys").mock(
            return_value=httpx.Response(
                200,
                json={"keys": [{"id": "k1", "name": "agent-ceo", "key": "sk-or-abc", "isActive": False, "createdAt": "2026-10-01", "maxRequestsPerDay": 500}]},
            )
        )
        body = client.get("/v1/gateway/keys").json()
        assert body["keys"] == [
            {"id": "k1", "name": "agent-ceo", "active": False, "created_at": "2026-10-01", "max_per_day": 500, "max_per_minute": None, "expires_at": None}
        ]
        assert "sk-or-abc" not in str(body)
