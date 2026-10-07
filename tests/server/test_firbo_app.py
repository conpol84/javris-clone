from fastapi.testclient import TestClient

from openjarvis.server import firbo_app


def test_health_needs_no_engine(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    client = TestClient(firbo_app.create_app())
    assert client.get("/health").json() == {
        "status": "ok",
        "contract": "firbo-control/v1",
    }


def test_gateway_routes_require_login_before_backend_configuration(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    client = TestClient(firbo_app.create_app())
    response = client.get("/v1/gateway/overview")
    assert response.status_code == 401
    assert response.json() == {"detail": "sign_in_required"}


def test_gateway_routes_fail_closed_without_supabase(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    client = TestClient(firbo_app.create_app())
    response = client.get(
        "/v1/gateway/overview", headers={"Authorization": "Bearer test-session"}
    )
    assert response.status_code == 503
    assert response.json() == {"detail": "supabase_url_not_configured"}


def test_gateway_routes_require_a_login(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://x.supabase.co")
    client = TestClient(firbo_app.create_app())
    assert client.get("/v1/gateway/usage").status_code == 401
