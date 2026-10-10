"""Read FIRBO's EXISTING verified Compose key and query OmniRoute quota READ-ONLY.

No key export, .env copy, credentials in argv/shell history, Docker mutation,
model request, usage spend or printing of secrets. The code uses the already
reviewed gateway-credentials.py source to discover the authoritative stack.
"""

from __future__ import annotations

import importlib.util
import json
import os
import re
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


# These are constant, audited error codes emitted by gateway-credentials.py.
# Never surface an arbitrary exception string or Docker stderr; it could
# contain a provider key, stack path or a private account identifier.
_SAFE_BLOCKED_CODES = frozenset(
    {
        "docker_not_installed",
        "local_command_failed_or_timed_out",
        "local_command_failed",
        "local_response_too_large",
        "invalid_local_response",
        "unsafe_or_symlinked_path",
        "expected_container_not_running",
        "invalid_compose_labels",
        "wrong_compose_service",
        "compose_labels_missing",
        "unsafe_compose_directory_permissions",
        "invalid_compose_project",
        "compose_file_outside_stack_directory",
        "mixed_compose_projects",
        "configuration_not_regular_file",
        "configuration_owned_by_another_user",
        "configuration_too_large",
        "configuration_changed",
        "configuration_not_utf8",
        "duplicate_credential_configuration",
        "duplicate_credential_values_conflict",
        "invalid_gateway_key_format",
        "gateway_keys_must_be_distinct",
    }
)


def _failure(stage: str, error: Exception | None = None, source=None):
    """Provide a stage + optional audited code, never a raw secret exception."""
    reason = "stage_unavailable"
    blocked = getattr(source, "Blocked", None)
    if isinstance(blocked, type) and isinstance(error, blocked):
        message = str(error)
        if message in _SAFE_BLOCKED_CODES:
            reason = message
    return {
        "read_only": True,
        "quota_telemetry_read": False,
        "stage": stage,
        "reason": reason,
    }


def parse_unambiguous_compose_credentials(source, contents: bytes):
    """Revalidate identical duplicate keys IN MEMORY; never edit the .env file.

    The original strict values() parser runs first. This compatibility path
    accepts ONLY equal recognized key values, normalized exactly as values()
    does, then runs original values() AND validate_keys() on a transient
    duplicate-free representation. Conflicting keys are always refused.
    """
    try:
        return source.values(contents), False
    except source.Blocked as error:
        if str(error) != "duplicate_credential_configuration":
            raise
    if len(contents) > source.MAX_FILE:
        raise source.Blocked("configuration_too_large")
    try:
        lines = contents.decode("utf-8").splitlines()
    except UnicodeError:
        raise source.Blocked("configuration_not_utf8") from None
    if len(lines) > 20_000:
        raise source.Blocked("configuration_too_large")
    known = frozenset(source.PRESENCE_NAMES)
    first: dict[str, str] = {}
    cleaned = []
    duplicates = 0
    for line in lines:
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if not match or match[1] not in known:
            cleaned.append(line)
            continue
        key = match[1]
        value = match[2].strip().strip("\"'")
        if key not in first:
            first[key] = value
            cleaned.append(line)
        else:
            # Be conservative: any conflicting assignment blocks the audit.
            if value != first[key]:
                raise source.Blocked("duplicate_credential_values_conflict")
            duplicates += 1
    if not duplicates:
        raise source.Blocked("duplicate_credential_configuration")
    # This is a transient Python string ONLY, not a Docker config rewrite.
    normalized = ("\n".join(cleaned) + "\n").encode("utf-8")
    configured = source.values(normalized)
    # Keep all the original security validation for both gateway key scopes.
    source.validate_keys({
        name: configured.get(name, "") for name in source.KEY_NAMES
    })
    return configured, True


def inspect_stored_credential():
    """Stage-safe audit; never guess another .env when ownership checks fail."""
    try:
        source = _load_existing("gateway-credentials.py", "firbo_private_stack")
        quota = _load_existing("omniroute_ceo_quota_probe.py", "firbo_quota")
    except DiagnosticUnavailable:
        return _failure("load_reviewed_source")
    except Exception:
        return _failure("load_reviewed_source")
    try:
        stack = source.runtime()
    except Exception as error:
        return _failure("inspect_running_compose", error, source)
    try:
        contents = source.read_private(stack["env_path"])
    except Exception as error:
        return _failure("read_verified_private_env", error, source)
    try:
        configured, duplicates_accepted = parse_unambiguous_compose_credentials(
            source, contents
        )
    except Exception as error:
        return _failure("parse_private_key_presence", error, source)
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
    try:
        # No shell export or global environment modification. One fixed GET.
        result = quota.probe(management_key=management_key)
    except Exception:
        return _failure("read_gateway_telemetry")
    if not isinstance(result, dict) or result.get("read_only") is not True:
        return _failure("validate_quota_contract")
    return {
        **result,
        "identical_duplicate_keys_checked_in_memory": duplicates_accepted,
    }


if __name__ == "__main__":
    result = inspect_stored_credential()
    print(json.dumps(result, sort_keys=True))
    raise SystemExit(0 if result.get("quota_telemetry_read") else 1)
