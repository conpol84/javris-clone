"""Only duplicate credential names and line numbers, no values, no writes."""

import importlib.util
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest

ROOT = Path(__file__).parents[2] / "deploy/hostinger"
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location(
    "duplicate_credential_audit", ROOT / "firbo_duplicate_credential_audit.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

KEYS = (
    "OMNIROUTE_API_KEY",
    "OMNIROUTE_MANAGEMENT_KEY",
    "OPENJARVIS_API_KEY",
    "INITIAL_PASSWORD",
)


def test_duplicate_names_and_line_numbers_only_without_provider_secrets():
    secret1 = "private-management-token-A"
    secret2 = "private-management-token-B"
    content = (
        "OMNIROUTE_API_KEY=api-secret\n"
        "OMNIROUTE_MANAGEMENT_KEY=" + secret1 + "\n"
        "# comment and unrelated app setting\n"
        'INITIAL_PASSWORD="secret-password"\n'
        "OMNIROUTE_MANAGEMENT_KEY=" + secret2 + "\n"
        "INITIAL_PASSWORD='secret-password'\n"
    ).encode()
    result = audit.duplicate_summary(content, KEYS)
    assert result["read_only"] is True
    assert result["requires_manual_config_review"] is True
    assert result["duplicates"] == {
        "INITIAL_PASSWORD": {
            "count": 2,
            "lines": [4, 6],
            "identical_values": True,
        },
        "OMNIROUTE_MANAGEMENT_KEY": {
            "count": 2,
            "lines": [2, 5],
            "identical_values": False,
        },
    }
    assert result["keys_or_values_disclosed"] is False
    encoded = json.dumps(result)
    for secret in (secret1, secret2, "api-secret", "secret-password"):
        assert secret not in encoded


def test_names_of_noncredential_variables_never_enter_the_report():
    content = b"UNRELATED=private\nUNRELATED=another\nOMNIROUTE_MANAGEMENT_KEY=ok\n"
    result = audit.duplicate_summary(content, KEYS)
    assert result["requires_manual_config_review"] is False
    assert result["duplicates"] == {}
    assert "UNRELATED" not in json.dumps(result)


@pytest.mark.parametrize(
    "value,reason",
    [
        (b"\xff", "configuration_not_utf8"),
        (b"x" * 1_000_001, "configuration_too_large"),
    ],
)
def test_garbled_or_oversized_config_fails_closed(value, reason):
    assert audit.duplicate_summary(value, KEYS)["reason"] == reason


def test_source_uses_the_existing_hardened_private_reader_and_no_file_writes(
    monkeypatch,
):
    raw = b"OMNIROUTE_API_KEY=one\nOMNIROUTE_API_KEY=two\n"
    calls = []
    source = SimpleNamespace(
        runtime=lambda: calls.append("runtime") or {"env_path": Path("/private/.env")},
        read_private=lambda p: calls.append(("read_private", str(p))) or raw,
        PRESENCE_NAMES=KEYS,
    )
    monkeypatch.setattr(audit, "_load_existing", lambda name, alias: source)
    with patch.object(os, "open", side_effect=AssertionError("unexpected raw OS open")):
        report = audit.audit()
    assert calls == ["runtime", ("read_private", "/private/.env")]
    assert report["duplicates"]["OMNIROUTE_API_KEY"]["count"] == 2
    assert report["keys_or_values_disclosed"] is False


@pytest.mark.parametrize(
    "fail_at,expected",
    [
        ("runtime", "inspect_running_compose"),
        ("read_private", "read_verified_private_env"),
    ],
)
def test_runtime_and_private_reader_fail_closed_with_no_leak(
    monkeypatch, fail_at, expected
):
    secret = "Bearer confidential-private-password"
    source = SimpleNamespace(
        runtime=lambda: {"env_path": Path("/private/.env")},
        read_private=lambda p: b"secret",
        PRESENCE_NAMES=KEYS,
    )
    setattr(source, fail_at, lambda *a: (_ for _ in ()).throw(RuntimeError(secret)))
    monkeypatch.setattr(audit, "_load_existing", lambda name, alias: source)
    report = audit.audit()
    assert report["stage"] == expected
    assert report["reason"] == "stage_unavailable"
    assert secret not in json.dumps(report)
