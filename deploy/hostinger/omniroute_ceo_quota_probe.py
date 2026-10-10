"""FIRBO CEO read-only OmniRoute provider rate-limit diagnostic.

This is NOT a paid-provider credit or invoice verifier: OmniRoute may return
synthetic 0-100 quota percentages when provider limit headers are unavailable.
Never perform inference or expose connection identifiers, names, emails, keys,
upstream messages, or model prompts.
"""

import datetime as dt
import json
import os
import re
import urllib.error
import urllib.request

URL = "https://gateway.firboai.app/api/usage/quota"
MAX_BYTES = 250_000
PROVIDER_ID = re.compile(r"[a-z0-9][a-z0-9_.-]{0,39}\Z")
TOKEN_STATUS = {"valid", "expiring", "expired", "refreshing"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _utc(value):
    if not isinstance(value, str) or len(value) > 45:
        return None
    try:
        when = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return when.astimezone(dt.timezone.utc) if when.tzinfo else None
    except ValueError:
        return None


def summarize(payload, now=None):
    """Unknown/estimated quota is never interpreted as available API credits."""
    if not isinstance(payload, dict):
        return None
    rows = payload.get("providers")
    if not isinstance(rows, list) or len(rows) > 200:
        return None
    now = now or dt.datetime.now(dt.timezone.utc)
    summary = {}
    cooldowns = 0
    expired = 0
    unknown = 0
    others = 0
    earliest = None
    for row in rows:
        if not isinstance(row, dict):
            return None
        name = row.get("provider")
        if not isinstance(name, str) or not PROVIDER_ID.fullmatch(name):
            name = "other"
        status = row.get("tokenStatus")
        if status not in TOKEN_STATUS:
            status = "unknown"
        reset = _utc(row.get("resetAt"))
        cooldown = reset is not None and reset > now
        if cooldown:
            cooldowns += 1
            earliest = min(earliest, reset) if earliest else reset
        if status == "expired":
            expired += 1
        # Both null and 100-unit totals may be synthetic and must never be
        # advertised as actual provider credits, even when '100% remaining'.
        total = row.get("quotaTotal")
        if total is None or total == 100 or type(total) not in {int, float}:
            unknown += 1
        if name == "other":
            others += 1
        entry = summary.setdefault(
            name, {"connections": 0, "cooldowns": 0, "expired_tokens": 0}
        )
        entry["connections"] += 1
        entry["cooldowns"] += int(cooldown)
        entry["expired_tokens"] += int(status == "expired")
    return {
        "read_only": True,
        "quota_telemetry_read": True,
        "connected_provider_count": len(rows),
        "providers": summary,
        "cooldown_connections": cooldowns,
        "expired_token_connections": expired,
        "unknown_or_synthetic_quota_connections": unknown,
        "unrecognized_provider_connections": others,
        "next_reported_cooldown_end_utc": (
            earliest.isoformat() if earliest is not None else None
        ),
        "credits_balance_verified": False,
        "billing_cost_verified": False,
        "local_ollama_ready_verified": False,
    }


def probe():
    key = os.environ.get("OMNIROUTE_MANAGEMENT_KEY", "")
    if not key or len(key) > 4096 or any(c.isspace() for c in key):
        return {"read_only": True, "quota_telemetry_read": False,
                "reason": "management_key_required"}
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({}), NoRedirect()
    )
    request = urllib.request.Request(
        URL, method="GET",
        headers={"Authorization": "Bearer " + key, "Accept": "application/json"},
    )
    try:
        with opener.open(request, timeout=10) as response:
            raw = response.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES:
            return {"read_only": True, "quota_telemetry_read": False,
                    "reason": "response_too_large"}
        parsed = summarize(json.loads(raw))
        if parsed is None:
            return {"read_only": True, "quota_telemetry_read": False,
                    "reason": "quota_contract_unverified"}
        return parsed
    except urllib.error.HTTPError as exc:
        reason = (
            "management_key_denied" if exc.code in {401, 403}
            else "gateway_telemetry_rate_limited" if exc.code == 429
            else "gateway_telemetry_unavailable"
        )
        return {"read_only": True, "quota_telemetry_read": False,
                "reason": reason}
    except (OSError, ValueError, TypeError):
        return {"read_only": True, "quota_telemetry_read": False,
                "reason": "gateway_telemetry_unavailable"}


if __name__ == "__main__":
    report = probe()
    print(json.dumps(report))
    raise SystemExit(0 if report.get("quota_telemetry_read") else 1)
