"""Inspect duplicate credential KEY NAMES/LINE NUMBERS in verified Compose .env.

Never displays, writes, exports or hashes credentials; never edits .env.
Reuses the source-pinned stack verifier and secure private-file reader.
"""

import json
import re

from omniroute_ceo_quota_stack import _failure, _load_existing


def duplicate_summary(data: bytes, recognized: tuple[str, ...]) -> dict:
    if len(data) > 1_000_000:
        return {
            "read_only": True, "stage": "duplicate_key_audit",
            "reason": "configuration_too_large",
        }
    try:
        lines = data.decode("utf-8").splitlines()
    except UnicodeError:
        return {
            "read_only": True, "stage": "duplicate_key_audit",
            "reason": "configuration_not_utf8",
        }
    if len(lines) > 20_000:
        return {
            "read_only": True, "stage": "duplicate_key_audit",
            "reason": "configuration_too_large",
        }
    allowed = frozenset(recognized)
    found: dict[str, list[tuple[int, str]]] = {}
    for line_number, line in enumerate(lines, 1):
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if match is None or match[1] not in allowed:
            continue
        # Same deliberately limited normalization as existing values() parser.
        value = match[2].strip().strip("\"'")
        found.setdefault(match[1], []).append((line_number, value))
    duplicates = sorted(k for k, entries in found.items() if len(entries) > 1)
    return {
        "read_only": True,
        "stage": "duplicate_key_audit",
        "duplicates": {
            key: {
                "count": len(found[key]),
                "lines": [n for n, _ in found[key]],
                "identical_values": all(v == found[key][0][1] for _, v in found[key]),
            }
            for key in duplicates
        },
        "checked_recognized_names": len(allowed),
        "requires_manual_config_review": bool(duplicates),
        "keys_or_values_disclosed": False,
    }


def audit():
    try:
        source = _load_existing("gateway-credentials.py", "firbo_dup_source")
    except Exception:
        return _failure("load_reviewed_source")
    try:
        stack = source.runtime()
    except Exception as exc:
        return _failure("inspect_running_compose", exc, source)
    try:
        raw = source.read_private(stack["env_path"])
    except Exception as exc:
        return _failure("read_verified_private_env", exc, source)
    return duplicate_summary(raw, source.PRESENCE_NAMES)


if __name__ == "__main__":
    print(json.dumps(audit(), sort_keys=True))
