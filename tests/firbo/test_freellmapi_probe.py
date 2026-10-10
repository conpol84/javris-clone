"""FreeLLMAPI model catalog is a hint, not a completed inference or zero-cost proof."""

import importlib.util
import io
import json
import os
import urllib.error
from pathlib import Path
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location(
    "freellmapi_probe",
    Path(__file__).parents[2] / "deploy/hostinger/freellmapi_probe.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def catalog(*rows):
    return json.dumps({"data": list(rows)}).encode()


def ready(model):
    return {"id": model, "execution_status": "ready"}


def run_catalog(body, key="synthetic-local-secret"):
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": key}),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = io.BytesIO(body)
        return module.probe(), factory


@pytest.mark.parametrize("key", ["", "synthetic secret", "secret\ninjected", "secret\rinjected"])
def test_invalid_key_never_contacts_service(key):
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": key}),
        patch.object(module.urllib.request, "build_opener") as opener,
    ):
        assert module.probe()["ready"] is False
        opener.assert_not_called()


def test_one_connected_ready_model_is_only_a_catalog_hint():
    result, factory = run_catalog(
        catalog(
            ready("google/gemini-flash"),
            {"id": "groq/llama", "execution_status": "exhausted"},
            {"id": "mistral-small", "execution_status": "needsKey"},
            {"id": "unprobed-provider"},
            ready("auto"),
            ready("auto:fast"),
            ready("fusion"),
            ready("google/gemini-flash"),
        )
    )
    assert result == {
        "ready": True,
        "connection_verified": True,
        "model_count": 1,
        "catalog_entries": 8,
        "inference_verified": False,
        "commercial_use_verified": False,
        "provider_cost_verified": False,
    }
    factory.return_value.open.assert_called_once()
    request = factory.return_value.open.call_args.args[0]
    assert request.full_url == module.CATALOG_URL
    assert request.full_url.endswith("/v1/models?execution_status=ready")
    assert request.get_header("Authorization") == "Bearer synthetic-local-secret"
    assert "synthetic-local-secret" not in json.dumps(result)


@pytest.mark.parametrize(
    "body",
    [
        catalog(),
        catalog(ready("auto"), ready("fusion"), ready("auto:smart")),
        catalog({"id": "google/gemini", "execution_status": "needsKey"}),
        catalog({"id": "groq/llama", "execution_status": "exhausted"}),
        catalog({"id": "unknown-status"}),
        catalog(ready("evil\nmodel")),
        catalog(ready("no spaces allowed")),
    ],
)
def test_auto_disabled_exhausted_or_unknown_models_never_claim_ready(body):
    result, _ = run_catalog(body)
    assert result["ready"] is False
    assert result["model_count"] == 0
    assert result["reason"] == "no_connected_ready_model"
    assert result["inference_verified"] is False


@pytest.mark.parametrize("body", [b"[]", b"{}", b"not-json", b"<html>unavailable</html>"])
def test_invalid_or_html_catalog_fails_closed(body):
    result, _ = run_catalog(body)
    assert result["ready"] is False
    assert result["reason"] in {"invalid_catalog", "catalog_unavailable"}


def test_catalog_size_cap_rejects_response_without_exposing_contents():
    result, _ = run_catalog(b"x" * (module.MAX_CATALOG_BYTES + 1))
    assert result == {"ready": False, "reason": "catalog_too_large"}


@pytest.mark.parametrize(
    "code,expected",
    [
        (401, "catalog_auth_denied"),
        (403, "catalog_auth_denied"),
        (429, "catalog_rate_limited"),
        (502, "catalog_unavailable"),
    ],
)
def test_http_error_is_sanitized_without_response_body(code, expected):
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": "synthetic-local-secret"}),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = urllib.error.HTTPError(
            module.CATALOG_URL,
            code,
            "secret provider diagnostic",
            None,
            io.BytesIO(b"apikey=supersecret upstream body"),
        )
        assert module.probe() == {"ready": False, "reason": expected}


def test_network_failure_does_not_disclose_secrets():
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": "synthetic-local-secret"}),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = OSError("Bearer supersecret")
        assert module.probe() == {"ready": False, "reason": "catalog_unavailable"}


def test_redirect_is_not_followed():
    assert (
        module.NoRedirect().redirect_request(
            None, None, 302, "", {}, "https://unknown.example"
        )
        is None
    )


def test_local_only_probe_never_posts_or_calls_paid_models():
    result, factory = run_catalog(catalog(ready("google/gemini")))
    assert result["ready"] is True
    assert factory.return_value.open.call_count == 1
    request = factory.return_value.open.call_args.args[0]
    assert request.get_method() == "GET"
    assert request.data is None
