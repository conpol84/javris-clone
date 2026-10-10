"""Read-only FreeLLMAPI -> OmniRoute provider wiring audit.

Authenticated to the existing fixed management API, never the public client.
No provider, combo or secret mutation, no inference, no logging API bodies.
"""

import json
import os
import urllib.error
import urllib.request

GATEWAY = "https://gateway.firboai.app"
PROVIDERS = "/api/providers?limit=200"
MODELS = "/api/provider-models?provider=freellmapi"
COMBOS = "/api/combos?limit=200"
LIMIT = 1_000_000


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _read(opener, key, path):
    if path not in {PROVIDERS, MODELS, COMBOS}:
        raise ValueError("unapproved_gateway_path")
    request = urllib.request.Request(
        GATEWAY + path,
        headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
        method="GET",
    )
    with opener.open(request, timeout=12) as response:
        raw = response.read(LIMIT + 1)
    if len(raw) > LIMIT:
        raise ValueError("gateway_response_too_large")
    result = json.loads(raw)
    if not isinstance(result, dict):
        raise ValueError("gateway_invalid_response")
    return result


def _items(payload, key):
    rows = payload.get(key)
    if not isinstance(rows, list) or len(rows) > 200:
        raise ValueError("gateway_invalid_collection")
    total = payload.get("total")
    if total is not None and (type(total) is not int or total != len(rows)):
        raise ValueError("gateway_pagination_incomplete")
    return rows


def probe():
    key = os.environ.get("OMNIROUTE_MANAGEMENT_KEY", "")
    if not key or len(key) > 4096 or any(c.isspace() for c in key):
        return {"ready": False, "reason": "private_management_key_required"}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        providers = _items(_read(opener, key, PROVIDERS), "connections")
        matches = [
            row
            for row in providers
            if isinstance(row, dict) and row.get("provider") == "freellmapi"
        ]
        if len(matches) > 1:
            return {"ready": False, "reason": "duplicate_provider_connections"}
        connected = len(matches) == 1 and matches[0].get("isActive") is True
        if not connected:
            return {
                "ready": False,
                "provider_registered": bool(matches),
                "provider_connected": False,
                "reason": "provider_connection_required",
            }
        models = _items(_read(opener, key, MODELS), "models")
        combos = _items(_read(opener, key, COMBOS), "combos")
        model_count = sum(
            1
            for model in models
            if isinstance(model, dict)
            and isinstance(model.get("id"), str)
            and bool(model["id"].strip())
        )
        registered_ids = {
            row["id"]
            for row in models
            if isinstance(row, dict) and isinstance(row.get("id"), str)
        }
        # A canary NAME alone is not proof that it actually selects FreeLLMAPI.
        expected_refs = {"freellmapi/" + name for name in registered_ids} | {
            name for name in registered_ids if name.startswith("freellmapi/")
        }
        canary = sum(
            1
            for combo in combos
            if isinstance(combo, dict)
            and isinstance(combo.get("name"), str)
            and combo["name"].startswith("firbo-freellmapi-canary")
            and isinstance(combo.get("models"), list)
            and any(
                isinstance(item, str) and item in expected_refs
                for item in combo["models"]
            )
        )
        return {
            "ready": bool(model_count and canary),
            "provider_registered": True,
            "provider_connected": True,
            "registered_model_count": model_count,
            "canary_combo_count": canary,
            "model_inference_verified": False,
            "provider_cost_verified": False,
            "commercial_use_verified": False,
            **(
                {}
                if model_count and canary
                else {"reason": "provider_canary_not_configured"}
            ),
        }
    except urllib.error.HTTPError as error:
        return {
            "ready": False,
            "reason": (
                "management_auth_denied"
                if error.code in {401, 403}
                else "gateway_management_unavailable"
            ),
        }
    except (OSError, ValueError, TypeError):
        return {"ready": False, "reason": "gateway_management_unavailable"}


if __name__ == "__main__":
    report = probe()
    print(json.dumps(report))
    raise SystemExit(0 if report["ready"] else 1)
