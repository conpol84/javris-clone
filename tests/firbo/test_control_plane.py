"""Isolated control-plane regression tests. No network, real accounts or AI spend."""

import importlib.util
import json
import sqlite3
import sys
import types
from pathlib import Path

import httpx
import pytest
from fastapi import APIRouter, HTTPException
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src" / "openjarvis" / "server"

# These tests need a tiny OpenJarvis package surface so importing the Firbo
# control plane does not initialise the unrelated desktop engine. Keep that
# isolation private to each load: never leave fake openjarvis modules in
# sys.modules, because pytest collects the rest of the real OpenJarvis suite
# in the same interpreter.
_isolated_modules: dict[str, types.ModuleType] = {}

legacy = types.ModuleType("openjarvis.server.gateway_routes")
legacy.router = APIRouter(prefix="/v1/gateway")


@legacy.router.get("/usage")
async def old_usage():
    return {"global_cost": 999}


@legacy.router.post("/playground")
async def old_playground():
    return {"reply": "mock"}


_isolated_modules[legacy.__name__] = legacy


def _snapshot_openjarvis() -> dict[str, types.ModuleType]:
    return {
        name: module
        for name, module in sys.modules.items()
        if name == "openjarvis" or name.startswith("openjarvis.")
    }


def _restore_openjarvis(snapshot: dict[str, types.ModuleType]) -> None:
    for name in [
        key
        for key in tuple(sys.modules)
        if key == "openjarvis" or key.startswith("openjarvis.")
    ]:
        sys.modules.pop(name, None)
    sys.modules.update(snapshot)


def _install_isolated_modules() -> None:
    package = types.ModuleType("openjarvis")
    package.__path__ = [str(SOURCE.parent)]
    server = types.ModuleType("openjarvis.server")
    server.__path__ = [str(SOURCE)]
    sys.modules["openjarvis"] = package
    sys.modules["openjarvis.server"] = server
    sys.modules.update(_isolated_modules)


def load(name):
    snapshot = _snapshot_openjarvis()
    try:
        _install_isolated_modules()
        full = "openjarvis.server." + name
        spec = importlib.util.spec_from_file_location(full, SOURCE / f"{name}.py")
        if spec is None or spec.loader is None:
            raise ImportError(full)
        module = importlib.util.module_from_spec(spec)
        sys.modules[full] = module
        spec.loader.exec_module(module)
        _isolated_modules[full] = module
        return module
    finally:
        _restore_openjarvis(snapshot)


control = load("firbo_control")
application = load("firbo_app")
USER = "11111111-1111-4111-8111-111111111111"
ORG = "22222222-2222-4222-8222-222222222222"
AsyncClient = httpx.AsyncClient


