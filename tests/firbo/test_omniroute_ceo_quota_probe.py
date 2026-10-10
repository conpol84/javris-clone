"""FIRBO quota audit: no inference, no key exposure, no false credit claims."""

import datetime as dt
import importlib.util
import io
import json
import os
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location(
    "omniroute_ceo_quota_probe",
    Path(__file__).parents[2] / "deploy/hostinger/omniroute_ceo_quota_probe.py",
)
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)

NOW = dt.datetime(2026, 10, 10, 4, 0, tzinfo=dt.timezone.utc)
KEY = "synthetic-management-secret"


def entry(provider="openai", quota_total=None, remaining=100, reset=None,
          status="valid"):
    return {
        "provider": provider,
        "quotaTotal": quota_total,
        "percentRemaining": remaining,
        "tokenStatus": status,
        "resetAt": reset,
        "name": "confidential-account-name",
        "connectionId": "private-connection-id",
    }


def test_100_percent_remaining_does_not_claim_available_paid_provider_credits():
    data = {"providers": [entry(quota_total=None), entry(quota_total=100)]}
    result = probe.summarize(data, now=NOW)
    assert result["connected_provider_count"] == 2
    assert result["unknown_or_synthetic_quota_connections"] == 2
    assert result["credits_balance_verified"] is False
    assert result["billing_cost_verified"] is False
    assert result["local_ollama_ready_verified"] is False
    assert "confidential-account-name" not in json.dumps(result)
    assert "private-connection-id" not in json.dumps(result)


def test_one_server_cooldown_and_one_expired_token_are_distinct():
    rows = [
        entry(reset="2026-10-10T05:00:00Z", remaining=0, quota_total=100),
        entry(provider="codex", status="expired"),
        entry(provider="openai", reset="2026-10-10T03:00:00Z", status="valid"),
    ]
    result = probe.summarize({"providers": rows}, now=NOW)
    assert result["cooldown_connections"] == 1
    assert result["expired_token_connections"] == 1
    assert result["providers"]["openai"]["cooldowns"] == 1
    assert result["providers"]["codex"]["expired_tokens"] == 1
    assert result["next_reported_cooldown_end_utc"] == "2026-10-10T05:00:00+00:00"
    assert result["credits_balance_verified"] is False


def test_pii_provider_name_is_sanitized_to_aggregate_category():
    rows = [entry(provider="owner-email@example.com")]
    result = probe.summarize({"providers": rows}, now=NOW)
    assert result["unrecognized_provider_connections"] == 1
    assert set(result["providers"]) == {"other"}
    assert "owner-email" not in json.dumps(result)


@pytest.mark.parametrize(
    "data",
    [
        None,
        [],
        {},
        {"providers": None},
        {"providers": "invalid"},
        {"providers": [False]},
        {"providers": [entry()] * 201},
    ],
)
def test_invalid_or_oversized_contract_is_rejected(data):
    assert probe.summarize(data, now=NOW) is None


@pytest.mark.parametrize("secret", ["", "x y", "x\nkey", "x\rkey"])
def test_invalid_management_key_never_opens_network(secret):
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": secret}),
        patch.object(probe.urllib.request, "build_opener") as opener,
    ):
        report = probe.probe()
        assert report["quota_telemetry_read"] is False
        assert report["reason"] == "management_key_required"
        opener.assert_not_called()


def test_only_fixed_quota_get_is_made_and_all_sensitive_fields_are_suppressed():
    data = json.dumps({"providers": [entry(quota_total=None)]}).encode()
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": KEY}),
        patch.object(probe.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = io.BytesIO(data)
        result = probe.probe()
        assert result["quota_telemetry_read"] is True
        factory.assert_called_once()
        request = factory.return_value.open.call_args.args[0]
        assert request.full_url == probe.URL
        assert request.get_method() == "GET"
        assert request.data is None
        assert request.get_header("Authorization") == "Bearer " + KEY
        assert KEY not in json.dumps(result)
        assert "confidential-account-name" not in json.dumps(result)


def test_non_json_response_and_too_large_response_fail_closed():
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": KEY}),
        patch.object(probe.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = io.BytesIO(b"<html>failed</html>")
        assert probe.probe()["reason"] == "gateway_telemetry_unavailable"
        factory.return_value.open.return_value = io.BytesIO(
            b"X" * (probe.MAX_BYTES + 1)
        )
        assert probe.probe()["reason"] == "response_too_large"


@pytest.mark.parametrize(
    "code,expected",
    [
        (401, "management_key_denied"),
        (403, "management_key_denied"),
        (429, "gateway_telemetry_rate_limited"),
        (503, "gateway_telemetry_unavailable"),
    ],
)
def test_no_upstream_body_or_secret_reaches_user_on_http_error(code, expected):
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": KEY}),
        patch.object(probe.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = urllib.error.HTTPError(
            probe.URL, code, "Bearer leaked-provider-secret", None,
            io.BytesIO(b"private cost data"),
        )
        result = probe.probe()
        assert result == {
            "read_only": True,
            "quota_telemetry_read": False,
            "reason": expected,
        }
        assert "secret" not in json.dumps(result)


def test_no_redirect_to_untrusted_provider():
    assert (
        probe.NoRedirect().redirect_request(
            None, None, 302, "redirect", {}, "https://untrusted.example"
        )
        is None
    )
