"""Original strict Compose parser stays strict; read-only quota may normalize equality."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).parents[2] / "deploy/hostinger"


def load(name, alias):
    spec = importlib.util.spec_from_file_location(alias, ROOT / name)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


source = load("gateway-credentials.py", "strict_gateway")
bridge = load("omniroute_ceo_quota_stack.py", "private_quota_bridge")
API, MGMT = "aa" * 20, "bb" * 20


def raw_config(management=None, inference=None):
    return (
        "# Existing private stack\n"
        "OMNIROUTE_API_KEY=" + API + "\n"
        "OMNIROUTE_MANAGEMENT_KEY=" + MGMT + "\n"
        "OPENJARVIS_API_KEY=confidential-other-service\n"
        "OMNIROUTE_API_KEY=" + (API if inference is None else inference) + "\n"
        "OMNIROUTE_MANAGEMENT_KEY="
        + (MGMT if management is None else management)
        + "\n"
    ).encode()


def test_original_parser_is_still_strict():
    with pytest.raises(source.Blocked, match="duplicate_credential_configuration"):
        source.values(raw_config())


def test_matching_duplicate_values_are_normalized_in_memory_only():
    raw = raw_config()
    unchanged = bytes(raw)
    result, normalized = bridge.parse_unambiguous_compose_credentials(source, raw)
    assert normalized is True
    assert raw == unchanged
    assert result["OMNIROUTE_API_KEY"] == API
    assert result["OMNIROUTE_MANAGEMENT_KEY"] == MGMT
    assert result["OPENJARVIS_API_KEY"] == "confidential-other-service"
    with pytest.raises(source.Blocked, match="duplicate_credential_configuration"):
        source.values(raw)


@pytest.mark.parametrize(
    "kwargs",
    [{"management": "cc" * 20}, {"inference": "dd" * 20}, {"management": ""}],
)
def test_conflicts_never_choose_first_or_last_secret(kwargs):
    with pytest.raises(source.Blocked, match="duplicate_credential_values_conflict"):
        bridge.parse_unambiguous_compose_credentials(source, raw_config(**kwargs))


def test_same_invalid_shell_expansion_still_rejected_by_original_validator():
    raw = b"OMNIROUTE_API_KEY=secret$dollar\nOMNIROUTE_API_KEY=secret$dollar\n"
    raw += ("OMNIROUTE_MANAGEMENT_KEY=" + MGMT + "\n").encode()
    with pytest.raises(source.Blocked, match="invalid_gateway_key_format"):
        bridge.parse_unambiguous_compose_credentials(source, raw)


def test_unique_keys_unchanged():
    raw = ("OMNIROUTE_API_KEY=" + API + "\nOMNIROUTE_MANAGEMENT_KEY=" + MGMT).encode()
    result, normalized = bridge.parse_unambiguous_compose_credentials(source, raw)
    assert normalized is False
    assert result == source.values(raw)


def facade(raw):
    return SimpleNamespace(
        values=source.values,
        validate_keys=source.validate_keys,
        Blocked=source.Blocked,
        PRESENCE_NAMES=source.PRESENCE_NAMES,
        KEY_NAMES=source.KEY_NAMES,
        MAX_FILE=source.MAX_FILE,
        runtime=lambda: {"env_path": Path("/private/.env")},
        read_private=lambda path: raw,
    )


def test_verified_wrapper_uses_only_management_key_in_memory(monkeypatch):
    calls = []
    quota = SimpleNamespace(
        probe=lambda management_key: (
            calls.append(management_key)
            or {
                "read_only": True,
                "quota_telemetry_read": True,
                "credits_balance_verified": False,
            }
        )
    )
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: (
            facade(raw_config()) if name == "gateway-credentials.py" else quota
        ),
    )
    result = bridge.inspect_stored_credential()
    assert calls == [MGMT]
    assert result["identical_duplicate_keys_checked_in_memory"] is True
    assert result["quota_telemetry_read"] is True
    assert API not in json.dumps(result)
    assert MGMT not in json.dumps(result)


def test_verified_wrapper_denies_conflict_before_network(monkeypatch):
    quota = SimpleNamespace(probe=lambda **kwargs: pytest.fail("unexpected quota call"))
    monkeypatch.setattr(
        bridge,
        "_load_existing",
        lambda name, alias: (
            facade(raw_config(management="ee" * 20))
            if name == "gateway-credentials.py"
            else quota
        ),
    )
    result = bridge.inspect_stored_credential()
    assert result == {
        "read_only": True,
        "quota_telemetry_read": False,
        "stage": "parse_private_key_presence",
        "reason": "duplicate_credential_values_conflict",
    }
