"""Owner-only, ephemeral FIRBO↔OmniRoute MCP acceptance. No second MCP service.

Default: verify enabled, online, Streamable HTTP, enforced scopes, and list the
remote advertised tools. --read-health explicitly permits ONE call to the fixed
read-only tool omniroute_get_health after discovery. No write/execute tools.
No API keys in arguments, files, logs or printed responses. No retry/replay.

Usage, executed from an owner TTY:
 git show COMMIT:deploy/hostinger/firbo_omniroute_mcp_read_acceptance.py | python3 -
 git show COMMIT:deploy/hostinger/firbo_omniroute_mcp_read_acceptance.py | python3 - --read-health
"""

from __future__ import annotations

import argparse
import getpass
import json
import re
import urllib.error
import urllib.request
import warnings

HOST = "https://gateway.firboai.app"
STATUS_URL = HOST + "/api/mcp/status"
STREAM_URL = HOST + "/api/mcp/stream"
PROTOCOL = "2025-03-26"
READ_TOOL = "omniroute_get_health"
ALLOWED_TOOL_IDS = frozenset(
    {
        "omniroute_get_health",
        "omniroute_check_quota",
        "omniroute_cost_report",
        "omniroute_list_models_catalog",
        "omniroute_list_combos",
    }
)
MAX_BODY_BYTES = 262_144
MAX_TOOLS = 100
MAX_PAGES = 5


