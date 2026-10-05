"""Real ASGI app + auth dependency and actual SQLite/HTTP engine. All remote data synthetic."""

# Use the established isolated module loader without initializing legacy OpenJarvis.
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from test_control_plane import ORG, USER, AsyncClient, load

f = load("free_inference")
a = load("firbo_free_app")


@pytest.fixture
def app_env(monkeypatch, tmp_path):
    for name, value in {
        "SUPABASE_URL": "https://identity.test",
        "SUPABASE_PUBLISHABLE_KEY": "test-public",
        "FIRBO_FREE_ENABLED": "true",
        "FIRBO_FREE_ORGANIZATIONS": ORG,
    }.items():
        monkeypatch.setenv(name, value)
    state = {"requests": [], "role": "member", "identity": USER, "org": ORG}

    def handler(req):
        state["requests"].append(req)
        if req.url.host == "identity.test":
            if req.headers.get("authorization") != "Bearer synthetic-user":
                return httpx.Response(401, json={})
            if req.url.path == "/auth/v1/user":
                return httpx.Response(200, json={"id": USER})
            assert req.url.params.get("user_id") == "eq." + USER
            assert req.url.params.get("organization_id") == "eq." + ORG
            return httpx.Response(
                200,
                json=[
                    {
                        "user_id": state["identity"],
                        "organization_id": state["org"],
                        "role": state["role"],
                    }
                ],
            )
        assert req.url.host == "firbo-ollama"
        return httpx.Response(
            200,
            json={
                "model": "qwen3:1.7b",
                "done": True,
                "message": {"content": "Local result"},
                "prompt_eval_count": 4,
                "eval_count": 3,
            },
        )

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: AsyncClient(
            transport=kw.pop("transport", None) or transport, **kw
        ),
    )
    tmp_path.chmod(0o700)
    engine = f.FreeEngine(
        [f.Route("ollama", "qwen3:1.7b")], f.Ledger(str(tmp_path / "db"))
    )
    monkeypatch.setattr(a, "engine", lambda: engine)
    with TestClient(a.create_free_app()) as client:
        yield client, state


def payload():
    return {
        "organization_id": ORG,
        "request_id": str(uuid4()),
        "messages": [{"role": "user", "content": "Hello"}],
    }


AUTH = {"authorization": "Bearer synthetic-user"}


def test_free_endpoint_requires_real_auth_dependency(app_env):
    client, state = app_env
    assert (
        client.post("/v1/firbo/free/chat/completions", json=payload()).status_code
        == 401
    )
    assert state["requests"] == []


def test_success_is_user_org_bound_and_no_store(app_env):
    client, state = app_env
    p = payload()
    r = client.post("/v1/firbo/free/chat/completions", json=p, headers=AUTH)
    assert r.status_code == 200 and r.json()["firbo"]["request_id"] == p["request_id"]
    assert r.headers["cache-control"] == "no-store"
    assert (
        client.post("/v1/firbo/free/chat/completions", json=p, headers=AUTH).status_code
        == 409
    )
    assert (
        len([req for req in state["requests"] if req.url.host == "firbo-ollama"]) == 1
    )


@pytest.mark.parametrize(
    "change",
    [
        {"role": "viewer"},
        {"identity": "99999999-9999-4999-8999-999999999999"},
        {"org": "99999999-9999-4999-8999-999999999999"},
    ],
)
def test_wrong_membership_cannot_use_local_compute(app_env, change):
    client, state = app_env
    state.update(change)
    assert (
        client.post(
            "/v1/firbo/free/chat/completions", json=payload(), headers=AUTH
        ).status_code
        == 403
    )
    assert all(req.url.host == "identity.test" for req in state["requests"])


@pytest.mark.parametrize(
    "extra",
    [
        {"model": "paid/model"},
        {"cloud_allowed": True},
        {"url": "http://evil"},
        {"tools": [{}]},
    ],
)
def test_client_cannot_choose_provider_or_external_transfer(app_env, extra):
    client, state = app_env
    assert (
        client.post(
            "/v1/firbo/free/chat/completions", json={**payload(), **extra}, headers=AUTH
        ).status_code
        == 422
    )
    assert all(req.url.host == "identity.test" for req in state["requests"])


