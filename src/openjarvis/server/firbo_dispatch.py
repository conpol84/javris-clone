"""Authenticated VPS selection for existing company Connector workers.

This module selects; the authenticated FIRBO backend revalidates and enqueues.
It does not execute a task, connect to a device or enroll a platform worker.
"""

import datetime as dt
import json
import os
import re
import secrets
import unicodedata
import uuid
from zoneinfo import ZoneInfo

CONTRACT = "firbo-worker-dispatch/v1"
MAX_BODY = 262_144
KINDS = frozenset(
    {
        "list",
        "read",
        "write",
        "exec",
        "browser_open",
        "browser_task",
        "open_app",
        "shortcut",
        "desktop_task",
        "server_task",
    }
)
MAC_APPS = frozenset(
    {
        "safari",
        "finder",
        "numbers",
        "pages",
        "keynote",
        "textedit",
        "preview",
        "shortcuts",
    }
)


class DispatchError(ValueError):
    """A bounded public error code, never a task or credential value."""


def require(value, code):
    if not value:
        raise DispatchError(code)


def identity(value):
    try:
        require(
            isinstance(value, str) and str(uuid.UUID(value)) == value,
            "invalid_identity",
        )
    except (ValueError, AttributeError, TypeError):
        raise DispatchError("invalid_identity") from None
    return value


def text(value, maximum, code):
    require(
        isinstance(value, str)
        and 0 < len(value) <= maximum
        and not any(ord(c) < 32 or ord(c) == 127 for c in value),
        code,
    )
    return value


def bounded_json(value):
    count = 0

    def visit(item, depth):
        nonlocal count
        count += 1
        require(count <= 8192 and depth <= 16, "invalid_json_bound")
        if item is None or type(item) in (str, bool, int, float):
            return
        require(type(item) in (dict, list), "invalid_json_value")
        if isinstance(item, dict):
            require(
                all(isinstance(k, str) and len(k) <= 500 for k in item),
                "invalid_json_key",
            )
            for child in item.values():
                visit(child, depth + 1)
        else:
            for child in item:
                visit(child, depth + 1)

    visit(value, 0)
    try:
        raw = json.dumps(value, allow_nan=False, ensure_ascii=False).encode()
    except (ValueError, UnicodeError, OverflowError):
        raise DispatchError("invalid_json_value") from None
    require(len(raw) <= MAX_BODY, "request_too_large")


def fold(value):
    return " ".join(
        "".join(
            c
            for c in unicodedata.normalize("NFD", value)
            if not unicodedata.combining(c)
        )
        .lower()
        .split()
    )


def mac(device):
    return (
        re.match(r"^(darwin|macos|mac)(?:\s|$)", device["platform"], re.I) is not None
    )


def matches(device, target):
    target = fold(target)
    if target in {"mac", "mac mini", "macbook"}:
        return mac(device)
    if target in {"debian", "linux"}:
        return re.match(r"^linux(?:\s|$)", device["platform"], re.I) is not None
    if target == "windows":
        return (
            re.match(r"^(win32|windows)(?:\s|$)", device["platform"], re.I) is not None
        )
    return fold(device["name"]) == target


def within_hours(policy, now):
    hours = policy.get("hours")
    if hours is None:
        return True
    require(
        isinstance(hours, dict) and set(hours) == {"from", "to", "tz"},
        "invalid_working_hours",
    )
    start, end = hours["from"], hours["to"]
    require(
        type(start) is int
        and type(end) is int
        and 0 <= start <= 24
        and 0 <= end <= 24
        and start != end,
        "invalid_working_hours",
    )
    try:
        zone = ZoneInfo(text(hours["tz"], 64, "invalid_working_hours"))
    except (KeyError, ValueError):
        raise DispatchError("invalid_working_hours") from None
    hour = now.astimezone(zone).hour
    return start <= hour < end if start < end else hour >= start or hour < end


