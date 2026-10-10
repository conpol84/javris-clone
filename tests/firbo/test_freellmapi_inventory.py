"""Only allow a read-only Docker metadata snapshot for the existing container."""

import importlib.util
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location(
    "firbo_freellmapi_inventory",
    Path(__file__).parents[2] / "deploy/hostinger/freellmapi_inventory.py",
)
inv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inv)


def healthy():
    return {
        "state": {"Running": True, "Health": {"Status": "healthy"}},
        "image": inv.REVIEWED_IMAGE,
        "user": "1000:1000",
        "ports": {"3001/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3001"}]},
        "networks": {"hostinger_default": {}},
        "privileged": False,
        "capdrop": ["ALL"],
        "security": ["no-new-privileges:true"],
        "restart": "unless-stopped",
    }


def simulate(values):
    observed = []

    def fake_run(args, **kwargs):
        observed.append(args)
        assert kwargs["check"] is False
        assert kwargs["timeout"] == 6
        assert kwargs["capture_output"] is True
        assert kwargs["text"] is True
        assert args[:5] == ["docker", "inspect", "--type", "container", "--format"]
        assert args[-1] == "firbo-freellmapi"
        for key, selection in inv.INSPECT_FIELDS.items():
            if args[5] == "{{json ." + selection + "}}":
                return SimpleNamespace(
                    stdout=json.dumps(values[key]),
                    stderr="Bearer private-credential",
                    returncode=0,
                )
        pytest.fail("unexpected inspect format")

    with patch.object(inv.subprocess, "run", side_effect=fake_run):
        result = inv.inventory()
    return result, observed


def test_exact_install_receipt_has_no_secrets_or_mutating_commands():
    result, calls = simulate(healthy())
    assert result == {
        "installed": True,
        "ready": True,
        "health_verified": True,
        "network_isolation_verified": True,
        "reviewed_image_verified": True,
        "inference_verified": False,
        "provider_cost_verified": False,
        "issues": [],
    }
    assert len(calls) == len(inv.INSPECT_FIELDS)
    assert "Bearer" not in json.dumps(result)
    assert not any("exec" in arg or "env" in arg for row in calls for arg in row)


@pytest.mark.parametrize(
    "key,value,issue",
    [
        ("image", "ghcr.io/unknown:latest", "image_digest_not_reviewed"),
        ("user", "root", "container_user_drift"),
        (
            "ports",
            {"3001/tcp": [{"HostIp": "0.0.0.0", "HostPort": "3001"}]},
            "listener_not_loopback_only",
        ),
        (
            "networks",
            {"hostinger_default": {}, "public": {}},
            "network_isolation_drift",
        ),
        ("privileged", True, "privileged_container"),
        ("capdrop", [], "linux_capabilities_not_dropped"),
        ("security", [], "no_new_privileges_missing"),
        ("restart", "always", "restart_policy_drift"),
        ("state", {"Running": False}, "service_not_healthy"),
    ],
)
def test_drift_fails_closed_without_exposing_full_docker_configuration(
    key, value, issue
):
    values = healthy()
    values[key] = value
    result, _ = simulate(values)
    assert result["installed"] is True
    assert result["ready"] is False
    assert issue in result["issues"]


def test_inspection_error_does_not_echo_daemon_output():
    with patch.object(
        inv.subprocess,
        "run",
        return_value=SimpleNamespace(
            stdout="Bearer supersecret",
            stderr="supersecret upstream Docker error",
            returncode=1,
        ),
    ):
        result = inv.inventory()
    assert result == {
        "installed": False,
        "ready": False,
        "reason": "inspect_unavailable",
    }


def test_rejects_arbitrary_fields_without_invoking_docker():
    with patch.object(inv.subprocess, "run") as run:
        with pytest.raises(ValueError, match="invalid_inventory_field"):
            inv.field("Config.Env")
        run.assert_not_called()


def test_timeout_is_sanitized():
    with patch.object(
        inv.subprocess,
        "run",
        side_effect=subprocess.TimeoutExpired(["docker", "inspect"], 6),
    ):
        assert inv.inventory()["reason"] == "inspect_unavailable"
