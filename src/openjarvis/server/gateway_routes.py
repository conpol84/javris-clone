"""Read-only AI gateway overview, proxied server-side from OmniRoute.

The browser never talks to OmniRoute directly: management credentials stay on
the server and only a normalized, secret-free summary is returned (no API keys,
account names or e-mail addresses).

Environment:
  OMNIROUTE_HOST            base URL of the gateway (default http://localhost:20128)
  OMNIROUTE_MANAGEMENT_KEY  API key with manage scope (falls back to OMNIROUTE_API_KEY)
  SUPABASE_URL              when set, the overview is open to signed-in Firbo users:
  SUPABASE_PUBLISHABLE_KEY  their Supabase access token is verified against Supabase
                            (browsers never hold the server's API key)
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections import Counter
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger(__name__)

_TOKEN_TTL_SECONDS = 60.0
_tokens: Dict[str, float] = {}


def supabase_auth_enabled() -> bool:
    return bool(os.environ.get("SUPABASE_URL", "").strip())


async def require_firbo_user(request: Request) -> None:
    """Accept a valid Supabase access token (Firbo login) in place of the API key.

    No-op when Supabase auth is not configured: the global API-key middleware
    then governs this route exactly like every other ``/v1`` route.
    """
    if not supabase_auth_enabled():
        return
    scheme, _, token = request.headers.get("Authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise HTTPException(status_code=401, detail="Sign in to Firbo AI first")
    now = time.monotonic()
    if _tokens.get(token, 0.0) > now:
        return
    base = os.environ["SUPABASE_URL"].rstrip("/")
    apikey = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(4.0)) as client:
            resp = await client.get(
                f"{base}/auth/v1/user",
                headers={"Authorization": f"Bearer {token}", "apikey": apikey},
            )
    except httpx.HTTPError as exc:
        logger.warning("Supabase token check failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Auth service unreachable")
    if resp.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session")
    if len(_tokens) > 512:
        _tokens.clear()
    _tokens[token] = now + _TOKEN_TTL_SECONDS


router = APIRouter(
    prefix="/v1/gateway", tags=["gateway"], dependencies=[Depends(require_firbo_user)]
)

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


# ---------------------------------------------------------------- usage / calls / free models

_USAGE_RANGES = {"1d", "7d", "30d", "90d"}
_extra_cache: Dict[str, Any] = {}


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _usage_summary(payload: Any) -> Dict[str, Any]:
    p = payload if isinstance(payload, dict) else {}
    summary = p.get("summary") if isinstance(p.get("summary"), dict) else {}
    models = []
    for row in (p.get("byModel") or [])[:8]:
        if isinstance(row, dict):
            models.append(
                {
                    "model": str(row.get("model") or "unknown"),
                    "provider": str(row.get("provider") or ""),
                    "requests": int(_num(row.get("requests"))),
                    "tokens": int(_num(row.get("totalTokens"))),
                    "cost": round(_num(row.get("cost")), 4),
                    "avg_latency_ms": int(_num(row.get("avgLatencyMs"))),
                }
            )
    providers = []
    for row in (p.get("byProvider") or [])[:8]:
        if isinstance(row, dict):
            providers.append(
                {
                    "provider": str(
                        row.get("provider") or row.get("name") or row.get("label") or ""
                    ),
                    "requests": int(_num(row.get("requests"))),
                    "tokens": int(_num(row.get("totalTokens"))),
                    "cost": round(_num(row.get("cost")), 4),
                }
            )
    daily = []
    for row in p.get("dailyTrend") or []:
        if isinstance(row, dict) and row.get("date"):
            daily.append(
                {
                    "date": str(row["date"]),
                    "requests": int(_num(row.get("requests"))),
                    "tokens": int(_num(row.get("totalTokens"))),
                    "cost": round(_num(row.get("cost")), 4),
                }
            )
    return {
        "requests": int(_num(summary.get("totalRequests"))),
        "tokens_in": int(_num(summary.get("promptTokens"))),
        "tokens_out": int(_num(summary.get("completionTokens"))),
        "success_rate": _num(summary.get("successRatePct")) / 100.0
        if summary.get("totalRequests")
        else None,
        "avg_latency_ms": int(_num(summary.get("avgLatencyMs"))),
        "cost": round(_num(summary.get("totalCost")), 4),
        "fallbacks": int(_num(summary.get("fallbackCount"))),
        "models": models,
        "providers": providers,
        "daily": daily[-31:],
    }


def _calls_summary(payload: Any, limit: int) -> List[Dict[str, Any]]:
    rows = payload if isinstance(payload, list) else []
    out: List[Dict[str, Any]] = []
    for row in rows[:limit]:
        if not isinstance(row, dict):
            continue
        tokens = row.get("tokens") if isinstance(row.get("tokens"), dict) else {}
        out.append(
            {
                "id": str(row.get("id") or ""),
                "at": str(row.get("timestamp") or ""),
                "provider": str(row.get("providerDisplay") or row.get("provider") or ""),
                "model": str(row.get("model") or ""),
                "status": int(_num(row.get("status"))),
                "duration_ms": int(_num(row.get("duration"))),
                "tokens_in": int(_num(tokens.get("in"))),
                "tokens_out": int(_num(tokens.get("out"))),
                "combo": row.get("comboName") or None,
                "failed": bool(row.get("error")) or _num(row.get("status")) >= 400,
                "active": bool(row.get("active")),
            }
        )
    return out


def _free_summary(payload: Any) -> List[Dict[str, Any]]:
    rows = payload.get("models", []) if isinstance(payload, dict) else []
    out = []
    for row in rows[:200]:
        if isinstance(row, dict):
            out.append(
                {
                    "provider": str(row.get("provider") or ""),
                    "model": str(row.get("modelId") or ""),
                    "name": str(row.get("displayName") or row.get("modelId") or ""),
                    "monthly_tokens": int(_num(row.get("monthlyTokens")))
                    if row.get("monthlyTokens") is not None
                    else None,
                    "free_type": str(row.get("freeType") or ""),
                }
            )
    return out


async def _cached(name: str, path: str, params: Dict[str, Any]) -> tuple[Any, Optional[str]]:
    host, key = _settings()
    cache_key = f"{name}|{host}|{sorted(params.items())}"
    now = time.monotonic()
    hit = _extra_cache.get(cache_key)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS * 2:
        return hit[1], hit[2]
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    errors: Dict[str, str] = {}
    async with httpx.AsyncClient(
        base_url=host, headers=headers, timeout=httpx.Timeout(8.0, connect=2.0)
    ) as client:
        try:
            resp = await client.get(path, params=params)
            if resp.status_code in (401, 403):
                errors[name] = "unauthorized"
                data = None
            else:
                resp.raise_for_status()
                data = resp.json()
        except httpx.HTTPStatusError as exc:
            errors[name] = f"http_{exc.response.status_code}"
            data = None
        except (httpx.HTTPError, ValueError) as exc:
            errors[name] = type(exc).__name__
            data = None
    err = errors.get(name)
    if len(_extra_cache) > 64:
        _extra_cache.clear()
    _extra_cache[cache_key] = (now, data, err)
    return data, err


def _plan_name(plan: Any) -> str:
    if isinstance(plan, str):
        return plan[:60]
    if isinstance(plan, dict):
        for k in ("name", "label", "tier", "plan"):
            if isinstance(plan.get(k), str):
                return plan[k][:60]
    return ""


def _quota_summary(limits: Any, providers: Any) -> List[Dict[str, Any]]:
    caches = limits.get("caches", {}) if isinstance(limits, dict) else {}
    conns = providers.get("connections", []) if isinstance(providers, dict) else []
    names = {
        str(c.get("id")): c for c in conns if isinstance(c, dict) and c.get("id")
    }
    out: List[Dict[str, Any]] = []
    for cid, entry in list(caches.items())[:60]:
        if not isinstance(entry, dict) or not isinstance(entry.get("quotas"), dict):
            continue
        conn = names.get(str(cid), {})
        windows = []
        for wname, w in list(entry["quotas"].items())[:12]:
            if not isinstance(w, dict):
                continue
            pct = w.get("remainingPercentage")
            total = w.get("total")
            used = w.get("used")
            if pct is None and isinstance(total, (int, float)) and total:
                rem = w.get("remaining")
                if isinstance(rem, (int, float)):
                    pct = rem / total * 100
            windows.append(
                {
                    "name": str(wname)[:60],
                    "remaining_pct": round(_num(pct), 1) if pct is not None else None,
                    "used": _num(used) if used is not None else None,
                    "total": _num(total) if total is not None else None,
                    "reset_at": str(w["resetAt"]) if w.get("resetAt") else None,
                    "unlimited": w.get("unlimited") is True,
                }
            )
        if windows:
            out.append(
                {
                    "provider": str(conn.get("provider") or ""),
                    "name": str(conn.get("name") or conn.get("provider") or "")[:80],
                    "plan": _plan_name(entry.get("plan")),
                    "fetched_at": str(entry.get("fetchedAt") or ""),
                    "windows": windows,
                }
            )
    return out


def _keys_summary(payload: Any) -> List[Dict[str, Any]]:
    rows = payload.get("keys", []) if isinstance(payload, dict) else []
    out = []
    for k in rows[:200]:
        if not isinstance(k, dict):
            continue
        out.append(
            {
                "id": str(k.get("id") or ""),
                "name": str(k.get("name") or "")[:80],
                "active": k.get("isActive") is not False,
                "created_at": str(k.get("createdAt") or ""),
                "max_per_day": int(_num(k.get("maxRequestsPerDay")))
                if k.get("maxRequestsPerDay")
                else None,
                "max_per_minute": int(_num(k.get("maxRequestsPerMinute")))
                if k.get("maxRequestsPerMinute")
                else None,
                "expires_at": str(k["expiresAt"]) if k.get("expiresAt") else None,
            }
        )
    return out


@router.get("/usage")
async def gateway_usage(range: str = "7d") -> Dict[str, Any]:
    """Secret-free usage and cost summary for the AI gateway."""
    chosen = range if range in _USAGE_RANGES else "7d"
    data, err = await _cached("usage", "/api/usage/analytics", {"range": chosen})
    return {"range": chosen, "available": data is not None, "error": err, **_usage_summary(data)}


@router.get("/calls")
async def gateway_calls(limit: int = 25) -> Dict[str, Any]:
    """Most recent gateway calls (no prompts or responses, only metadata)."""
    n = max(1, min(int(limit), 50))
    data, err = await _cached(
        "calls", "/api/usage/call-logs", {"limit": n, "excludeTests": 1}
    )
    return {"available": data is not None, "error": err, "calls": _calls_summary(data, n)}


@router.get("/free-models")
async def gateway_free_models() -> Dict[str, Any]:
    """Free-tier model catalogue known to the gateway."""
    data, err = await _cached("free", "/api/free-models", {})
    return {"available": data is not None, "error": err, "models": _free_summary(data)}


@router.get("/quota")
async def gateway_quota() -> Dict[str, Any]:
    """Remaining quota per connected provider account (windows and resets only)."""
    limits, err = await _cached("quota", "/api/usage/provider-limits", {})
    providers, _ = await _cached("quota_providers", "/api/providers", {})
    return {"available": limits is not None, "error": err, "providers": _quota_summary(limits, providers)}


@router.get("/keys")
async def gateway_keys() -> Dict[str, Any]:
    """Gateway API keys: names, status and limits. The key values are never returned."""
    data, err = await _cached("keys", "/api/keys", {})
    return {"available": data is not None, "error": err, "keys": _keys_summary(data)}


__all__ = ["router", "build_overview"]
