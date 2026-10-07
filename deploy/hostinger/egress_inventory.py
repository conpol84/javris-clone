#!/usr/bin/env python3
"""Collect bounded, secret-free host facts for a FIRBO egress rollout.

This tool is read-only. It never reads environment variables, proxy contents,
logs, databases or credentials; never uses docker exec; and never starts,
stops, installs or reloads anything. Command failures are reduced to fixed
status values, and raw stdout/stderr is never included in the report.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import ipaddress
import json
import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable

CONTRACT = "firbo-egress-host-inventory/v1"
SERVICE_PATHS = (
    "src/openjarvis/security/mcp_egress.py",
    "src/openjarvis/server/firbo_mcp_egress.py",
    "src/openjarvis/security/page_egress.py",
    "src/openjarvis/server/firbo_page_egress.py",
)
EDGE_PATHS = (
    "supabase/functions/_shared/mcp-egress.ts",
    "supabase/functions/_shared/page-egress.ts",
)
EXISTING_CONTAINERS = ("firbo-api", "firbo-omniroute", "firbo-caddy", "firbo-redis")
CANDIDATE_CONTAINERS = ("firbo-mcp-egress", "firbo-page-egress")
EGRESS_UNITS = ("firbo-mcp-egress.service", "firbo-page-egress.service")
MAX_COMMAND_OUTPUT = 64 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
MAX_SERVICE_BYTES = 256 * 1024
DOCKER_FORMAT = (
    '{"name":{{json .Name}},"running":{{json .State.Running}},'
    '"ports":{{json .NetworkSettings.Ports}},'
    '"networks":{{json .NetworkSettings.Networks}},'
    '"mounts":{{json .Mounts}}}'
)


class InventoryError(ValueError):
    """Fixed-code inventory failure; never contains upstream output."""


Runner = Callable[[list[str]], tuple[bool, str]]


def _fail(code: str) -> None:
    raise InventoryError(code)


def command(args: list[str]) -> tuple[bool, str]:
    try:
        result = subprocess.run(
            args, capture_output=True, text=True, timeout=12, check=False
        )
    except (OSError, subprocess.TimeoutExpired):
        return False, ""
    output = result.stdout
    if len(output.encode("utf-8", errors="ignore")) > MAX_COMMAND_OUTPUT:
        return False, ""
    return result.returncode == 0, output


def _json(raw: bytes, code: str) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        value: dict[str, Any] = {}
        for key, item in items:
            if key in value:
                _fail(code)
            value[key] = item
        return value

    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (UnicodeError, ValueError):
        _fail(code)


def _private_bind(value: str) -> str:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        _fail("bind_invalid")
    if address.version != 4:
        _fail("bind_not_private")
    rfc1918 = any(
        address in network
        for network in (
            ipaddress.ip_network("10.0.0.0/8"),
            ipaddress.ip_network("172.16.0.0/12"),
            ipaddress.ip_network("192.168.0.0/16"),
        )
    )
    if not (address.is_loopback or rfc1918):
        _fail("bind_not_private")
    return "loopback" if address.is_loopback else "private"


def _port(value: int) -> int:
    if type(value) is not int or not 1024 <= value <= 65535:
        _fail("port_invalid")
    return value


def _safe_read(path: Path, limit: int, code: str) -> bytes:
    descriptor = -1
    try:
        descriptor = os.open(
            path,
            os.O_RDONLY | os.O_CLOEXEC | getattr(os, "O_NOFOLLOW", 0),
        )
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode) or not 0 <= before.st_size <= limit:
            _fail(code)
        with os.fdopen(descriptor, "rb") as stream:
            descriptor = -1
            raw = stream.read(limit + 1)
            after = os.fstat(stream.fileno())
    except OSError:
        _fail(code)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
    if (
        len(raw) > limit
        or len(raw) != before.st_size
        or (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
        != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    ):
        _fail(code)
    return raw


def _contained_file(root: Path, relative: str) -> Path:
    if Path(relative).is_absolute() or ".." in Path(relative).parts:
        _fail("service_path_invalid")
    try:
        base = root.resolve(strict=True)
        if not base.is_dir() or root.is_symlink():
            _fail("service_root_invalid")
        candidate = base
        for part in Path(relative).parts:
            candidate = candidate / part
            if candidate.is_symlink():
                _fail("service_path_invalid")
        resolved = candidate.resolve(strict=True)
    except OSError:
        _fail("service_path_invalid")
    if resolved.parent == base or base not in resolved.parents:
        _fail("service_path_invalid")
    return resolved


def _manifest(path: Path) -> tuple[str, dict[str, dict[str, Any]]]:
    raw = _safe_read(path, MAX_MANIFEST_BYTES, "manifest_invalid")
    value = _json(raw, "manifest_invalid")
    if (
        not isinstance(value, dict)
        or set(value) != {"schema", "source", "files"}
        or value.get("schema") != "firbo-egress-bundle/v1"
        or not re.fullmatch(r"[0-9a-f]{40}", str(value.get("source")))
    ):
        _fail("manifest_invalid")
    files = value.get("files")
    if not isinstance(files, list):
        _fail("manifest_invalid")
    rows: dict[str, dict[str, Any]] = {}
    for item in files:
        if (
            not isinstance(item, dict)
            or set(item) != {"kind", "path", "sha256", "bytes"}
            or item.get("path") in rows
            or item.get("kind") not in {"service", "edge"}
            or not isinstance(item.get("path"), str)
            or not re.fullmatch(r"[0-9a-f]{64}", str(item.get("sha256")))
            or type(item.get("bytes")) is not int
            or not 0 < item["bytes"] <= MAX_SERVICE_BYTES
        ):
            _fail("manifest_invalid")
        rows[item["path"]] = item
    if set(rows) != set(SERVICE_PATHS + EDGE_PATHS):
        _fail("manifest_invalid")
    if any(
        path not in rows or rows[path]["kind"] != "service" for path in SERVICE_PATHS
    ):
        _fail("manifest_invalid")
    if any(path not in rows or rows[path]["kind"] != "edge" for path in EDGE_PATHS):
        _fail("manifest_invalid")
    return hashlib.sha256(raw).hexdigest(), rows


def service_readback(root: Path, manifest_path: Path) -> dict[str, Any]:
    manifest_sha, rows = _manifest(manifest_path)
    files = []
    all_match = True
    for relative in SERVICE_PATHS:
        raw = _safe_read(
            _contained_file(root, relative), MAX_SERVICE_BYTES, "service_file_invalid"
        )
        digest = hashlib.sha256(raw).hexdigest()
        matches = (
            digest == rows[relative]["sha256"] and len(raw) == rows[relative]["bytes"]
        )
        all_match = all_match and matches
        files.append(
            {
                "path": relative,
                "sha256": digest,
                "bytes": len(raw),
                "matches_manifest": matches,
            }
        )
    return {
        "performed": True,
        "bundle_manifest_sha256": manifest_sha,
        "all_files_match": all_match,
        "files": files,
    }


def _container(raw: str, expected: str) -> tuple[dict[str, Any], set[str]]:
    value = _json(raw.encode(), "docker_response_invalid")
    if not isinstance(value, dict) or value.get("name") != "/" + expected:
        return {"name": expected, "found": False}, set()
    networks = value.get("networks")
    network_names = set(networks) if isinstance(networks, dict) else set()
    ports = value.get("ports")
    published: set[int] = set()
    if isinstance(ports, dict):
        for bindings in ports.values():
            for binding in bindings if isinstance(bindings, list) else []:
                if (
                    isinstance(binding, dict)
                    and str(binding.get("HostPort", "")).isdigit()
                ):
                    published.add(int(binding["HostPort"]))
    caddy_mount = False
    caddy_mount_read_only = False
    for mount in value.get("mounts") if isinstance(value.get("mounts"), list) else []:
        if (
            isinstance(mount, dict)
            and mount.get("Destination") == "/etc/caddy/Caddyfile"
        ):
            caddy_mount = True
            caddy_mount_read_only = mount.get("RW") is False
    return {
        "name": expected,
        "found": True,
        "running": value.get("running") is True,
        "network_count": len(network_names),
        "publishes_http": 80 in published,
        "publishes_https": 443 in published,
        "other_published_port_count": len(published - {80, 443}),
        "caddy_config_mount_present": caddy_mount
        if expected == "firbo-caddy"
        else False,
        "caddy_config_mount_read_only": caddy_mount_read_only
        if expected == "firbo-caddy"
        else False,
    }, network_names


def _listener_occupied(ss: str, port: int) -> bool:
    # `ss` output is never copied to the report. Accept IPv4/IPv6 address forms.
    for line in ss.splitlines():
        fields = line.split()
        if len(fields) >= 4 and re.search(rf":{port}$", fields[3]):
            return True
    return False


def collect(
    *,
    mcp_bind: str,
    mcp_port: int,
    page_bind: str,
    page_port: int,
    service_root: Path | None = None,
    manifest_path: Path | None = None,
    runner: Runner = command,
    which: Callable[[str], str | None] = shutil.which,
    now: dt.datetime | None = None,
) -> dict[str, Any]:
    mcp_scope, page_scope = _private_bind(mcp_bind), _private_bind(page_bind)
    mcp_port, page_port = _port(mcp_port), _port(page_port)
    if mcp_bind == page_bind and mcp_port == page_port:
        _fail("listener_collision")
    checked = now or dt.datetime.now(dt.timezone.utc)
    if checked.tzinfo is None:
        _fail("clock_invalid")
    report: dict[str, Any] = {
        "schema": CONTRACT,
        "checked_at": checked.astimezone(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "read_only": True,
        "contains_secrets": False,
        "mutations_performed": False,
        "network_requests_performed": False,
        "requested_listeners": [
            {
                "service": "mcp",
                "bind": mcp_bind,
                "bind_scope": mcp_scope,
                "port": mcp_port,
            },
            {
                "service": "page",
                "bind": page_bind,
                "bind_scope": page_scope,
                "port": page_port,
            },
        ],
        "docker": {
            "found": False,
            "accessible": False,
            "containers": [],
            "caddy_shared_network_candidates": 0,
            "egress_containers_sharing_caddy_network": 0,
        },
        "systemd": {"found": False, "units": []},
        "listeners": [],
        "service_readback": {"performed": False},
        "limits": [
            "Inventory is not installation, TLS routing, supervision "
            "or acceptance proof",
            "Listener state is a point-in-time observation",
            "No provider, page, database or public network request was made",
        ],
    }

    docker = which("docker")
    if docker:
        report["docker"]["found"] = True
        ok, _ = runner([docker, "version", "--format", "{{.Server.Version}}"])
        report["docker"]["accessible"] = ok
        networks: dict[str, set[str]] = {}
        if ok:
            for name in EXISTING_CONTAINERS + CANDIDATE_CONTAINERS:
                found, raw = runner(
                    [docker, "container", "inspect", "--format", DOCKER_FORMAT, name]
                )
                if not found:
                    report["docker"]["containers"].append(
                        {"name": name, "found": False}
                    )
                    networks[name] = set()
                    continue
                row, connected = _container(raw, name)
                report["docker"]["containers"].append(row)
                networks[name] = connected
            caddy_networks = networks.get("firbo-caddy", set())
            report["docker"]["caddy_shared_network_candidates"] = sum(
                bool(caddy_networks & networks.get(name, set()))
                for name in ("firbo-api", "firbo-omniroute")
            )
            report["docker"]["egress_containers_sharing_caddy_network"] = sum(
                bool(caddy_networks & networks.get(name, set()))
                for name in CANDIDATE_CONTAINERS
            )
            for row in report["docker"]["containers"]:
                name = row["name"]
                row["shares_caddy_network"] = (
                    bool(caddy_networks & networks.get(name, set()))
                    if row["found"] and name != "firbo-caddy"
                    else None
                )

    systemctl = which("systemctl")
    if systemctl:
        report["systemd"]["found"] = True
        for unit in EGRESS_UNITS:
            _, raw = runner([systemctl, "is-active", unit])
            state = raw.strip()
            if state not in {
                "active",
                "reloading",
                "inactive",
                "failed",
                "activating",
                "deactivating",
                "maintenance",
                "unknown",
            }:
                state = "unavailable"
            report["systemd"]["units"].append({"name": unit, "state": state})

    ss = which("ss")
    for service, bind, port in (
        ("mcp", mcp_bind, mcp_port),
        ("page", page_bind, page_port),
    ):
        occupied: bool | None = None
        if ss:
            ok, raw = runner([ss, "-H", "-lnt", f"sport = :{port}"])
            occupied = _listener_occupied(raw, port) if ok else None
        report["listeners"].append(
            {
                "service": service,
                "bind": bind,
                "port": port,
                "query_available": bool(ss),
                "occupied": occupied,
            }
        )

    if (service_root is None) != (manifest_path is None):
        _fail("readback_arguments_incomplete")
    if service_root is not None and manifest_path is not None:
        report["service_readback"] = service_readback(service_root, manifest_path)
    return report


def _write(path: Path | None, report: dict[str, Any]) -> None:
    raw = (json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if path is None:
        sys.stdout.buffer.write(raw)
        return
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
    except OSError:
        _fail("output_refused")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mcp-bind", required=True)
    parser.add_argument("--mcp-port", required=True, type=int)
    parser.add_argument("--page-bind", required=True)
    parser.add_argument("--page-port", required=True, type=int)
    parser.add_argument("--service-root", type=Path)
    parser.add_argument("--bundle-manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        report = collect(
            mcp_bind=args.mcp_bind,
            mcp_port=args.mcp_port,
            page_bind=args.page_bind,
            page_port=args.page_port,
            service_root=args.service_root,
            manifest_path=args.bundle_manifest,
        )
        _write(args.output, report)
    except InventoryError as exc:
        print(f"egress_inventory: {exc}", file=sys.stderr)
        return 1
    except Exception:
        print("egress_inventory: inventory_failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