def test_disabled_feature_does_not_open_route(app_env, monkeypatch):
    client, state = app_env
    monkeypatch.delenv("FIRBO_FREE_ENABLED")
    assert (
        client.post(
            "/v1/firbo/free/chat/completions", json=payload(), headers=AUTH
        ).status_code
        == 503
    )
    assert all(req.url.host == "identity.test" for req in state["requests"])


def test_unenabled_company_is_denied(app_env, monkeypatch):
    client, state = app_env
    monkeypatch.delenv("FIRBO_FREE_ORGANIZATIONS")
    assert (
        client.post(
            "/v1/firbo/free/chat/completions", json=payload(), headers=AUTH
        ).status_code
        == 403
    )
    assert all(req.url.host == "identity.test" for req in state["requests"])


@pytest.mark.parametrize("admin", [False, True])
def test_existing_platform_admin_can_opt_into_local_pilot_only(
    app_env, monkeypatch, admin
):
    client, state = app_env
    monkeypatch.setenv("FIRBO_FREE_ORGANIZATIONS", "")
    monkeypatch.setenv("FIRBO_FREE_ADMIN_PILOT", "true")

    async def permitted(p):
        return admin

    monkeypatch.setattr(a, "_platform_admin", permitted)
    response = client.post(
        "/v1/firbo/free/chat/completions", json=payload(), headers=AUTH
    )
    assert response.status_code == (200 if admin else 403)
    if not admin:
        assert all(req.url.host == "identity.test" for req in state["requests"])


def test_admin_pilot_still_requires_actual_company_membership(app_env, monkeypatch):
    client, state = app_env
    state["role"] = "viewer"
    monkeypatch.setenv("FIRBO_FREE_ORGANIZATIONS", "")
    monkeypatch.setenv("FIRBO_FREE_ADMIN_PILOT", "true")

    async def permitted(p):
        return True

    monkeypatch.setattr(a, "_platform_admin", permitted)
    assert (
        client.post(
            "/v1/firbo/free/chat/completions", json=payload(), headers=AUTH
        ).status_code
        == 403
    )
    assert all(req.url.host == "identity.test" for req in state["requests"])


def test_status_requires_auth_before_any_upstream(app_env):
    client, state = app_env
    assert client.get("/v1/firbo/free/status").status_code == 401
    assert state["requests"] == []


@pytest.mark.parametrize("digest,ready", [("a" * 64, True), ("b" * 64, False)])
def test_status_checks_exact_model_digest_without_inference(monkeypatch, digest, ready):
    state = []

    def handle(req):
        state.append(req)
        if req.url.host == "identity.test":
            if req.url.path == "/auth/v1/user":
                return httpx.Response(200, json={"id": USER})
            if req.url.path.endswith("/is_platform_admin"):
                return httpx.Response(200, json=True)
        assert (
            req.url.host == "firbo-ollama"
            and req.url.path == "/api/tags"
            and req.method == "GET"
        )
        return httpx.Response(
            200, json={"models": [{"name": "qwen3:1.7b", "digest": "a" * 64}]}
        )

    monkeypatch.setenv("SUPABASE_URL", "https://identity.test")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "test")
    monkeypatch.setenv("FIRBO_FREE_ENABLED", "true")
    monkeypatch.setenv("FIRBO_FREE_MODEL_DIGEST", digest)
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kw: AsyncClient(transport=httpx.MockTransport(handle), **kw),
    )
    with TestClient(a.create_free_app()) as c:
        r = c.get("/v1/firbo/free/status", headers=AUTH)
    assert r.status_code == 200 and r.json()["ready"] == ready
    assert r.json()["scope"] == "platform-admin-pilot" and r.json()["parallel"] == 1
    assert all(x.url.path != "/api/chat" for x in state)


def test_two_cpu_engine_defaults_are_bounded(monkeypatch, tmp_path):
    monkeypatch.setenv("FIRBO_FREE_LOCAL_MODELS", "qwen3:1.7b")
    monkeypatch.setenv("FIRBO_FREE_OPENROUTER_MODELS", "")
    tmp_path.chmod(0o700)
    monkeypatch.setenv("FIRBO_FREE_LEDGER", str(tmp_path / "db"))
    a.engine.cache_clear()
    e = a.engine()
    assert (
        e.max_output,
        e.context_tokens,
        e.threads,
        e.ledger.limits.global_parallel,
    ) == (128, 2048, 1, 1)
    a.engine.cache_clear()