class AcceptanceError(Exception):
    """Sanitized failure code. NEVER include the upstream response/body/token."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def private_opener():
    # No environment HTTP(S) proxies, no redirects. HTTPS certificate checking
    # stays at the Python standard-library verified default.
    return urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def read_bounded(response):
    try:
        raw = response.read(MAX_BODY_BYTES + 1)
    except Exception as exc:
        raise AcceptanceError("response_unreadable") from None
    if len(raw) > MAX_BODY_BYTES:
        raise AcceptanceError("response_too_large")
    return raw


def request_once(opener, token, method, url, payload=None, sid=None):
    if url not in {STATUS_URL, STREAM_URL}:
        raise AcceptanceError("target_not_allowlisted")
    if url == STATUS_URL and (method != "GET" or payload is not None):
        raise AcceptanceError("status_must_be_read_only")
    if url == STREAM_URL and (method != "POST" or not isinstance(payload, dict)):
        raise AcceptanceError("mcp_post_contract_invalid")
    if payload is not None:
        action = payload.get("method")
        if action not in {
            "initialize",
            "notifications/initialized",
            "tools/list",
            "tools/call",
        }:
            raise AcceptanceError("mcp_method_not_allowlisted")
        if action == "tools/call" and (
            payload.get("params") != {"name": READ_TOOL, "arguments": {}}
        ):
            raise AcceptanceError("mcp_tool_not_read_only")
    if not isinstance(token, str) or not 32 <= len(token) <= 1024:
        raise AcceptanceError("invalid_scoped_token_length")
    headers = {
        "Authorization": "Bearer " + token,
        "Accept": "application/json, text/event-stream",
        "User-Agent": "firbo-mcp-readonly-acceptance/1",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
        headers["MCP-Protocol-Version"] = PROTOCOL
    if sid:
        if not re.fullmatch(r"[\x21-\x7e]{1,200}", sid):
            raise AcceptanceError("bad_mcp_session")
        headers["Mcp-Session-Id"] = sid
    body = json.dumps(payload, separators=(",", ":")).encode() if payload else None
    req = urllib.request.Request(url, data=body, method=method, headers=headers)
    try:
        with opener.open(req, timeout=9) as response:
            if response.status not in {200, 202, 204}:
                raise AcceptanceError("unexpected_http_status")
            session = response.headers.get("mcp-session-id")
            if session and not re.fullmatch(r"[\x21-\x7e]{1,200}", session):
                raise AcceptanceError("bad_mcp_session")
            # MCP notification ACK has no JSON-RPC body.
            if payload is not None and payload.get("method") == "notifications/initialized":
                return response.status, None, session
            if response.status != 200:
                raise AcceptanceError("mcp_response_not_200")
            content_type = response.headers.get_content_type()
            raw = read_bounded(response)
            if content_type == "application/json":
                try:
                    return 200, json.loads(raw), session
                except (ValueError, UnicodeError):
                    raise AcceptanceError("invalid_json") from None
            if content_type == "text/event-stream":
                try:
                    text = raw.decode("utf-8", errors="strict")
                except UnicodeError:
                    raise AcceptanceError("invalid_sse_utf8") from None
                wanted = payload.get("id") if payload is not None else None
                for block in text.replace("\r\n", "\n").split("\n\n"):
                    data = "".join(
                        line[5:].strip()
                        for line in block.split("\n")
                        if line.startswith("data:")
                    )
                    if not data:
                        continue
                    try:
                        decoded = json.loads(data)
                    except (ValueError, UnicodeError):
                        continue
                    if isinstance(decoded, dict) and decoded.get("id") == wanted:
                        return 200, decoded, session
                raise AcceptanceError("missing_sse_rpc_result")
            raise AcceptanceError("invalid_content_type")
    except urllib.error.HTTPError as exc:
        raise AcceptanceError(f"http_{exc.code}") from None
    except AcceptanceError:
        raise
    except Exception:
        raise AcceptanceError("gateway_unreachable_or_timeout") from None


def rpc(opener, token, method, params, rid=None, sid=None):
    payload = {"jsonrpc": "2.0", "method": method, "params": params}
    if rid is not None:
        payload["id"] = rid
    _, body, response_sid = request_once(
        opener, token, "POST", STREAM_URL, payload, sid=sid
    )
    if rid is None:
        return None, response_sid
    if not isinstance(body, dict) or body.get("id") != rid:
        raise AcceptanceError("invalid_rpc_id")
    if body.get("jsonrpc") != "2.0" or body.get("error") is not None:
        raise AcceptanceError("mcp_rpc_rejected")
    if not isinstance(body.get("result"), dict):
        raise AcceptanceError("mcp_result_invalid")
    return body["result"], response_sid


def verify_status(opener, token):
    status, body, _ = request_once(opener, token, "GET", STATUS_URL)
    if status != 200 or not isinstance(body, dict):
        raise AcceptanceError("status_contract_invalid")
    if not all(
        body.get(name) is True for name in ("enabled", "online", "scopesEnforced")
    ) or body.get("transport") != "streamable-http":
        raise AcceptanceError("mcp_not_ready_no_execution")


def discover(opener, token, sid):
    names = set()
    cursors = set()
    cursor = None
    for page in range(MAX_PAGES):
        params = {"cursor": cursor} if cursor else {}
        result, _ = rpc(opener, token, "tools/list", params, rid=10 + page, sid=sid)
        tools = result.get("tools")
        if not isinstance(tools, list):
            raise AcceptanceError("mcp_tools_contract_invalid")
        for tool in tools:
            name = tool.get("name") if isinstance(tool, dict) else None
            if not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_.:/-]{1,100}", name):
                raise AcceptanceError("mcp_tool_name_invalid")
            if name in names:
                raise AcceptanceError("duplicate_advertised_tool")
            names.add(name)
            if len(names) > MAX_TOOLS:
                raise AcceptanceError("too_many_advertised_tools")
        cursor = result.get("nextCursor")
        if not cursor:
            return names
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 500 or cursor in cursors:
            raise AcceptanceError("invalid_pagination_cursor")
        cursors.add(cursor)
    raise AcceptanceError("incomplete_tool_pagination")


def acceptance(opener, token, read_health=False):
    report = {
        "contract": "firbo-omni-mcp-read-acceptance/v1",
        "gateway": "omniroute",
        "operator_probe_only": True,
        "firbo_pilot_changed": False,
        "credentials_logged": False,
        "mcp_session_initialized": False,
        "mcp_tool_called": False,
    }
    verify_status(opener, token)
    report["scope_enforcement_observed"] = True
    init, sid = rpc(
        opener,
        token,
        "initialize",
        {
            "protocolVersion": PROTOCOL,
            "capabilities": {},
            "clientInfo": {"name": "firbo-operator-readonly", "version": "1.0"},
        },
        rid=1,
    )
    if not isinstance(init.get("protocolVersion"), str) or not sid:
        raise AcceptanceError("mcp_initialize_contract_invalid")
    report["mcp_session_initialized"] = True
    rpc(opener, token, "notifications/initialized", {}, sid=sid)
    names = discover(opener, token, sid)
    allowed = sorted(names.intersection(ALLOWED_TOOL_IDS))
    report["advertised_tool_count"] = len(names)
    report["firbo_five_readonly_tools_advertised"] = allowed
    report["health_tool_advertised"] = READ_TOOL in names
    report["mcp_tools_list_completed"] = True
    if read_health:
        if READ_TOOL not in names:
            raise AcceptanceError("health_tool_not_advertised")
        response, _ = rpc(
            opener, token, "tools/call",
            {"name": READ_TOOL, "arguments": {}}, rid=42, sid=sid
        )
        report["mcp_tool_called"] = True
        if response.get("isError") is True:
            raise AcceptanceError("health_tool_denied_or_failed")
        content = response.get("content")
        if not isinstance(content, list) or not content:
            raise AcceptanceError("health_tool_empty_result")
        report["read_health_receipt"] = "completed_no_payload_logged"
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="FIRBO private read-only MCP acceptance")
    parser.add_argument(
        "--read-health",
        action="store_true",
        help="explicitly call ONE read-only health tool after tools/list",
    )
    opts = parser.parse_args(argv)
    print("FIRBO read-only MCP diagnostic. Enter ONLY the dedicated scoped MCP key.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", getpass.GetPassWarning)
            token = getpass.getpass("MCP-only key (hidden): ")
    except (OSError, EOFError, KeyboardInterrupt, getpass.GetPassWarning):
        print(json.dumps({"status": "interactive_hidden_tty_required"}))
        return 4
    try:
        report = acceptance(private_opener(), token, opts.read_health)
        print(json.dumps(report, sort_keys=True))
        return 0
    except AcceptanceError as exc:
        print(json.dumps({"status": str(exc), "read_only": True, "no_retry": True}))
        return 2
    finally:
        token = ""


if __name__ == "__main__":
    raise SystemExit(main())
