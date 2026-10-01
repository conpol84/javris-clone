"""Read-only AI gateway overview, proxied server-side from OmniRoute.

The browser never talks to OmniRoute directly: management credentials stay on
the server and only a normalized, secret-free summary is returned (no API keys,
account names or e-mail addresses).

Environment:
  OMNIROUTE_HOST            base URL of the gateway (default http://localhost:20128)
  OMNIROUTE_MANAGEMENT_KEY  API key with manage scope (falls back to OMNIROUTE_API_KEY)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import Counter
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/gateway", tags=["gateway"])

_DEFAULT_HOST = "http://localhost:20128"
_TIMEOUT = httpx.Timeout(4.0, connect=2.0)
_CACHE_TTL_SECONDS = 5.0
_cache: Dict[str, Any] = {"at": 0.0, "key": "", "value": None}


def _settings() -> tuple[str, str]:
    host = os.environ.get("OMNIROUTE_HOST", _DEFAULT_HOST).rstrip("/")
    if host.endswith("/v1"):
        host = host[: -len("/v1")]
    key = os.environ.get("OMNIROUTE_MANAGEMENT_KEY") or os.environ.get(
        "OMNIROUTE_API_KEY", ""
    )
    return host, key


async def _get_json(
    client: httpx.AsyncClient, path: str, errors: Dict[str, str], name: str
) -> Optional[Any]:
    try:
        resp = await client.get(path)
        if resp.status_code == 401 or resp.status_code == 403:
            errors[name] = "unauthorized"
            return None
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        errors[name] = f"http_{exc.response.status_code}"
    except (httpx.HTTPError, ValueError) as exc:
        errors[name] = type(exc).__name__
    return None


def _models_summary(payload: Any) -> Dict[str, Any]:
    data = payload.get("data", []) if isinstance(payload, dict) else []
    providers: Counter[str] = Counter()
    combos: List[str] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        owner = str(item.get("owned_by") or "unknown")
        if owner == "combo":
            combos.append(str(item.get("id", "")))
        else:
            providers[owner] += 1
    return {
        "total": sum(providers.values()),
        "providers": [
            {"provider": name, "models": count}
            for name, count in providers.most_common()
        ],
        "combo_ids": combos,
    }


def _connections_summary(payload: Any) -> List[Dict[str, Any]]:
    rows = payload.get("connections", []) if isinstance(payload, dict) else []
    agg: Dict[str, Dict[str, Any]] = {}
    now_ms = time.time() * 1000
    for row in rows:
        if not isinstance(row, dict):
            continue
        provider = str(row.get("provider") or "unknown")
        entry = agg.setdefault(
            provider,
            {
                "provider": provider,
                "connections": 0,
                "active": 0,
                "healthy": 0,
                "limited": 0,
            },
        )
        entry["connections"] += 1
        if row.get("isActive", True):
            entry["active"] += 1
        status = str(row.get("testStatus") or "").lower()
        if status in {"active", "success", "ok", "healthy"}:
            entry["healthy"] += 1
        limited = row.get("rateLimitedUntil")
        try:
            if limited and float(limited) > now_ms:
                entry["limited"] += 1
        except (TypeError, ValueError):
            if limited:
                entry["limited"] += 1
    return sorted(agg.values(), key=lambda e: (-e["connections"], e["provider"]))


def _combos_summary(payload: Any) -> List[Dict[str, Any]]:
    rows = payload.get("combos", []) if isinstance(payload, dict) else []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        models = row.get("models")
        out.append(
            {
                "name": str(row.get("name", "")),
                "strategy": str(row.get("strategy") or "priority"),
                "steps": len(models) if isinstance(models, list) else 0,
            }
        )
    return out


def _stats_summary(payload: Any) -> List[Dict[str, Any]]:
    rows = payload.get("providers", []) if isinstance(payload, dict) else []
    out = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        total = int(row.get("totalRequests") or 0)
        ok = int(row.get("successfulRequests") or 0)
        out.append(
            {
                "provider": str(row.get("provider", "")),
                "requests": total,
                "success_rate": round(ok / total, 4) if total else None,
                "avg_latency_ms": row.get("avgLatencyMs"),
                "tokens_in": int(row.get("totalTokensIn") or 0),
                "tokens_out": int(row.get("totalTokensOut") or 0),
            }
        )
    return out


async def build_overview() -> Dict[str, Any]:
    host, key = _settings()
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    errors: Dict[str, str] = {}
    async with httpx.AsyncClient(
        base_url=host, headers=headers, timeout=_TIMEOUT
    ) as client:
        health, models, providers, combos, stats = await asyncio.gather(
            _get_json(client, "/api/health", errors, "health"),
            _get_json(client, "/v1/models", errors, "models"),
            _get_json(client, "/api/providers", errors, "providers"),
            _get_json(client, "/api/combos", errors, "combos"),
            _get_json(client, "/api/provider-stats", errors, "stats"),
        )
    return {
        "connected": health is not None,
        "host": host,
        "has_key": bool(key),
        "models": _models_summary(models),
        "connections": _connections_summary(providers),
        "combos": _combos_summary(combos),
        "stats": _stats_summary(stats),
        "errors": errors,
    }


@router.get("/overview")
async def gateway_overview() -> Dict[str, Any]:
    """Normalized, secret-free OmniRoute summary. Never raises: failures are
    reported in ``errors`` so the UI can show a degraded state."""
    host, key = _settings()
    cache_key = f"{host}|{bool(key)}"
    now = time.monotonic()
    if (
        _cache["value"] is not None
        and _cache["key"] == cache_key
        and now - _cache["at"] < _CACHE_TTL_SECONDS
    ):
        return _cache["value"]
    value = await build_overview()
    _cache.update({"at": now, "key": cache_key, "value": value})
    return value


__all__ = ["router", "build_overview"]
