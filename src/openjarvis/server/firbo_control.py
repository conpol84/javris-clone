"""Firbo-native, least-privilege control plane for the existing OmniRoute engine.

No gateway cookie or management key is sent to the browser. Reads require a
verified Firbo session; global gateway data and mutations require platform admin.
Mutations stay OFF until the operator enables FIRBO_CONTROL_WRITES_ENABLED.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlsplit
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

log = logging.getLogger(__name__)
MAX_RESPONSE_BYTES = 2_000_000
MANAGED_COMBOS = frozenset({"firbo-economy", "firbo-quality"})
_combo_lock = asyncio.Lock()


@dataclass(frozen=True)
class Principal:
    user_id: str
    token: str = field(repr=False)


def _endpoint(name: str, *, internal: bool = False) -> str:
    value = os.environ.get(name, "").strip().rstrip("/")
    try:
        parsed = urlsplit(value)
        valid_scheme = parsed.scheme == "https" or (
            internal
            and parsed.scheme == "http"
            and parsed.hostname in {"omniroute", "localhost", "127.0.0.1"}
        )
        if (
            not valid_scheme
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError
        _ = parsed.port
    except ValueError:
        raise HTTPException(503, f"{name.lower()}_not_configured") from None
    return value.removesuffix("/v1") if internal else value


async def _read_json(response: httpx.Response) -> Any:
    """Enforce a byte limit WHILE reading, not after materialising a body."""
    size = 0
    parts: list[bytes] = []
    async for chunk in response.aiter_bytes():
        size += len(chunk)
        if size > MAX_RESPONSE_BYTES:
            raise HTTPException(502, "upstream_response_too_large")
        parts.append(chunk)
    try:
        return json.loads(b"".join(parts))
    except (ValueError, UnicodeError):
        raise HTTPException(502, "upstream_invalid_json") from None


async def _request_json(
    method: str, url: str, headers: dict[str, str], body: Any = None
) -> Any:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=3.0), follow_redirects=False
        ) as client:
            async with client.stream(
                method, url, headers=headers, json=body
            ) as response:
                if not 200 <= response.status_code < 300:
                    # Never return upstream error bodies: they can contain credentials.
                    raise HTTPException(502, f"upstream_http_{response.status_code}")
                return await _read_json(response)
    except httpx.HTTPError:
        raise HTTPException(502, "upstream_unreachable") from None


async def _supabase(
    principal: Principal, path: str, *, method: str = "GET", body: Any = None
) -> Any:
    base = _endpoint("SUPABASE_URL")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY", "").strip()
    if not key:
        raise HTTPException(503, "supabase_publishable_key_not_configured")
    return await _request_json(
        method,
        base + path,
        {"Authorization": f"Bearer {principal.token}", "apikey": key},
        body,
    )


async def require_user(request: Request) -> Principal:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not token or len(token) > 8192:
        raise HTTPException(401, "sign_in_required")
    principal = Principal("", token)
    try:
        data = await _supabase(principal, "/auth/v1/user")
    except HTTPException as exc:
        if exc.detail in {"upstream_http_401", "upstream_http_403"}:
            raise HTTPException(401, "invalid_session") from None
        raise
    try:
        user_id = str(UUID(data["id"]))
    except (KeyError, TypeError, ValueError):
        raise HTTPException(401, "invalid_session") from None
    return Principal(user_id, token)


async def _platform_admin(principal: Principal) -> bool:
    result = await _supabase(
        principal, "/rest/v1/rpc/is_platform_admin", method="POST", body={}
    )
    return result is True


async def require_platform_admin(
    principal: Principal = Depends(require_user),
) -> Principal:
    if not await _platform_admin(principal):
        raise HTTPException(403, "platform_admin_required")
    return principal


def writes_enabled() -> bool:
    return os.environ.get("FIRBO_CONTROL_WRITES_ENABLED", "false").lower() == "true"


async def guard_legacy_gateway(
    request: Request, principal: Principal = Depends(require_platform_admin)
) -> None:
    """Old telemetry is global, not tenant-scoped. Do not expose it to customers."""
    if request.method not in {"GET", "HEAD", "OPTIONS"} and not writes_enabled():
        raise HTTPException(503, "gateway_writes_disabled")


async def _gateway(method: str, path: str, body: Any = None) -> Any:
    # Deliberately no fallback from the management key to an inference key.
    key = os.environ.get("OMNIROUTE_MANAGEMENT_KEY", "").strip()
    if not key:
        raise HTTPException(503, "gateway_management_not_configured")
    return await _request_json(
        method,
        _endpoint("OMNIROUTE_HOST", internal=True) + path,
        {"Authorization": f"Bearer {key}", "content-type": "application/json"},
        body,
    )


def _rows(value: Any, key: str) -> list[dict[str, Any]]:
    rows = value.get(key) if isinstance(value, dict) else None
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise HTTPException(502, "gateway_contract_mismatch")
    return rows


def _revision(combo: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(
            combo, sort_keys=True, separators=(",", ":"), ensure_ascii=True
        ).encode()
    ).hexdigest()


def _model_ids(combo: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for step in (
        combo.get("models", []) if isinstance(combo.get("models"), list) else []
    ):
        value = (
            step
            if isinstance(step, str)
            else step.get("model")
            if isinstance(step, dict)
            else None
        )
        if isinstance(value, str):
            out.append(value[:300])
    return out


def _editable(combo: dict[str, Any]) -> bool:
    steps = combo.get("models")
    if combo.get("strategy", "priority") != "priority" or not isinstance(steps, list):
        return False
    return all(
        isinstance(step, str)
        or (
            isinstance(step, dict)
            and isinstance(step.get("model"), str)
            and step.get("type") in {None, "model"}
            and not (set(step) - {"type", "model"})
        )
        for step in steps
    )


def _summary(combo: dict[str, Any]) -> dict[str, Any]:
    # Only these fields may leave the server. No system prompts or provider secrets.
    return {
        "name": str(combo.get("name", ""))[:120],
        "strategy": str(combo.get("strategy", "priority"))[:60],
        "models": _model_ids(combo),
        "revision": _revision(combo),
        "managed": combo.get("name") in MANAGED_COMBOS,
        "editable": _editable(combo),
    }


router = APIRouter(prefix="/v1/firbo", tags=["firbo-control"])


@router.get("/session")
async def session(principal: Principal = Depends(require_user)) -> dict[str, Any]:
    # Query as the caller through RLS, AND explicitly bind the caller's user_id.
    memberships = await _supabase(
        principal,
        "/rest/v1/organization_members?select=organization_id,role,organizations(id,name)"
        f"&user_id=eq.{principal.user_id}&limit=101&order=created_at.asc",
    )
    if not isinstance(memberships, list):
        raise HTTPException(502, "supabase_contract_mismatch")
    companies = []
    for member in memberships[:100]:
        if not isinstance(member, dict) or not isinstance(
            member.get("organizations"), dict
        ):
            continue
        org = member["organizations"]
        companies.append(
            {
                "id": org.get("id"),
                "name": str(org.get("name", ""))[:200],
                "role": member.get("role"),
            }
        )
    return {
        "contract": "firbo-control/v1",
        "platform_admin": await _platform_admin(principal),
        "companies": companies,
        "has_more": len(memberships) > 100,
    }


@router.get("/control")
async def control(
    principal: Principal = Depends(require_platform_admin),
) -> dict[str, Any]:
    errors: dict[str, str] = {}

    async def get(name: str, path: str) -> Any:
        try:
            return await _gateway("GET", path)
        except HTTPException as exc:
            errors[name] = str(exc.detail)
            return None

    health, providers, models, combos = await asyncio.gather(
        get("health", "/api/health"),
        get("providers", "/api/providers"),
        get("models", "/v1/models"),
        get("combos", "/api/combos"),
    )

    def rows(name: str, value: Any, key: str) -> list[dict[str, Any]]:
        if value is None:
            return []
        try:
            result = _rows(value, key)
            if name in {"providers", "combos"} and len(result) > 200:
                errors[name] = "catalogue_truncated"
            return result
        except HTTPException as exc:
            errors[name] = str(exc.detail)
            return []

    connections = [
        {
            "id": str(c.get("id", ""))[:120],
            "provider": str(c.get("provider", ""))[:100],
            "name": str(c.get("name", ""))[:120],
            "active": c.get("isActive") is not False,
            "status": str(c.get("testStatus", "unknown"))[:60],
        }
        for c in rows("providers", providers, "connections")[:200]
    ]
    model_list = [
        {"id": m["id"], "provider": str(m.get("owned_by", ""))[:100]}
        for m in rows("models", models, "data")
        if isinstance(m.get("id"), str) and len(m["id"]) <= 300
    ]
    combo_list = [_summary(c) for c in rows("combos", combos, "combos")[:200]]
    if len(model_list) > 5000:
        errors["models"] = "catalogue_truncated"
    return {
        "contract": "firbo-control/v1",
        "reachable": health is not None,
        "available": not errors,
        "writes_enabled": writes_enabled() and not errors,
        "providers": connections,
        "models": model_list[:5000],
        "combos": combo_list,
        "errors": errors,
    }


class ComboUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: str = Field(pattern=r"^[a-f0-9]{64}$")
    models: list[str] = Field(min_length=1, max_length=12)

    @field_validator("models")
    @classmethod
    def validate_models(cls, value: list[str]) -> list[str]:
        if any(
            not model or len(model) > 300 or any(ord(c) < 32 for c in model)
            for model in value
        ):
            raise ValueError("invalid model id")
        if len(set(value)) != len(value):
            raise ValueError("duplicate models")
        return value


def _audit(request_id: str, user_id: str, name: str, phase: str, revision: str) -> None:
    """Persist an intent BEFORE touching the gateway. No keys, tokens or prompts."""
    location = Path(
        os.environ.get(
            "FIRBO_CONTROL_AUDIT_DB", "/home/openjarvis/firbo-control-audit.sqlite3"
        )
    )
    try:
        location.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(location, os.O_CREAT | os.O_WRONLY, 0o600)
        os.close(fd)
        os.chmod(location, 0o600)
        with sqlite3.connect(location, timeout=5) as db:
            db.execute("pragma synchronous=FULL")
            db.execute(
                "create table if not exists control_events ("
                "request_id text, user_id text, target text, phase text, "
                "revision text, "
                "at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')), "
                "primary key(request_id,phase))"
            )
            db.execute(
                "insert into control_events"
                "(request_id,user_id,target,phase,revision) values(?,?,?,?,?)",
                (request_id, user_id, name, phase, revision),
            )
    except (OSError, sqlite3.Error):
        log.error(
            "firbo_control_audit_unavailable request_id=%s phase=%s", request_id, phase
        )
        raise HTTPException(503, "control_audit_unavailable") from None


@router.post("/control/combos/{name}")
async def update_combo(
    name: str, body: ComboUpdate, principal: Principal = Depends(require_platform_admin)
) -> dict[str, Any]:
    if not writes_enabled():
        raise HTTPException(503, "gateway_writes_disabled")
    if name not in MANAGED_COMBOS:
        raise HTTPException(403, "unmanaged_combo")
    request_id = str(uuid4())
    async with _combo_lock:
        combos = _rows(await _gateway("GET", "/api/combos"), "combos")
        matches = [c for c in combos if c.get("name") == name]
        if len(matches) != 1:
            raise HTTPException(409, "combo_missing_or_ambiguous")
        current = matches[0]
        if _revision(current) != body.expected_revision:
            raise HTTPException(409, "combo_changed_reload")
        # Avoid silently rewriting advanced/composite routing as a simple list.
        if current.get("strategy", "priority") != "priority":
            raise HTTPException(409, "advanced_combo_requires_review")
        if not _editable(current):
            raise HTTPException(409, "advanced_combo_requires_review")
        available = _rows(await _gateway("GET", "/v1/models"), "data")
        combo_names = {c.get("name") for c in combos}
        allowed = {
            m.get("id")
            for m in available
            if isinstance(m.get("id"), str) and m.get("owned_by") != "combo"
        } - combo_names
        if any(m not in allowed for m in body.models):
            raise HTTPException(422, "model_not_in_gateway_catalogue")
        combo_id = current.get("id")
        if not isinstance(combo_id, str) or not combo_id or len(combo_id) > 120:
            raise HTTPException(502, "gateway_contract_mismatch")
        await asyncio.to_thread(
            _audit,
            request_id,
            principal.user_id,
            name,
            "requested",
            body.expected_revision,
        )
        try:
            # Update in place. Never DELETE/recreate a combo that active agents use.
            await _gateway(
                "PUT",
                "/api/combos/" + quote(combo_id, safe=""),
                {"models": body.models},
            )
            actual = _rows(await _gateway("GET", "/api/combos"), "combos")
            saved = next((c for c in actual if c.get("id") == combo_id), None)
            if saved is None or _model_ids(saved) != body.models:
                raise HTTPException(502, "write_verification_failed")
        except HTTPException:
            await asyncio.to_thread(
                _audit,
                request_id,
                principal.user_id,
                name,
                "reconcile_required",
                body.expected_revision,
            )
            raise
        await asyncio.to_thread(
            _audit, request_id, principal.user_id, name, "verified", _revision(saved)
        )
    return {"ok": True, "request_id": request_id, "combo": _summary(saved)}
