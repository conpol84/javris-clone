"""No-network acceptance tests; no real MCP calls or secrets."""

from __future__ import annotations

import importlib.util
import json
from email.message import Message
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "firbo_omni_mcp_read",
    ROOT / "deploy/hostinger/firbo_omniroute_mcp_read_acceptance.py",
)
assert SPEC is not None and SPEC.loader is not None
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)

TOKEN = "synthetic-test-only:" + "A" * 48
SESSION = "sandbox-session-id-1"


class FakeReply:
    def __init__(self, payload=None, *, status=200, sid=None):
        self.status = status
        self.headers = Message()
        self.headers["content-type"] = "application/json"
        if sid is not None:
            self.headers["mcp-session-id"] = sid
        self.payload = b"" if payload is None else json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, limit):
        assert limit == module.MAX_BODY_BYTES + 1
        return self.payload


class FakeOmni:
    def __init__(self, *, status=None, advertised=None, reply_error=False):
        self.calls = []
        self.status = status or {
            "enabled": True,
            "online": True,
            "transport": "streamable-http",
            "scopesEnforced": True,
        }
        self.advertised = advertised or [
            "omniroute_get_health",
            "omniroute_check_quota",
            "omniroute_cost_report",
            "omniroute_list_models_catalog",
            "omniroute_list_combos",
            "omniroute_route_request",
        ]
        self.reply_error = reply_error

    def open(self, req, timeout):
        assert timeout == 9
        assert req.full_url in {module.STATUS_URL, module.STREAM_URL}
        assert req.get_header("Authorization") == "Bearer " + TOKEN
        assert "synthetic-test-only" not in req.full_url
        if req.get_method() == "GET":
            assert req.full_url == module.STATUS_URL
            self.calls.append("status")
            return FakeReply(self.status)
        assert req.full_url == module.STREAM_URL
        assert req.get_method() == "POST"
        parsed = json.loads(req.data)
        method = parsed["method"]
        self.calls.append(method)
        if method == "initialize":
            return FakeReply({
                "jsonrpc": "2.0",
                "id": parsed["id"],
                "result": {"protocolVersion": module.PROTOCOL, "capabilities": {}},
            }, sid=SESSION)
        assert req.get_header("Mcp-session-id") == SESSION
        if method == "notifications/initialized":
            return FakeReply(status=202)
        if method == "tools/list":
            return FakeReply({
                "jsonrpc": "2.0",
                "id": parsed["id"],
                "result": {
                    "tools": [{"name": name} for name in self.advertised],
                },
            })
        if method == "tools/call":
            assert parsed["params"] == {
                "name": "omniroute_get_health",
                "arguments": {},
            }
            return FakeReply({
                "jsonrpc": "2.0",
                "id": parsed["id"],
                "result": {
                    "isError": self.reply_error,
                    "content": [{"type": "text", "text": "PRIVATE_GATEWAY_DETAILS"}],
                },
            })
        pytest.fail("Non-readonly action attempted: " + str(method))


def test_tools_list_without_ever_calling_a_tool():
    gateway = FakeOmni()
    output = module.acceptance(gateway, TOKEN)
    assert output["mcp_session_initialized"] is True
    assert output["mcp_tools_list_completed"] is True
    assert output["advertised_tool_count"] == 6
    assert output["firbo_five_readonly_tools_advertised"] == sorted(
        module.ALLOWED_TOOL_IDS
    )
    assert output["mcp_tool_called"] is False
    assert "omniroute_route_request" not in str(output)
    assert "PRIVATE_GATEWAY_DETAILS" not in str(output)
    assert gateway.calls == [
        "status", "initialize", "notifications/initialized", "tools/list",
    ]


def test_explicit_single_health_probe_without_returning_private_content():
    gateway = FakeOmni()
    output = module.acceptance(gateway, TOKEN, read_health=True)
    assert output["mcp_tool_called"] is True
    assert output["read_health_receipt"] == "completed_no_payload_logged"
    assert gateway.calls.count("tools/call") == 1
    assert gateway.calls[-1] == "tools/call"
    assert "PRIVATE_GATEWAY_DETAILS" not in str(output)


