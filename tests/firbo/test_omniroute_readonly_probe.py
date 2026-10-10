"""No-network regression coverage for private OmniRoute capability discovery."""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

SOURCE = (
    Path(__file__).resolve().parents[2]
    / "deploy/hostinger/firbo_omniroute_readonly_probe.py"
)
SPEC = importlib.util.spec_from_file_location("firbo_omni_readonly", SOURCE)
assert SPEC and SPEC.loader
omni = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(omni)


def sample(path):
    data = {
        "/api/health": (200, {"status": "ok"}),
        "/api/agent-skills": (
            200,
            {
                "skills": [
                    {"id": "omni-mcp", "rawUrl": "https://hostile.invalid/key"},
                    {"id": "omni-agents-a2a", "description": "SECRET DO NOT DISPLAY"},
                ],
                "count": 2,
            },
        ),
        "/.well-known/agent.json": (
            200,
            {"url": "https://gateway.firboai.app/a2a", "skills": [{"id": "routing"}]},
        ),
        "/api/a2a/status": (200, {"enabled": False, "tasks": {"secret": "private"}}),
        "/api/mcp/status": (401, None),
    }
    assert path in omni.ALLOWED
    return data[path]


def test_safe_catalog_and_mcp_a2a_classification_without_outputting_body():
    result = omni.audit(sample)
    assert result["read_only"] is True
    assert result["gateway_responding"] is True
    assert result["catalog_entries_observed"] == 2
    assert result["catalog_safe_ids"] == 2
    assert result["mcp_status_requires_auth"] is True
    assert result["a2a_card_advertised"] is True
    assert result["a2a_enabled_reported"] is False
    assert result["authenticated_mcp_verified"] is False
    assert result["a2a_task_execution_verified"] is False
    assert result["skills_installed_in_firbo"] is False
    assert "SECRET" not in str(result)
    assert "hostile.invalid" not in str(result)
    assert set(result) <= {
        "contract", "read_only", "authenticated_mcp_verified",
        "a2a_task_execution_verified", "skills_installed_in_firbo",
        "gateway_health_http", "gateway_responding", "agent_catalog_http",
        "catalog_entries_observed", "catalog_safe_ids",
        "catalog_has_duplicate_ids", "catalog_contract_verified",
        "agent_card_http", "a2a_card_advertised", "a2a_card_skill_count",
        "a2a_status_http", "a2a_enabled_reported", "mcp_status_http",
        "mcp_status_requires_auth", "mcp_unauthenticated_status_access",
    }


def test_duplicate_skill_id_fails_unique_catalog_signal():
    def duplicate(path):
        if path == "/api/agent-skills":
            return 200, {"skills": [{"id": "omni-mcp"}, {"id": "omni-mcp"}]}
        return 503, None

    result = omni.audit(duplicate)
    assert result["catalog_has_duplicate_ids"] is True
    assert result["catalog_safe_ids"] == 1


def test_public_mcp_status_is_flagged_not_accepted_as_authenticated_readiness():
    def open_mcp(path):
        return (200, {"online": True, "secret": "never show"})

    report = omni.audit(open_mcp)
    assert report["mcp_unauthenticated_status_access"] is True
    assert report["mcp_status_requires_auth"] is False
    assert report["authenticated_mcp_verified"] is False
    assert "never show" not in str(report)


@pytest.mark.parametrize(
    "path",
    ["/api/keys", "/api/mcp/sse", "/a2a", "/api/agent-skills/omni-cli-tools/raw",
     "https://example.com", "//other.example", "/api/mcp/tools"],
)
def test_http_probe_never_calls_executable_or_sensitive_endpoints(path):
    with pytest.raises(ValueError, match="probe_path_not_allowed"):
        omni.fetch_json(path)


def test_discovery_handles_transport_failures_without_claiming_capabilities():
    def offline(_path):
        raise RuntimeError("untrusted upstream error including a token")

    result = omni.audit(offline)
    assert result["gateway_responding"] is False
    assert result["a2a_enabled_reported"] is None
    assert result["authenticated_mcp_verified"] is False
    assert "token" not in str(result)


def test_catalog_oversized_contract_fails_closed():
    def huge(path):
        return (200, {"skills": [{"id": "a"}] * 201})

    result = omni.audit(huge)
    assert result["catalog_contract_verified"] is False
    assert result["skills_installed_in_firbo"] is False
