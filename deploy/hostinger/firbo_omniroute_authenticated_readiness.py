"""FIRBO / OmniRoute operator-owned, read-only MCP transport readiness.

Run from a HOST terminal with a TTY. The script prompts for an EXCLUSIVE
mcp:connect + read-only scoped key without echoing, saving or printing it.
Never paste a management/inference key, even to "test" a failing 401.

Makes one HTTPS GET to the pinned dashboard's /api/mcp/status. Redirects and
proxies are disabled. Does NOT initialize an MCP connection, list/call tools,
edit gateway settings, execute A2A, or expose an API key in process argv.
"""

from __future__ import annotations

import getpass
import json
import urllib.error
import urllib.request

URL = "https://gateway.firboai.app/api/mcp/status"
MAX_BYTES = 64 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def summarize(status: int | str, data: object | None) -> dict[str, object]:
    """Emit only coarse readiness: no hidden paths, provider info or session IDs."""
    report: dict[str, object] = {
        "contract": "firbo-omni-auth-mcp-readiness/v1",
        "read_only": True,
        "mcp_status_http": status,
        "authenticated_execution_tested": False,
        "a2a_execution_tested": False,
        "skill_import_attempted": False,
    }
    if status != 200 or not isinstance(data, dict):
        report["readiness"] = "not_verified"
        return report

    enabled = data.get("enabled") is True
    online = data.get("online") is True
    transport = data.get("transport")
    scopes_enforced = data.get("scopesEnforced") is True
    report["mcp_enabled"] = enabled
    report["mcp_online"] = online
    report["mcp_transport"] = (
        transport
        if transport in {"streamable-http", "sse", "stdio"}
        else "unknown"
    )
    report["mcp_per_tool_scopes_enforced"] = scopes_enforced
    report["readiness"] = (
        "eligible_for_separate_owner_review"
        if enabled and online and transport == "streamable-http" and scopes_enforced
        else "not_ready_no_pilot"
    )
    return report


def fetch_status(token: str) -> tuple[int | str, object | None]:
    if not isinstance(token, str) or not (32 <= len(token) <= 1024):
        return "invalid_scoped_token_length", None

    req = urllib.request.Request(
        URL,
        method="GET",
        headers={
            "Authorization": "Bearer " + token,
            "Accept": "application/json",
            "User-Agent": "firbo-readonly-mcp-readiness/1",
        },
    )
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect()
    )
    try:
        with opener.open(req, timeout=7) as resp:
            if resp.status != 200:
                return resp.status, None
            if resp.headers.get_content_type() != "application/json":
                return "invalid_content_type", None
            content = resp.read(MAX_BYTES + 1)
            if len(content) > MAX_BYTES:
                return "response_too_large", None
            try:
                return resp.status, json.loads(content)
            except (ValueError, UnicodeError):
                return "bad_json", None
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except Exception:
        return "transport_unreachable", None


def main() -> int:
    print(
        "Only paste a newly-created, narrow mcp:connect + read:* key. "
        "Never use an inference or management API key."
    )
    try:
        # getpass opens /dev/tty even if code is piped from git show.
        token = getpass.getpass("Dedicated MCP-only key (hidden): ")
    except (OSError, EOFError, KeyboardInterrupt):
        print("interactive_owner_terminal_required")
        return 4
    status, data = fetch_status(token)
    token = ""  # Avoid retaining the string beyond this function.
    report = summarize(status, data)
    print(json.dumps(report, sort_keys=True))
    return 0 if report["readiness"] == "eligible_for_separate_owner_review" else 2


if __name__ == "__main__":
    raise SystemExit(main())
