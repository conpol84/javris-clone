"""Correctly read the already installed FIRBO Compose key without exporting it."""

import importlib.util
import io
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

ROOT = Path(__file__).parents[2] / "deploy/hostinger"
spec = importlib.util.spec_from_file_location(
    "firbo_quota_stored_stack", ROOT / "omniroute_ceo_quota_stack.py"
)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

KEY = "synthetic-firbo-management-token"


def models(management=KEY, inference="synthetic-different-inference-token"):
    source = SimpleNamespace(
        runtime=lambda: {"env_path": Path("/no-real-stack/.env")},
        read_private=lambda path: b"private-credentials",
        values=lambda raw: {
            "OMNIROUTE_MANAGEMENT_KEY": management,
            "OMNIROUTE_API_KEY": inference,
        },
    )
    return source


def successful_quota():
    return {
        "read_only": True,
        "quota_telemetry_read": True,
        "providers": {"openai": {"connections": 1, "cooldowns": 1}},
        "credits_balance_verified": False,
    }


def test_reads_key_in_process_without_export_or_echo_or_inference(monkeypatch):
    received = []
    source = models()
    quota = SimpleNamespace(
        probe=lambda management_key: (
            received.append(management_key) or successful_quota()
        )
    )
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: source if name == "gateway-credentials.py" else quota,
    )
    with patch.dict(os.environ, {}, clear=True):
        result = bridge.inspect_stored_credential()
        assert "OMNIROUTE_MANAGEMENT_KEY" not in os.environ
    assert received == [KEY]
    assert result == successful_quota()
    assert KEY not in json.dumps(result)


def test_management_key_missing_in_verified_compose_has_no_network(monkeypatch):
    source = models(management="")
    calls = []
    quota = SimpleNamespace(probe=lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: source if name == "gateway-credentials.py" else quota,
    )
    assert bridge.inspect_stored_credential() == {
        "read_only": True,
        "quota_telemetry_read": False,
        "reason": "management_key_missing_in_verified_stack",
    }
    assert calls == []


def test_inference_key_cannot_be_used_as_management_key(monkeypatch):
    source = models(management=KEY, inference=KEY)
    calls = []
    quota = SimpleNamespace(probe=lambda **kwargs: calls.append(kwargs))
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: source if name == "gateway-credentials.py" else quota,
    )
    assert bridge.inspect_stored_credential()["reason"] == (
        "management_and_inference_key_not_separated"
    )
    assert calls == []


@pytest.mark.parametrize("stage", ["runtime", "read_private", "values"])
def test_private_stack_exception_is_sanitized_without_leaking_secrets(
    monkeypatch, stage
):
    source = models()
    setattr(
        source,
        stage,
        lambda *args: (_ for _ in ()).throw(
            RuntimeError("Bearer synthetic-firbo-management-token")
        ),
    )
    quota = SimpleNamespace(probe=lambda **kwargs: pytest.fail("inference called"))
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: source if name == "gateway-credentials.py" else quota,
    )
    report = bridge.inspect_stored_credential()
    assert report["reason"] == "verified_compose_credentials_unavailable"
    assert KEY not in json.dumps(report)


def test_private_stack_never_accepts_arbitrary_source_files():
    with pytest.raises(
        bridge.DiagnosticUnavailable, match="unexpected_source_name"
    ):
        bridge._load_existing("other-user-env.txt", "untrusted")


def test_corrupt_quota_contract_fails_closed(monkeypatch):
    source = models()
    quota = SimpleNamespace(probe=lambda **kwargs: {"credits": KEY})
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: source if name == "gateway-credentials.py" else quota,
    )
    report = bridge.inspect_stored_credential()
    assert report["reason"] == "quota_contract_unverified"
    assert KEY not in json.dumps(report)


def test_in_process_override_does_not_require_shell_export(monkeypatch):
    spec_quota = importlib.util.spec_from_file_location(
        "firbo_quota_test", ROOT / "omniroute_ceo_quota_probe.py"
    )
    quota_module = importlib.util.module_from_spec(spec_quota)
    spec_quota.loader.exec_module(quota_module)
    payload = json.dumps(
        {
            "providers": [
                {
                    "provider": "openai",
                    "quotaTotal": None,
                    "tokenStatus": "valid",
                    "resetAt": None,
                }
            ]
        }
    ).encode()
    with (
        patch.dict(os.environ, {}, clear=True),
        patch.object(quota_module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = io.BytesIO(payload)
        result = quota_module.probe(management_key=KEY)
        assert result["quota_telemetry_read"] is True
        assert result["credits_balance_verified"] is False
        request = factory.return_value.open.call_args.args[0]
        assert request.full_url == quota_module.URL
        assert request.get_method() == "GET"
        assert request.get_header("Authorization") == "Bearer " + KEY
        assert KEY not in json.dumps(result)
        assert "OMNIROUTE_MANAGEMENT_KEY" not in os.environ
