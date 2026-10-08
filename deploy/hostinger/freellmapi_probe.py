"""Read-only local FreeLLMAPI readiness; never sends inference or prints keys."""

import json
import os
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def probe():
    key = os.environ.get("FREELLMAPI_API_KEY", "")
    if not key or "\n" in key or "\r" in key:
        return {"ready": False, "reason": "inference_key_required"}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(
        "http://127.0.0.1:3001/v1/models", headers={"Authorization": "Bearer " + key}
    )
    try:
        with opener.open(request, timeout=10) as response:
            raw = response.read(1000001)
            if len(raw) > 1000000:
                return {"ready": False, "reason": "catalog_too_large"}
            catalog = json.loads(raw)
        rows = catalog.get("data") if isinstance(catalog, dict) else None
        if not isinstance(rows, list):
            return {"ready": False, "reason": "invalid_catalog"}
        return {
            "ready": bool(rows),
            "model_count": len(rows),
            "inference_verified": False,
        }
    except (OSError, ValueError):
        return {"ready": False, "reason": "catalog_unavailable"}


if __name__ == "__main__":
    result = probe()
    print(json.dumps(result))
    raise SystemExit(0 if result["ready"] else 1)