@pytest.fixture
def env(monkeypatch, tmp_path):
    settings = {"SUPABASE_URL": "https://supabase.test", "SUPABASE_PUBLISHABLE_KEY": "public-test-key",
                "OMNIROUTE_HOST": "http://omniroute:20128", "OMNIROUTE_MANAGEMENT_KEY": "private-test-key",
                "OPENJARVIS_CORS_ORIGINS": "https://firboai.app", "FIRBO_CONTROL_WRITES_ENABLED": "false",
                "FIRBO_CONTROL_AUDIT_DB": str(tmp_path / "audit.sqlite3")}
    for name, value in settings.items():
        monkeypatch.setenv(name, value)
    state = {"writes": [], "requests": [], "combo": {"id": "combo-1", "name": "firbo-economy", "strategy": "priority", "models": ["provider/model-a"]}}
    def handler(request):
        state["requests"].append(request)
        path = request.url.path
        if request.url.host == "supabase.test":
            token = request.headers.get("authorization")
            if token not in {"Bearer admin-token", "Bearer member-token"}:
                return httpx.Response(401, json={"error": "bad token"})
            if path == "/auth/v1/user":
                return httpx.Response(200, json={"id": USER})
            if path.endswith("is_platform_admin"):
                return httpx.Response(200, json=token == "Bearer admin-token")
            if path.endswith("organization_members"):
                assert request.url.params["user_id"] == "eq." + USER
                return httpx.Response(200, json=[{"organization_id": ORG, "role": "member", "organizations": {"id": ORG, "name": "My company"}}])
            return httpx.Response(404, json={})
        assert request.headers["authorization"] == "Bearer private-test-key"
        if path == "/api/health":
            return httpx.Response(200, json={"status": "ok"})
        if path == "/api/providers":
            return httpx.Response(200, json={"connections": [{"id": "provider-1", "provider": "provider", "name": "Production", "isActive": True, "testStatus": "active", "apiKey": "NEVER_RETURN_ME", "refreshToken": "NEVER_RETURN_ME"}]})
        if path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "provider/model-a", "owned_by": "provider"}, {"id": "provider/model-b", "owned_by": "provider"}, {"id": "firbo-economy", "owned_by": "combo"}]})
        if path == "/api/combos":
            return httpx.Response(200, json={"combos": [state["combo"]]})
        if path == "/api/combos/combo-1" and request.method == "PUT":
            state["writes"].append(request)
            state["combo"].update(json.loads(request.content))
            return httpx.Response(200, json=state["combo"])
        raise AssertionError(f"unexpected request: {request.method} {request.url}")
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(control.httpx, "AsyncClient", lambda **kwargs: AsyncClient(transport=transport, **kwargs))
    with TestClient(application.create_app()) as client:
        yield client, state, settings


def auth(admin=True):
    return {"Authorization": "Bearer admin-token" if admin else "Bearer member-token"}


def test_health_is_public_and_does_not_claim_gateway_ready(env):
    client, state, _ = env
    response = client.get("/health")
    assert response.json() == {"status": "ok", "contract": "firbo-control/v1"}
    assert not state["requests"]


@pytest.mark.parametrize("path", ["/v1/firbo/session", "/v1/firbo/control", "/v1/gateway/usage"])
def test_anonymous_rejected_before_any_upstream_call(env, path):
    client, state, _ = env
    assert client.get(path).status_code == 401
    assert not state["requests"]


@pytest.mark.parametrize("path", ["/v1/firbo/control", "/v1/gateway/usage"])
def test_member_cannot_read_global_gateway_data(env, path):
    client, state, _ = env
    assert client.get(path, headers=auth(False)).status_code == 403
    assert all(r.url.host == "supabase.test" for r in state["requests"])


def test_session_is_explicitly_user_scoped(env):
    client, _, _ = env
    response = client.get("/v1/firbo/session", headers=auth(False))
    assert response.status_code == 200
    assert response.json()["companies"] == [{"id": ORG, "name": "My company", "role": "member"}]
    assert response.json()["platform_admin"] is False


def test_admin_gets_native_sanitized_control_data(env):
    client, _, _ = env
    response = client.get("/v1/firbo/control", headers=auth())
    assert response.status_code == 200
    assert response.json()["available"] is True
    assert response.json()["writes_enabled"] is False
    assert "NEVER_RETURN_ME" not in response.text
    assert "apiKey" not in response.text and "refreshToken" not in response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]


@pytest.mark.parametrize("method", ["GET", "POST"])
def test_firbo_cors_permits_intended_methods(env, method):
    client, _, _ = env
    response = client.options("/v1/firbo/control", headers={"Origin": "https://firboai.app", "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "authorization,content-type"})
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://firboai.app"


def test_untrusted_origin_preflight_rejected(env):
    client, _, _ = env
    assert client.options("/v1/firbo/control", headers={"Origin": "https://evil.test", "Access-Control-Request-Method": "POST"}).status_code == 400


def test_writes_are_off_for_legacy_playground_too(env):
    client, _, _ = env
    assert client.post("/v1/gateway/playground", headers=auth(), json={}).status_code == 503


def update_payload(state, **changes):
    return {"expected_revision": control._revision(state["combo"]), "models": ["provider/model-b"], **changes}


def test_combo_writes_disabled_by_default(env):
    client, state, _ = env
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state)).status_code == 503
    assert not state["writes"]


