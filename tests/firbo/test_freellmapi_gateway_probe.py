"""OmniRoute provider canary read-back never changes companies or provider routes."""

import importlib.util
import io
import json
import os
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location(
    "freellmapi_gateway_probe",
    Path(__file__).parents[2] / "deploy/hostinger/freellmapi_gateway_probe.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def default_payloads():
    return [
        {"connections": [{"provider": "freellmapi", "isActive": True}], "total": 1},
        {"models": [{"id": "qwen3:1.7b"}], "total": 1},
        {
            "combos": [
                {
                    "name": "firbo-freellmapi-canary-owner",
                    "models": ["freellmapi/qwen3:1.7b"],
                }
            ],
            "total": 1,
        },
    ]


def query(payloads):
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": "synthetic-management"}),
        patch.object(module.urllib.request, "build_opener") as opener,
    ):
        opener.return_value.open.side_effect = [
            io.BytesIO(json.dumps(p).encode()) for p in payloads
        ]
        result = module.probe()
        calls = opener.return_value.open.call_args_list
        return result, calls


def test_registered_provider_and_canary_are_candidate_only_not_inference():
    result, calls = query(default_payloads())
    assert result == {
        "ready": True,
        "provider_registered": True,
        "provider_connected": True,
        "registered_model_count": 1,
        "canary_combo_count": 1,
        "model_inference_verified": False,
        "provider_cost_verified": False,
        "commercial_use_verified": False,
    }
    assert len(calls) == 3
    for request_call, path in zip(
        calls, [module.PROVIDERS, module.MODELS, module.COMBOS]
    ):
        req = request_call.args[0]
        assert req.full_url == module.GATEWAY + path
        assert req.get_method() == "GET"
        assert req.get_header("Authorization") == "Bearer synthetic-management"
    assert "synthetic-management" not in json.dumps(result)


@pytest.mark.parametrize("key", ["", "key with spaces", "secret\ninjected"])
def test_missing_management_key_does_not_send_a_request(key):
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": key}),
        patch.object(module.urllib.request, "build_opener") as opener,
    ):
        assert module.probe()["ready"] is False
        opener.assert_not_called()


def test_unregistered_connection_returns_without_model_queries():
    result, calls = query([{"connections": [], "total": 0}])
    assert result["ready"] is False
    assert result["reason"] == "provider_connection_required"
    assert len(calls) == 1


def test_inactive_connection_returns_without_model_queries():
    result, calls = query(
        [{"connections": [{"provider": "freellmapi", "isActive": False}]}]
    )
    assert result["ready"] is False
    assert result["provider_registered"] is True
    assert len(calls) == 1


def test_name_only_canary_is_not_proof_of_a_routed_freellmapi_model():
    payloads = default_payloads()
    payloads[2]["combos"][0]["models"] = ["openai/gpt-model"]
    result, calls = query(payloads)
    assert result["ready"] is False
    assert result["canary_combo_count"] == 0
    assert result["reason"] == "provider_canary_not_configured"
    assert len(calls) == 3


@pytest.mark.parametrize(
    "bad_models",
    [
        [],
        [{"id": ""}],
        [{"id": None}],
    ],
)
def test_unusable_model_registration_never_claims_canary(bad_models):
    payloads = default_payloads()
    payloads[1]["models"] = bad_models
    payloads[1]["total"] = len(bad_models)
    report, _ = query(payloads)
    assert report["ready"] is False
    assert report["canary_combo_count"] == 0


def test_invalid_or_paginated_management_response_fails_closed():
    result, _ = query(
        [{"connections": [{"provider": "freellmapi", "isActive": True}], "total": 2}]
    )
    assert result == {"ready": False, "reason": "gateway_management_unavailable"}


def test_duplicate_provider_connections_need_review():
    result, calls = query(
        [
            {
                "connections": [
                    {"provider": "freellmapi", "isActive": True},
                    {"provider": "freellmapi", "isActive": True},
                ],
                "total": 2,
            }
        ]
    )
    assert result["reason"] == "duplicate_provider_connections"
    assert len(calls) == 1


def test_management_api_scope_does_not_follow_redirects():
    assert (
        module.NoRedirect().redirect_request(
            None, None, 302, "", {}, "http://another-host"
        )
        is None
    )
    with patch.object(module.urllib.request, "build_opener") as factory:
        with pytest.raises(ValueError, match="unapproved_gateway_path"):
            module._read(factory, "synthetic-management", "/api/keys")
        factory.open.assert_not_called()


def test_unauthorized_response_does_not_leak_management_key():
    with (
        patch.dict(os.environ, {"OMNIROUTE_MANAGEMENT_KEY": "synthetic-management"}),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = urllib.error.HTTPError(
            module.GATEWAY + module.PROVIDERS,
            403,
            "secret management error",
            None,
            io.BytesIO(b"private response"),
        )
        assert module.probe() == {
            "ready": False,
            "reason": "management_auth_denied",
        }
