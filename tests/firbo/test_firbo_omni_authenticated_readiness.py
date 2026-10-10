"""One-GET authenticated Omni readiness, all network calls mocked."""

from __future__ import annotations

import importlib.util
import json
from email.message import Message
from pathlib import Path
from urllib import error

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "firbo_omni_status",
    ROOT / "deploy/hostinger/firbo_omniroute_authenticated_readiness.py",
)
assert SPEC and SPEC.loader
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


def test_401_is_protected_not_disabled_or_active():
    out = module.summarize(401, None)
    assert out["readiness"] == "not_verified"
    assert out["mcp_status_http"] == 401
    assert out["authenticated_execution_tested"] is False


@pytest.mark.parametrize(
    "data",
    [
        {
            "enabled": False,
            "online": True,
            "transport": "streamable-http",
            "scopesEnforced": True,
        },
        {
            "enabled": True,
            "online": False,
            "transport": "streamable-http",
            "scopesEnforced": True,
        },
        {"enabled": True, "online": True, "transport": "sse", "scopesEnforced": True},
        {
            "enabled": True,
            "online": True,
            "transport": "streamable-http",
            "scopesEnforced": False,
        },
        {"enabled": True, "online": True, "transport": "streamable-http"},
        {
            "enabled": "true",
            "online": True,
            "transport": "streamable-http",
            "scopesEnforced": True,
        },
        {
            "enabled": True,
            "online": True,
            "transport": "unexpected",
            "scopesEnforced": True,
        },
        {},
    ],
)
def test_incomplete_flags_block_pilot(data):
    out = module.summarize(200, data)
    assert out["readiness"] == "not_ready_no_pilot"
    assert out["authenticated_execution_tested"] is False


def test_explicit_correct_status_is_only_eligible_for_separate_review():
    data = {
        "enabled": True,
        "online": True,
        "transport": "streamable-http",
        "scopesEnforced": True,
        "session": {"token": "MUST_NOT_LEAK"},
        "mcpSecret": "NEVER_PRINT",
    }
    out = module.summarize(200, data)
    assert out["readiness"] == "eligible_for_separate_owner_review"
    assert "MUST_NOT_LEAK" not in json.dumps(out)
    assert "NEVER_PRINT" not in json.dumps(out)
    assert out["authenticated_execution_tested"] is False
    assert out["a2a_execution_tested"] is False


def test_one_https_read_only_request_without_redirect_proxy_or_key_output(monkeypatch):
    token = "test-only-mcp:" + "x" * 40
    history: list[tuple[str, str, str]] = []

    class FakeResponse:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def read(self, count):
            assert count == module.MAX_BYTES + 1
            return json.dumps(
                {
                    "enabled": True,
                    "online": True,
                    "transport": "streamable-http",
                    "scopesEnforced": True,
                }
            ).encode()

        headers = Message()
        headers["content-type"] = "application/json"

    class FakeOpener:
        def open(self, req, timeout):
            history.append((req.full_url, req.get_method(), str(timeout)))
            assert req.get_header("Authorization") == "Bearer " + token
            return FakeResponse()

    def fake_builder(*handlers):
        assert any(isinstance(h, module.NoRedirect) for h in handlers)
        assert any(
            isinstance(h, module.urllib.request.ProxyHandler) and not h.proxies
            for h in handlers
        )
        return FakeOpener()

    monkeypatch.setattr(module.urllib.request, "build_opener", fake_builder)
    status, data = module.fetch_status(token)
    assert status == 200
    assert (
        module.summarize(status, data)["readiness"]
        == "eligible_for_separate_owner_review"
    )
    assert history == [(module.URL, "GET", "7")]


def test_missing_or_wrong_length_key_never_opens_network(monkeypatch):
    monkeypatch.setattr(
        module.urllib.request,
        "build_opener",
        lambda *args: pytest.fail("network not permitted"),
    )
    assert module.fetch_status("")[0] == "invalid_scoped_token_length"
    assert module.fetch_status("short")[0] == "invalid_scoped_token_length"


def test_http_error_discloses_only_status(monkeypatch):
    class FakeOpener:
        def open(self, req, timeout):
            raise error.HTTPError(req.full_url, 403, "key contains SECRET", None, None)

    monkeypatch.setattr(
        module.urllib.request, "build_opener", lambda *args: FakeOpener()
    )
    status, result = module.fetch_status("x" * 42)
    report = module.summarize(status, result)
    assert status == 403
    assert result is None
    assert "SECRET" not in str(report)


def test_noninteractive_fails_without_key_or_request(monkeypatch, capsys):
    def no_tty(*args, **kwargs):
        raise EOFError()

    monkeypatch.setattr(module.getpass, "getpass", no_tty)
    monkeypatch.setattr(
        module,
        "fetch_status",
        lambda token: pytest.fail("not authorized to run any request"),
    )
    assert module.main() == 4
    output = capsys.readouterr().out
    assert "interactive_owner_terminal_required" in output
