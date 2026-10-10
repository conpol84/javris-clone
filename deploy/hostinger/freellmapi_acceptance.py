"""Explicitly approved, ONE-request FreeLLMAPI operator acceptance.

Default action is only the existing read-only status probe. A synthetic,
public, bounded inference is allowed ONLY with --smoke plus an independent
host-only approval flag and one pinned ready model. It may consume an upstream
provider allowance; neither a catalog entry nor a response proves no charges.
Credentials and upstream error text are never emitted.
"""

import argparse
import json
import os
import re
import urllib.error
import urllib.request

from freellmapi_probe import (
    CATALOG_URL,
    MAX_CATALOG_BYTES,
    MODEL_ID,
    NoRedirect,
    catalog_readiness,
    probe,
)

CHAT_URL = "http://127.0.0.1:3001/v1/chat/completions"
MAX_REPLY_BYTES = 100_000
ROUTE_NAME = re.compile(r"[A-Za-z0-9._:/%-]{1,180}\Z")


def _read_json(opener, request, limit):
    with opener.open(request, timeout=20) as response:
        raw = response.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("response_too_large")
        data = json.loads(raw)
        route = response.headers.get("X-Routed-Via", "")
        attempts = response.headers.get("X-Fallback-Attempts", "")
    return data, route, attempts


def smoke():
    """Never infer until three independent opt-ins have been verified."""
    if os.environ.get("FREELLMAPI_SMOKE_APPROVED") != "YES":
        return {"verified": False, "reason": "explicit_approval_required"}

    key = os.environ.get("FREELLMAPI_API_KEY", "")
    model = os.environ.get("FREELLMAPI_SMOKE_MODEL", "")
    if not key or len(key) > 4096 or any(c.isspace() for c in key):
        return {"verified": False, "reason": "inference_key_required"}
    if (
        not isinstance(model, str)
        or not MODEL_ID.fullmatch(model)
        or model in {"auto", "fusion"}
        or model.startswith("auto:")
    ):
        return {"verified": False, "reason": "specific_model_required"}

    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect()
    )
    catalog_request = urllib.request.Request(
        CATALOG_URL,
        headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
    )
    try:
        catalog, _, _ = _read_json(
            opener, catalog_request, MAX_CATALOG_BYTES
        )
        details = catalog_readiness(catalog)
        if details is None or details["model_count"] == 0:
            return {"verified": False, "reason": "no_connected_ready_model"}
        if not any(
            isinstance(row, dict)
            and row.get("id") == model
            and row.get("execution_status") == "ready"
            for row in catalog["data"]
        ):
            return {"verified": False, "reason": "model_not_ready"}

        body = json.dumps(
            {
                "model": model,
                "stream": False,
                "temperature": 0,
                "max_tokens": 24,
                "messages": [
                    {"role": "user", "content": "Reply with the single word OK."}
                ],
            }
        ).encode()
        chat_request = urllib.request.Request(
            CHAT_URL,
            data=body,
            method="POST",
            headers={
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
                "Accept": "application/json",
            },
        )
        response, route, fallback_count = _read_json(
            opener, chat_request, MAX_REPLY_BYTES
        )
        choices = response.get("choices") if isinstance(response, dict) else None
        msg = (
            choices[0].get("message")
            if isinstance(choices, list)
            and choices
            and isinstance(choices[0], dict)
            else None
        )
        text = msg.get("content") if isinstance(msg, dict) else None
        if not isinstance(text, str) or not text.strip():
            return {"verified": False, "reason": "empty_inference"}
        if not isinstance(route, str) or not ROUTE_NAME.fullmatch(route):
            return {"verified": False, "reason": "upstream_identity_unverified"}
        if fallback_count not in {"", "0"}:
            return {
                "verified": False,
                "reason": "multiple_upstream_attempts",
                "provider_cost_verified": False,
            }
        return {
            "verified": True,
            "inference_verified": True,
            "model": model,
            "routed_via": route,
            "provider_cost_verified": False,
            "commercial_use_verified": False,
            "no_paid_fallback_proven": False,
            "scope": "operator_manual_public_prompt",
        }
    except urllib.error.HTTPError as exc:
        return {
            "verified": False,
            "reason": (
                "inference_auth_denied"
                if exc.code in {401, 403}
                else "inference_rate_limited"
                if exc.code == 429
                else "inference_unavailable"
            ),
        }
    except (OSError, ValueError, TypeError):
        return {"verified": False, "reason": "inference_unavailable"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--smoke",
        action="store_true",
        help="perform one explicitly approved public-prompt model inference",
    )
    args = parser.parse_args()
    report = smoke() if args.smoke else probe()
    print(json.dumps(report))
    raise SystemExit(0 if report.get("verified", report.get("ready", False)) else 1)