@pytest.mark.parametrize(
    "status",
    [
        {"enabled": False, "online": True, "transport": "streamable-http", "scopesEnforced": True},
        {"enabled": True, "online": False, "transport": "streamable-http", "scopesEnforced": True},
        {"enabled": True, "online": True, "transport": "sse", "scopesEnforced": True},
        {"enabled": True, "online": True, "transport": "stdio", "scopesEnforced": True},
        {"enabled": True, "online": True, "transport": "streamable-http", "scopesEnforced": False},
        {"enabled": "true", "online": True, "transport": "streamable-http", "scopesEnforced": True},
        {},
    ],
)
def test_no_mcp_session_when_gateway_has_lost_any_readiness_gate(status):
    gateway = FakeOmni(status=status)
    with pytest.raises(module.AcceptanceError, match="mcp_not_ready_no_execution"):
        module.acceptance(gateway, TOKEN, read_health=True)
    assert gateway.calls == ["status"]


@pytest.mark.parametrize(
    "method,url,payload",
    [
        ("GET", "https://evil.invalid/api/mcp/status", None),
        ("POST", module.STATUS_URL, {"method": "tools/list"}),
        ("GET", module.STREAM_URL, None),
        ("POST", module.STREAM_URL, {"method": "tools/call", "params": {"name": "omniroute_switch_combo", "arguments": {}}}),
        ("POST", module.STREAM_URL, {"method": "tools/call", "params": {"name": "omniroute_route_request", "arguments": {}}}),
        ("POST", module.STREAM_URL, {"method": "tools/call", "params": {"name": "omniroute_get_health", "arguments": {"write": "yes"}}}),
        ("POST", module.STREAM_URL, {"method": "prompts/get"}),
    ],
)
def test_fixed_origin_and_approved_read_only_rpc_calls_only(method, url, payload):
    with pytest.raises(module.AcceptanceError):
        module.request_once(FakeOmni(), TOKEN, method, url, payload)


def test_health_is_denied_if_key_has_no_read_health_scope():
    gateway = FakeOmni(reply_error=True)
    with pytest.raises(module.AcceptanceError, match="health_tool_denied_or_failed"):
        module.acceptance(gateway, TOKEN, read_health=True)
    assert gateway.calls.count("tools/call") == 1


def test_missing_health_tool_blocks_call_without_retry():
    gateway = FakeOmni(advertised=["omniroute_route_request"])
    with pytest.raises(module.AcceptanceError, match="health_tool_not_advertised"):
        module.acceptance(gateway, TOKEN, read_health=True)
    assert "tools/call" not in gateway.calls


def test_too_many_tools_fail_closed_without_any_tool_call():
    gateway = FakeOmni(advertised=[f"safe_{i}" for i in range(module.MAX_TOOLS + 1)])
    with pytest.raises(module.AcceptanceError, match="too_many_advertised_tools"):
        module.acceptance(gateway, TOKEN, read_health=True)
    assert "tools/call" not in gateway.calls


def test_blank_or_short_key_never_passes_transport():
    gateway = FakeOmni()
    for key in ["", "short", "x" * 1025]:
        with pytest.raises(module.AcceptanceError, match="invalid_scoped_token_length"):
            module.acceptance(gateway, key)
    assert gateway.calls == []


def test_hidden_terminal_rejection_does_not_issue_requests(monkeypatch, capsys):
    def untrusted_prompt(*_args):
        raise module.getpass.GetPassWarning("would be echoed: SECRET")

    monkeypatch.setattr(module.getpass, "getpass", untrusted_prompt)
    monkeypatch.setattr(
        module,
        "private_opener",
        lambda: pytest.fail("must not open any connection"),
    )
    assert module.main([]) == 4
    result = capsys.readouterr().out
    assert "interactive_hidden_tty_required" in result
    assert "SECRET" not in result


def test_test_fake_transport_never_invokes_real_network(monkeypatch):
    def prohibited(*_args):
        pytest.fail("network forbidden during synthetic tests")

    monkeypatch.setattr(module.urllib.request, "build_opener", prohibited)
    fake = FakeOmni()
    assert module.acceptance(fake, TOKEN)["mcp_tools_list_completed"] is True


def test_unauthorized_http_response_is_sanitized():
    import urllib.error

    class Denied:
        def open(self, request, timeout):
            raise urllib.error.HTTPError(
                request.full_url, 401, "SECRET_EXAMPLE", None, None
            )

    with pytest.raises(module.AcceptanceError, match="http_401") as exc:
        module.request_once(Denied(), TOKEN, "GET", module.STATUS_URL)
    assert "SECRET_EXAMPLE" not in str(exc.value)
