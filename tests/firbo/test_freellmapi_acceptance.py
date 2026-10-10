"""FreeLLMAPI smoke requires explicit approval and never leaks credentials."""

import importlib.util
import io
import json
import os
from pathlib import Path
from unittest.mock import patch

import pytest

ROOT = Path(__file__).parents[2] / "deploy/hostinger"
spec = importlib.util.spec_from_file_location(
    "freellmapi_acceptance",
    ROOT / "freellmapi_acceptance.py",
)
# The actual CLI finds its sibling module via its script directory.
import sys

sys.path.insert(0, str(ROOT))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

MODEL = "google/gemini-flash"
KEY = "synthetic-local-secret"


class Reply(io.BytesIO):
    def __init__(self, content, headers=None):
        super().__init__(content)
        self.headers = headers or {}


def ready_catalog(model=MODEL):
    return json.dumps(
        {
            "data": [
                {"id": "auto", "execution_status": "ready"},
                {"id": model, "execution_status": "ready"},
                {"id": "needs-a-key", "execution_status": "needsKey"},
            ]
        }
    ).encode()


def completion(text="OK"):
    return json.dumps(
        {
            "choices": [{"message": {"role": "assistant", "content": text}}],
            "usage": {"prompt_tokens": 6, "completion_tokens": 1},
        }
    ).encode()


def settings(approved="YES", model=MODEL):
    return {
        "FREELLMAPI_SMOKE_APPROVED": approved,
        "FREELLMAPI_API_KEY": KEY,
        "FREELLMAPI_SMOKE_MODEL": model,
    }


@pytest.mark.parametrize(
    "override",
    [
        {"FREELLMAPI_SMOKE_APPROVED": ""},
        {"FREELLMAPI_SMOKE_APPROVED": "yes"},
        {"FREELLMAPI_API_KEY": ""},
        {"FREELLMAPI_SMOKE_MODEL": ""},
        {"FREELLMAPI_SMOKE_MODEL": "auto"},
        {"FREELLMAPI_SMOKE_MODEL": "auto:fast"},
        {"FREELLMAPI_SMOKE_MODEL": "model with spaces"},
    ],
)
def test_missing_approval_or_specific_model_causes_zero_network(override):
    values = {**settings(), **override}
    with (
        patch.dict(os.environ, values),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        assert module.smoke()["verified"] is False
        factory.assert_not_called()


def test_success_requires_one_exact_model_and_proven_serving_identity():
    responses = [
        Reply(ready_catalog()),
        Reply(completion(), {"X-Routed-Via": "google/gemini-flash"}),
    ]
    with (
        patch.dict(os.environ, settings()),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = responses
        result = module.smoke()
        assert result == {
            "verified": True,
            "inference_verified": True,
            "model": MODEL,
            "routed_via": "google/gemini-flash",
            "provider_cost_verified": False,
            "commercial_use_verified": False,
            "no_paid_fallback_proven": False,
            "scope": "operator_manual_public_prompt",
        }
        assert factory.return_value.open.call_count == 2
        catalog_request = factory.return_value.open.call_args_list[0].args[0]
        chat_request = factory.return_value.open.call_args_list[1].args[0]
        assert catalog_request.full_url == module.CATALOG_URL
        assert catalog_request.get_method() == "GET"
        assert chat_request.full_url == module.CHAT_URL
        assert chat_request.get_method() == "POST"
        assert json.loads(chat_request.data)["model"] == MODEL
        assert json.loads(chat_request.data)["max_tokens"] == 24
        assert json.loads(chat_request.data)["messages"] == [
            {"role": "user", "content": "Reply with the single word OK."}
        ]
        assert "synthetic-local-secret" not in json.dumps(result)


def test_catalog_model_not_ready_never_starts_inference():
    with (
        patch.dict(os.environ, settings(model="groq/unavailable")),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = Reply(ready_catalog())
        assert module.smoke() == {
            "verified": False,
            "reason": "model_not_ready",
        }
        assert factory.return_value.open.call_count == 1


@pytest.mark.parametrize("response_body", [b"not-json", b"<html>error</html>"])
def test_non_json_catalog_never_posts(response_body):
    with (
        patch.dict(os.environ, settings()),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.return_value = Reply(response_body)
        assert module.smoke()["verified"] is False
        assert factory.return_value.open.call_count == 1


@pytest.mark.parametrize(
    "second_response,reason",
    [
        (Reply(completion("  "), {"X-Routed-Via": "google/gemini"}), "empty_inference"),
        (Reply(completion(), {}), "upstream_identity_unverified"),
        (
            Reply(completion(), {"X-Routed-Via": "key=supersecret\nleak"}),
            "upstream_identity_unverified",
        ),
        (
            Reply(
                completion(),
                {"X-Routed-Via": "groq/llama", "X-Fallback-Attempts": "2"},
            ),
            "multiple_upstream_attempts",
        ),
    ],
)
def test_incomplete_provider_receipt_cannot_claim_success(second_response, reason):
    with (
        patch.dict(os.environ, settings()),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = [
            Reply(ready_catalog()),
            second_response,
        ]
        result = module.smoke()
        assert result["verified"] is False
        assert result["reason"] == reason
        assert KEY not in json.dumps(result)


@pytest.mark.parametrize("status", [401, 403, 429, 503])
def test_upstream_http_failure_is_bounded_and_sanitized(status):
    import urllib.error

    with (
        patch.dict(os.environ, settings()),
        patch.object(module.urllib.request, "build_opener") as factory,
    ):
        factory.return_value.open.side_effect = [
            Reply(ready_catalog()),
            urllib.error.HTTPError(
                module.CHAT_URL,
                status,
                "Bearer supersecret upstream exception",
                None,
                io.BytesIO(b"secret response"),
            ),
        ]
        report = module.smoke()
        assert report["verified"] is False
        assert "secret" not in json.dumps(report)
        assert factory.return_value.open.call_count == 2
