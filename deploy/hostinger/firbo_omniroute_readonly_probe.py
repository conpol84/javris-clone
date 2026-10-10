"""Read-only FIRBO→OmniRoute discovery of existing MCP/A2A/AgentSkills.

Run only inside the existing firbo-api Docker network: python -B -.
Never sends a Bearer token, invokes a tool, downloads SKILL.md, follows a
redirect, opens a public endpoint, changes settings, or prints returned content.
This is discovery, NOT proof of an authenticated MCP/A2A integration.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

PRIVATE_GATEWAY = "http://omniroute:20128"
ALLOWED = frozenset(
    {
        "/api/health",
        "/api/agent-skills",
        "/.well-known/agent.json",
        "/api/a2a/status",
        "/api/mcp/status",
    }
)
MAX_BODY = 262_144


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def fetch_json(path: str) -> tuple[int | str, object | None]:
    """Fixed in-stack GET only; no auth headers, proxy, redirects or form body."""
    if path not in ALLOWED:
        raise ValueError("probe_path_not_allowed")
    request = urllib.request.Request(
        PRIVATE_GATEWAY + path,
        method="GET",
        headers={"Accept": "application/json", "User-Agent": "firbo-omni-readonly/v1"},
    )
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=4) as response:
            status = response.status
            if status != 200:
                return status, None
            if response.headers.get_content_type().lower() != "application/json":
                return "invalid_content_type", None
            raw = response.read(MAX_BODY + 1)
            if len(raw) > MAX_BODY:
                return "response_too_large", None
            return status, json.loads(raw)
    except urllib.error.HTTPError as exc:
        return exc.code, None
    except (OSError, ValueError, UnicodeError, json.JSONDecodeError):
        return "unreachable_or_invalid", None


def audit(get=fetch_json) -> dict[str, object]:
    """Return only bounded metadata and authentication posture, not payloads."""
    report: dict[str, object] = {
        "contract": "firbo-omniroute-discovery/v1",
        "read_only": True,
        "authenticated_mcp_verified": False,
        "a2a_task_execution_verified": False,
        "skills_installed_in_firbo": False,
    }
    for label, path in [
        ("gateway_health", "/api/health"),
        ("agent_catalog", "/api/agent-skills"),
        ("agent_card", "/.well-known/agent.json"),
        ("a2a_status", "/api/a2a/status"),
        ("mcp_status", "/api/mcp/status"),
    ]:
        try:
            status, value = get(path)
        except Exception:
            status, value = "probe_failed", None
        report[label + "_http"] = status

        if label == "gateway_health":
            report["gateway_responding"] = (
                status == 200 and isinstance(value, dict)
                and value.get("status") == "ok"
            )
        elif label == "agent_catalog":
            skills = (
                value.get("skills") if status == 200 and isinstance(value, dict) else None
            )
            if isinstance(skills, list) and len(skills) <= 200:
                safe_ids = []
                for skill in skills:
                    if not isinstance(skill, dict):
                        continue
                    skill_id = skill.get("id")
                    if (
                        isinstance(skill_id, str)
                        and 1 <= len(skill_id) <= 80
                        and skill_id.isascii()
                        and all(
                            c.islower() or c.isdigit() or c == "-" for c in skill_id
                        )
                    ):
                        safe_ids.append(skill_id)
                report["catalog_entries_observed"] = len(skills)
                report["catalog_safe_ids"] = len(set(safe_ids))
                report["catalog_has_duplicate_ids"] = len(safe_ids) != len(
                    set(safe_ids)
                )
            else:
                report["catalog_contract_verified"] = False
        elif label == "agent_card":
            if status == 200 and isinstance(value, dict):
                skills = value.get("skills")
                report["a2a_card_advertised"] = (
                    isinstance(value.get("url"), str)
                    and isinstance(skills, list)
                )
                if isinstance(skills, list):
                    report["a2a_card_skill_count"] = min(len(skills), 1000)
        elif label == "a2a_status":
            report["a2a_enabled_reported"] = (
                value.get("enabled") is True
                if status == 200 and isinstance(value, dict)
                else None
            )
        elif label == "mcp_status":
            report["mcp_status_requires_auth"] = status in {401, 403}
            report["mcp_unauthenticated_status_access"] = status == 200
    return report


if __name__ == "__main__":
    print(json.dumps(audit(), sort_keys=True))
