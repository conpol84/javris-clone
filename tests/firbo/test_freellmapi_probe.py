"""Readiness must not claim inference or disclose upstream failures/secrets."""

import importlib.util
import io
import os
from pathlib import Path
from unittest.mock import patch

import pytest

spec = importlib.util.spec_from_file_location(
    "freellmapi_probe",
    Path(__file__).parents[2] / "deploy/hostinger/freellmapi_probe.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.mark.parametrize("key", ["", "secret\ninjected", "secret\rinjected"])
def test_invalid_key_never_contacts_service(key):
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": key}),
        patch.object(module.urllib.request, "build_opener") as opener,
    ):
        assert module.probe()["ready"] is False
        opener.assert_not_called()


@pytest.mark.parametrize(
    "body,ready",
    [(b'{"data":[{"id":"model"}]}', True), (b'{"data":[]}', False), (b"[]", False)],
)
def test_catalog_is_readiness_only(body, ready):
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": "secret"}),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = io.BytesIO(body)
        result = module.probe()
        assert result["ready"] is ready
        assert result.get("inference_verified", False) is False
        request = factory.return_value.open.call_args.args[0]
        assert request.full_url == "http://127.0.0.1:3001/v1/models"


def test_failure_does_not_disclose_secret():
    with (
        patch.dict(os.environ, {"FREELLMAPI_API_KEY": "secret"}),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = OSError("secret upstream response")
        assert module.probe() == {"ready": False, "reason": "catalog_unavailable"}


def test_redirect_is_not_followed():
    assert (
        module.NoRedirect().redirect_request(None, None, 302, "", {}, "https://other")
        is None
    )
