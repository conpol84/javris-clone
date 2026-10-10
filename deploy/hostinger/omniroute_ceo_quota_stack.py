"""Read FIRBO's EXISTING verified Compose key and query OmniRoute quota READ-ONLY.

No key export, .env copy, credentials in argv/shell history, Docker mutation,
model request, usage spend or printing of secrets. The code uses the already
reviewed gateway-credentials.py source to discover the authoritative stack.
"""

from __future__ import annotations

import importlib.util
import json
import os
import stat
from pathlib import Path


class DiagnosticUnavailable(Exception):
    """Sanitized operator-facing failure, not a raw file/Docker exception."""


def _load_existing(name: str, alias: str):
    if name not in {"gateway-credentials.py", "omniroute_ceo_quota_probe.py"}:
        raise DiagnosticUnavailable("unexpected_source_name")
    root = Path(__file__).resolve().parent
    path = root / name
    try:
        info = path.lstat()
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.geteuid()
            or info.st_mode & 0o022
            or path.resolve().parent != root
        ):
            raise DiagnosticUnavailable("unsafe_source_file")
        spec = importlib.util.spec_from_file_location(alias, path)
        if spec is None or spec.loader is None:
            raise DiagnosticUnavailable("source_unavailable")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except DiagnosticUnavailable:
        raise
    except (OSError, ValueError, ImportError):
        raise DiagnosticUnavailable("source_unavailable") from None


def inspect_stored_credential():
    try:
        source = _load_existing("gateway-credentials.py", "firbo_private_stack")
        quota = _load_existing("omniroute_ceo_quota_probe.py", "firbo_quota")
        stack = source.runtime()  # Existing running firbo-api + OmniRoute Compose IDs
        contents = source.read_private(stack["env_path"])  # Read-only, no symlinks
        configured = source.values(contents)
        management_key = configured.get("OMNIROUTE_MANAGEMENT_KEY", "")
        inference_key = configured.get("OMNIROUTE_API_KEY", "")
        if not management_key:
            return {
                "read_only": True,
                "quota_telemetry_read": False,
                "reason": "management_key_missing_in_verified_stack",
            }
        if management_key == inference_key:
            return {
                "read_only": True,
                "quota_telemetry_read": False,
                "reason": "management_and_inference_key_not_separated",
            }
        # Pass ONLY within this process. No global environment mutation.
        result = quota.probe(management_key=management_key)
        if not isinstance(result, dict) or result.get("read_only") is not True:
            raise DiagnosticUnavailable("quota_contract_unverified")
        return result
    except DiagnosticUnavailable as exc:
        return {
            "read_only": True,
            "quota_telemetry_read": False,
            "reason": str(exc),
        }
    except Exception:
        # Existing helper raises a private Blocked code or OS exception.
        # Never echo raw Docker stderr, stack paths or credential values.
        return {
            "read_only": True,
            "quota_telemetry_read": False,
            "reason": "verified_compose_credentials_unavailable",
        }


if __name__ == "__main__":
    result = inspect_stored_credential()
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result.get("quota_telemetry_read") else 1)
