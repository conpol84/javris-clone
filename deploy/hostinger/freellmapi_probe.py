"""Private read-only FreeLLMAPI catalog audit.

Only connects to the fixed localhost listener with the existing unified API key.
It does NOT send a model prompt, expose credentials, change router preferences,
or claim that an advertised model has completed an inference.
"""

import json
import os
import re
import urllib.error
import urllib.request

CATALOG_URL = "http://127.0.0.1:3001/v1/models?execution_status=ready"
MAX_CATALOG_BYTES = 1_000_000
MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,179}\Z")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def catalog_readiness(value):
    """A populated catalog is NOT proof of a connected, usable model.

    The pinned FreeLLMAPI catalog includes disabled/exhausted models and the
    synthetic 'auto' and 'fusion' router entries, even under ready filtering.
    The 'ready' state still includes unprobed provider keys; it is only a
    capacity hint, never an inference receipt or a commercial-use guarantee.
    """
    if not isinstance(value, dict) or not isinstance(value.get("data"), list):
        return None
    data = value["data"]
    if len(data) > 10_000:
        return None
    ready = set()
    for row in data:
        if not isinstance(row, dict):
            continue
        model = row.get("id")
        if not isinstance(model, str) or not MODEL_ID.fullmatch(model):
            continue
        if model in {"auto", "fusion"} or model.startswith("auto:"):
            continue
        if row.get("execution_status") != "ready":
            continue
        ready.add(model)
    return {"catalog_entries": len(data), "model_count": len(ready)}


def probe():
    """No keys, model names, prompts, URLs or upstream error bodies are logged."""
    key = os.environ.get("FREELLMAPI_API_KEY", "")
    if not key or len(key) > 4096 or any(c.isspace() for c in key):
        return {"ready": False, "reason": "inference_key_required"}
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect()
    )
    request = urllib.request.Request(
        CATALOG_URL,
        headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
    )
    try:
        with opener.open(request, timeout=10) as response:
            raw = response.read(MAX_CATALOG_BYTES + 1)
        if len(raw) > MAX_CATALOG_BYTES:
            return {"ready": False, "reason": "catalog_too_large"}
        parsed = catalog_readiness(json.loads(raw))
        if parsed is None:
            return {"ready": False, "reason": "invalid_catalog"}
        return {
            "ready": parsed["model_count"] > 0,
            "connection_verified": True,
            "model_count": parsed["model_count"],
            "catalog_entries": parsed["catalog_entries"],
            "inference_verified": False,
            "commercial_use_verified": False,
            "provider_cost_verified": False,
            **(
                {}
                if parsed["model_count"] > 0
                else {"reason": "no_connected_ready_model"}
            ),
        }
    except urllib.error.HTTPError as exc:
        # A 401 and an exhausted upstream are different operator tasks.
        # Never print provider response bodies or authorization headers.
        reason = (
            "catalog_auth_denied"
            if exc.code in {401, 403}
            else "catalog_rate_limited"
            if exc.code == 429
            else "catalog_unavailable"
        )
        return {"ready": False, "reason": reason}
    except (OSError, ValueError, TypeError):
        return {"ready": False, "reason": "catalog_unavailable"}


if __name__ == "__main__":
    result = probe()
    print(json.dumps(result))
    raise SystemExit(0 if result["ready"] else 1)