def select_worker(body, *, now=None):
    """Pure selector. Inventory is supplied by the authenticated FIRBO backend."""
    require(type(body) is dict, "invalid_request")
    bounded_json(body)
    required = {
        "contract",
        "request_id",
        "organization_id",
        "kind",
        "params",
        "devices",
    }
    require(
        required <= set(body) <= required | {"target", "device_id", "goal"},
        "invalid_request_fields",
    )
    require(body["contract"] == CONTRACT, "invalid_contract")
    request_id, org = identity(body["request_id"]), identity(body["organization_id"])
    kind, params = body["kind"], body["params"]
    require(
        isinstance(kind, str) and kind in KINDS and type(params) is dict, "invalid_job"
    )
    now = now or dt.datetime.now(dt.timezone.utc)
    require(now.tzinfo is not None, "invalid_clock")
    devices = body["devices"]
    require(type(devices) is list and len(devices) <= 32, "invalid_inventory")
    target = text(body["target"], 120, "invalid_target") if "target" in body else None
    explicit_id = identity(body["device_id"]) if "device_id" in body else None
    goal = body.get("goal")
    if "goal" in body:
        require(
            isinstance(goal, str)
            and 0 < len(goal) <= 4000
            and not any(ord(c) < 32 and c not in "\n\t" for c in goal),
            "invalid_goal",
        )
    seen = set()
    observed = []
    for device in devices:
        require(
            type(device) is dict
            and set(device)
            == {
                "id",
                "name",
                "platform",
                "organization_id",
                "paired",
                "revoked_at",
                "last_seen_at",
                "capabilities",
                "agent_policy",
                "load",
            },
            "invalid_worker_fields",
        )
        did = identity(device["id"])
        require(did not in seen, "duplicate_worker")
        seen.add(did)
        require(identity(device["organization_id"]) == org, "foreign_company_inventory")
        text(device["name"], 100, "invalid_worker_name")
        text(device["platform"], 100, "invalid_worker_platform")
        require(
            type(device["paired"]) is bool
            and type(device["load"]) is int
            and 0 <= device["load"] <= 1000,
            "invalid_worker_state",
        )
        require(
            device["revoked_at"] is None or isinstance(device["revoked_at"], str),
            "invalid_worker_state",
        )
        caps, policy = device["capabilities"], device["agent_policy"]
        require(type(caps) is dict and type(policy) is dict, "invalid_worker_state")
        kinds = caps.get("job_kinds", [])
        require(
            type(kinds) is list
            and len(kinds) <= len(KINDS)
            and all(isinstance(k, str) and k in KINDS for k in kinds)
            and len(set(kinds)) == len(kinds),
            "invalid_worker_capabilities",
        )
        in_hours = within_hours(policy, now)
        recent = False
        if device["last_seen_at"] is not None:
            try:
                seen_at = dt.datetime.fromisoformat(
                    device["last_seen_at"].replace("Z", "+00:00")
                )
                require(seen_at.tzinfo is not None, "invalid_worker_heartbeat")
                age = (now - seen_at).total_seconds()
                recent = -5 <= age <= 60
            except (AttributeError, ValueError, TypeError):
                raise DispatchError("invalid_worker_heartbeat") from None
        available = (
            device["paired"]
            and device["revoked_at"] is None
            and recent
            and policy.get("enabled") is True
            and in_hours
        )
        observed.append((device, available))

    base = {"contract": CONTRACT, "request_id": request_id, "organization_id": org}
    if kind == "server_task":
        require(not target and not explicit_id, "server_task_has_device_target")
        return {
            **base,
            "worker": {
                "kind": "vps",
                "id": "vps",
                "name": "FIRBO VPS",
                "platform": "linux",
            },
            "job": {"kind": kind, "params": params},
            "reason": "server_work_on_vps",
        }

    app = None
    if kind == "open_app":
        app = text(params.get("app"), 60, "invalid_app")
        require(
            app[0].isalnum() and all(c.isalnum() or c in " ._&+'()-" for c in app),
            "invalid_app",
        )
    candidates = observed
    if explicit_id:
        candidates = [(d, a) for d, a in candidates if d["id"] == explicit_id]
        require(len(candidates) == 1, "target_unavailable")
    if target:
        candidates = [(d, a) for d, a in candidates if matches(d, target)]
        require(len(candidates) == 1, "target_ambiguous")
    compatible = []
    for device, available in candidates:
        if not available:
            continue
        if (kind == "shortcut" or (app and fold(app) in MAC_APPS)) and not mac(device):
            continue
        caps, policy = device["capabilities"], device["agent_policy"]
        full = caps.get("full_control") is True and policy.get("control") == "full"
        native = "desktop_task" in caps.get("job_kinds", []) and full
        if kind == "desktop_task" and not native:
            continue
        actual_kind, actual_params = kind, params
        if kind not in caps.get("job_kinds", []):
            if kind != "open_app" or not native:
                continue
            actual_kind, actual_params = "desktop_task", {"goal": goal or f"Open {app}"}
        compatible.append((device, actual_kind, actual_params))
    require(
        compatible,
        "target_unavailable" if explicit_id or target else "no_eligible_worker",
    )
    device, actual_kind, actual_params = min(
        compatible, key=lambda d: (d[0]["load"], d[0]["id"])
    )
    return {
        **base,
        "worker": {
            "kind": "computer",
            "id": device["id"],
            "name": device["name"],
            "platform": device["platform"],
        },
        "job": {"kind": actual_kind, "params": actual_params},
        "reason": "explicit_target"
        if explicit_id or target
        else "lowest_available_load",
    }


def install_worker_dispatch(app):
    """Enable only on the administrator service with a configured API credential."""
    if os.environ.get("FIRBO_WORKER_DISPATCH_ENABLED") != "1":
        return False
    if getattr(app.state, "firbo_worker_dispatch_installed", False):
        return True
    require(bool(getattr(app.state, "api_key", "")), "dispatch_requires_api_key")
    from fastapi import Request
    from fastapi.responses import JSONResponse

    @app.post("/v1/firbo/dispatch", include_in_schema=False)
    async def dispatch(request: Request):
        keys = request.headers.getlist("authorization")
        expected = f"Bearer {app.state.api_key}".encode()
        if len(keys) != 1 or not secrets.compare_digest(keys[0].encode(), expected):
            return JSONResponse({"error": "unauthorized"}, status_code=401)
        try:
            require(
                request.headers.get("content-type", "").split(";")[0].lower()
                == "application/json",
                "json_required",
            )
            chunks, size = [], 0
            async for chunk in request.stream():
                size += len(chunk)
                require(size <= MAX_BODY, "request_too_large")
                chunks.append(chunk)
            body = json.loads(b"".join(chunks))
            result = select_worker(body)
            return JSONResponse(result, headers={"Cache-Control": "no-store"})
        except DispatchError as error:
            unavailable = str(error) in {
                "no_eligible_worker",
                "target_unavailable",
                "target_unavailable",
                "target_ambiguous",
            }
            return JSONResponse(
                {"error": str(error)}, status_code=409 if unavailable else 400
            )
        except (ValueError, TypeError, UnicodeError, RecursionError):
            return JSONResponse({"error": "invalid_request"}, status_code=400)

    app.state.firbo_worker_dispatch_installed = True
    return True
