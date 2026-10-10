"""FIRBO native API provenance probe: import, exact Git blob and local GET only.

Run inside the existing firbo-api container via python -B -.
No config/env readback, no credentials, no POST, no AI generation, no filesystem
writes, no container restart. Intended for owner-reviewed live diagnosis.
"""

from __future__ import annotations

import hashlib
import importlib
import json
from pathlib import Path
from urllib import error, request

CONTRACT = "firbo-native-image-provenance/v1"
MODULE = "openjarvis.server.firbo_free_app"
ROUTE = "/v1/firbo/free/local/chat/completions"
# Source from GitHub PR #136 exact head, pinned by the public Git blob fingerprint.
REVIEWED_GIT_BLOB_SHA1 = "edf940a67f8881e7bd828ed8a956252f2a8c67de"


def git_blob_sha1(content: bytes) -> str:
    """Git blob SHA-1, not a raw-file SHA-1 (identical to git hash-object)."""
    prefix = b"blob " + str(len(content)).encode("ascii") + b"\0"
    return hashlib.sha1(prefix + content).hexdigest()


def route_present(app: object) -> bool:
    for route in getattr(app, "routes", []):
        if (
            getattr(route, "path", None) == ROUTE
            and "POST" in (getattr(route, "methods", None) or set())
        ):
            return True
    return False


def check_loopback_get() -> int | str:
    """GET must return HTTP 405 when POST exists; no authentication/inference."""
    try:
        local = request.Request("http://127.0.0.1:8000" + ROUTE, method="GET")
        with request.urlopen(local, timeout=5) as response:
            return response.status
    except error.HTTPError as exc:
        return exc.code
    except Exception:
        return "unreachable"


def inspect() -> dict[str, object]:
    out: dict[str, object] = {"contract": CONTRACT, "read_only": True}
    try:
        mod = importlib.import_module(MODULE)
        source_name = getattr(mod, "__file__", None)
        if not isinstance(source_name, str) or not source_name.endswith(".py"):
            out["module_source"] = "unavailable"
        else:
            content = Path(source_name).read_bytes()
            sha = git_blob_sha1(content)
            out["installed_git_blob_sha1"] = sha
            out["reviewed_git_blob_sha1"] = REVIEWED_GIT_BLOB_SHA1
            out["exact_source_match"] = sha == REVIEWED_GIT_BLOB_SHA1
            out["module_source"] = "read"
        out["local_post_registered"] = route_present(mod.app)
    except Exception as exc:
        out["module_error_type"] = type(exc).__name__
        out["local_post_registered"] = False

    out["loopback_get_http"] = check_loopback_get()
    return out


if __name__ == "__main__":
    print(json.dumps(inspect(), sort_keys=True))