def test_combo_update_is_in_place_and_read_back_verified(env, monkeypatch):
    client, state, settings = env
    monkeypatch.setenv("FIRBO_CONTROL_WRITES_ENABLED", "true")
    response = client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state))
    assert response.status_code == 200
    assert response.json()["combo"]["models"] == ["provider/model-b"]
    assert [r.method for r in state["writes"]] == ["PUT"]
    with sqlite3.connect(settings["FIRBO_CONTROL_AUDIT_DB"]) as db:
        phases = db.execute("select phase from control_events order by rowid").fetchall()
    assert phases == [("requested",), ("verified",)]


@pytest.mark.parametrize("models", [["does-not-exist"], ["firbo-economy"], ["provider/model-a", "provider/model-a"], []])
def test_unknown_nested_duplicate_and_empty_models_rejected(env, monkeypatch, models):
    client, state, _ = env
    monkeypatch.setenv("FIRBO_CONTROL_WRITES_ENABLED", "true")
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state, models=models)).status_code == 422
    assert not state["writes"]


def test_stale_revision_cannot_overwrite_combo(env, monkeypatch):
    client, state, _ = env
    monkeypatch.setenv("FIRBO_CONTROL_WRITES_ENABLED", "true")
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state, expected_revision="0" * 64)).status_code == 409
    assert not state["writes"]


def test_unknown_fields_rejected(env, monkeypatch):
    client, state, _ = env
    monkeypatch.setenv("FIRBO_CONTROL_WRITES_ENABLED", "true")
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state, apiKey="no")).status_code == 422
    assert not state["writes"]


def test_audit_failure_prevents_mutation(env, monkeypatch):
    client, state, _ = env
    monkeypatch.setenv("FIRBO_CONTROL_WRITES_ENABLED", "true")
    def fail(*args):
        raise HTTPException(503, "control_audit_unavailable")
    monkeypatch.setattr(control, "_audit", fail)
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state)).status_code == 503
    assert not state["writes"]


def test_advanced_combo_not_silently_flattened(env, monkeypatch):
    client, state, _ = env
    state["combo"]["models"] = [{"type": "model", "model": "provider/model-a", "weight": 50}]
    monkeypatch.setenv("FIRBO_CONTROL_WRITES_ENABLED", "true")
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), json=update_payload(state)).status_code == 409
    assert not state["writes"]


def test_missing_management_key_has_no_inference_key_fallback(env, monkeypatch):
    client, state, _ = env
    monkeypatch.delenv("OMNIROUTE_MANAGEMENT_KEY")
    monkeypatch.setenv("OMNIROUTE_API_KEY", "inference-only")
    response = client.get("/v1/firbo/control", headers=auth())
    assert response.status_code == 200
    assert response.json()["available"] is False
    assert response.json()["errors"]["models"] == "gateway_management_not_configured"
    assert all(r.url.host == "supabase.test" for r in state["requests"])


def test_body_limit_before_auth_or_mutation(env):
    client, state, _ = env
    assert client.post("/v1/firbo/control/combos/firbo-economy", headers=auth(), content=b"x" * 65537).status_code == 413
    assert not state["requests"]


def test_private_token_not_in_principal_repr():
    assert "secret-token" not in repr(control.Principal(USER, "secret-token"))


def test_upstream_limit_is_enforced_during_stream_read():
    import asyncio
    class Stream(httpx.AsyncByteStream):
        def __init__(self):
            self.reads = 0
        async def __aiter__(self):
            for _ in range(10):
                self.reads += 1
                yield b"x" * 500_000
    stream = Stream()
    response = httpx.Response(200, stream=stream)
    with pytest.raises(HTTPException) as error:
        asyncio.run(control._read_json(response))
    assert error.value.detail == "upstream_response_too_large"
    assert stream.reads == 5  # Reader stopped early; it did NOT consume all 10 chunks.
