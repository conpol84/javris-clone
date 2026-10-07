#!/usr/bin/env python3
"""Read-only Firbo VPS diagnostics. Never reads .env, credentials or prompts.

No docker exec, pull, build, restart, compose up, database access or inference.
Run: python3 preflight.py. Output contains selected infrastructure metadata only.
"""
from __future__ import annotations

import datetime as dt
import json
import re
import shutil
import subprocess
import urllib.error
import urllib.request
from typing import Any

CONTAINERS = ("firbo-api", "firbo-omniroute", "firbo-caddy", "firbo-redis")
FORMAT = (
    '{"name":{{json .Name}},"image_id":{{json .Image}},'
    '"status":{{json .State.Status}},"restarts":{{json .RestartCount}},'
    '"health":{{if .State.Health}}{{json .State.Health.Status}}{{else}}"not_configured"{{end}},'
    '"mounts":{{json .Mounts}}}'
)


def command(args: list[str]) -> tuple[bool, str]:
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=12, check=False)
        return result.returncode == 0, result.stdout[:100_000]
    except (OSError, subprocess.TimeoutExpired):
        return False, ""


def _word(value: Any, fallback: str = "unknown") -> str:
    return value if isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_.:/-]{1,180}", value) else fallback


def sanitize_container(raw: Any, expected: str) -> dict[str, Any]:
    if not isinstance(raw, dict) or raw.get("name") != "/" + expected:
        return {"name": expected, "verified": False, "reason": "unexpected_docker_response"}
    mounts = []
    rows = raw.get("mounts")
    for mount in rows if isinstance(rows, list) else []:
        if not isinstance(mount, dict):
            continue
        destination = mount.get("Destination")
        # Do not reveal host paths, volume names or arbitrary mount destinations.
        if destination not in {"/app/data", "/home/openjarvis", "/data", "/config", "/etc/caddy/Caddyfile"}:
            continue
        mounts.append({"destination": destination, "type": _word(mount.get("Type")), "writable": mount.get("RW") is True})
    image = raw.get("image_id", "")
    return {"name": expected, "verified": True,
            "image_id": image if isinstance(image, str) and re.fullmatch(r"sha256:[0-9a-f]{64}", image) else "unknown",
            "status": _word(raw.get("status")), "health": _word(raw.get("health")),
            "restarts": raw.get("restarts") if type(raw.get("restarts")) is int else None, "mounts": mounts}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: Any, fp: Any, code: Any, msg: Any, headers: Any, newurl: Any) -> None:
        return None


def health(url: str) -> dict[str, Any]:
    assert url in {"https://api.firboai.app/health", "https://gateway.firboai.app/api/health"}
    result: dict[str, Any] = {"url": url, "http_status": None}
    try:
        request = urllib.request.Request(url, headers={"User-Agent": "Firbo-ReadOnly-Preflight/1"})
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=8) as response:
            result["http_status"] = response.status
            if "json" not in response.headers.get("Content-Type", "").lower():
                result["body_type"] = "not_json"
                return result
            body = response.read(16_385)
            if len(body) > 16_384:
                result["body_type"] = "too_large"
                return result
            data = json.loads(body)
            result["body_type"] = "json"
            # Exact recognition, not arbitrary health strings that might include secrets.
            result["firbo_control_v1"] = isinstance(data, dict) and data.get("contract") == "firbo-control/v1"
            result["status_ok"] = isinstance(data, dict) and data.get("status") in ("ok", "healthy")
    except urllib.error.HTTPError as exc:
        result["http_status"] = exc.code
    except (OSError, ValueError, urllib.error.URLError):
        result["error"] = "unreachable_or_invalid_response"
    return result


def collect() -> dict[str, Any]:
    report: dict[str, Any] = {"contract": "firbo-hostinger-preflight/v1", "checked_at": dt.datetime.now(dt.timezone.utc).isoformat(),
                              "read_only": True, "contains_secrets": False, "containers": [],
                              "limits": ["Not a backup/restore test", "Not a real model request", "Health does not prove inference readiness"]}
    docker = shutil.which("docker")
    report["docker_found"] = bool(docker)
    if docker:
        ok, version = command([docker, "version", "--format", "{{.Server.Version}}"])
        report["docker_accessible"] = ok
        report["docker_server_version"] = _word(version.strip()) if ok else "unavailable"
        ok_compose, compose = command([docker, "compose", "version", "--short"])
        report["compose_version"] = _word(compose.strip()) if ok_compose else "unavailable"
        if ok:
            for name in CONTAINERS:
                found, value = command([docker, "container", "inspect", "--format", FORMAT, name])
                if found:
                    try:
                        report["containers"].append(sanitize_container(json.loads(value), name))
                    except ValueError:
                        report["containers"].append({"name": name, "verified": False, "reason": "invalid_docker_json"})
                else:
                    report["containers"].append({"name": name, "verified": False, "reason": "not_found_or_unreadable"})
    report["public_health"] = [health(url) for url in ("https://api.firboai.app/health", "https://gateway.firboai.app/api/health")]
    return report


if __name__ == "__main__":
    print(json.dumps(collect(), indent=2))
