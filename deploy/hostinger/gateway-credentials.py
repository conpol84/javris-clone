#!/usr/bin/env python3
"""Local credential recovery; never changes providers, combos or model routes.

Default: inspect paths and credential presence only. Secret input requires a TTY.
Uses the local Docker daemon and the running stack's verified Compose labels.
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import warnings
from pathlib import Path
from typing import Any

KEY_NAMES = ("OMNIROUTE_API_KEY", "OMNIROUTE_MANAGEMENT_KEY")
PRESENCE_NAMES = (*KEY_NAMES, "OPENJARVIS_API_KEY", "INITIAL_PASSWORD")
MAX_FILE = 1024 * 1024
INSPECT = (
    '{"name":{{json .Name}},"running":{{json .State.Running}},'
    '"labels":{{json .Config.Labels}}}'
)
# Keys enter on stdin, never in argv, Docker metadata or output.
KEY_PROBE = """
import http.client, json, sys
k = json.load(sys.stdin)
def status(path, key):
    c = http.client.HTTPConnection('omniroute', 20128, timeout=8)
    try:
        c.request('GET', path, headers={'Authorization': 'Bearer ' + key})
        return c.getresponse().status
    except Exception:
        return 0
    finally:
        c.close()
print(json.dumps({
    'management_http': status('/api/combos', k['OMNIROUTE_MANAGEMENT_KEY']),
    'inference_http': status('/v1/models', k['OMNIROUTE_API_KEY']),
    'inference_management_http': status('/api/combos', k['OMNIROUTE_API_KEY'])
}))
"""
API_PROBE = """
import http.client, json, os, secrets, sys
k = json.load(sys.stdin)
loaded = all(secrets.compare_digest(os.environ.get(n, ''), v) for n, v in k.items())
c = http.client.HTTPConnection('127.0.0.1', 8000, timeout=4)
try:
    c.request('GET', '/health')
    status = c.getresponse().status
except Exception:
    status = 0
finally:
    c.close()
print(json.dumps({'loaded': loaded, 'health_http': status}))
"""
RESET_PROBE = """
const fs = require('node:fs');
const p = 'bin/reset-password.mjs';
const s = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
console.log(JSON.stringify({stdin_supported:s.includes('--password-stdin')}));
"""


class Blocked(Exception):
    """Only constant codes may be printed; subprocess output stays private."""


def require(value: Any, code: str) -> None:
    if not value:
        raise Blocked(code)


def command(args: list[str], data: bytes | None = None) -> bytes:
    # Compose shell variables take precedence over --env-file. A small local
    # environment prevents a stale exported key/domain from replacing the file.
    env = {
        k: v for k, v in os.environ.items() if k in {"PATH", "LANG", "LC_ALL", "TERM"}
    }
    try:
        result = subprocess.run(
            args,
            input=data,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=45,
            check=False,
            env=env,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked("local_command_failed_or_timed_out") from None
    require(result.returncode == 0, "local_command_failed")
    require(len(result.stdout) <= MAX_FILE, "local_response_too_large")
    return result.stdout


def docker(args: list[str], data: bytes | None = None) -> bytes:
    binary = shutil.which("docker")
    require(binary, "docker_not_installed")
    return command([str(binary), "--host", "unix:///var/run/docker.sock", *args], data)


def docker_json(args: list[str], payload: dict[str, str] | None = None) -> dict:
    raw = docker(args, None if payload is None else json.dumps(payload).encode())
    try:
        value = json.loads(raw)
    except (ValueError, UnicodeError):
        raise Blocked("invalid_local_response") from None
    require(isinstance(value, dict), "invalid_local_response")
    return value


def safe_path(path: Path) -> Path:
    require(path.is_absolute() and path.resolve() == path, "unsafe_or_symlinked_path")
    return path


def read_private(path: Path) -> bytes:
    safe_path(path)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "configuration_not_regular_file")
        require(before.st_uid == os.geteuid(), "configuration_owned_by_another_user")
        require(before.st_size <= MAX_FILE, "configuration_too_large")
        data = stream.read(MAX_FILE + 1)
        after = os.fstat(stream.fileno())
    require(len(data) <= MAX_FILE, "configuration_too_large")
    require(
        (before.st_size, before.st_mtime_ns, before.st_ctime_ns)
        == (after.st_size, after.st_mtime_ns, after.st_ctime_ns),
        "configuration_changed",
    )
    return data


def values(data: bytes) -> dict[str, str]:
    try:
        content = data.decode("utf-8")
    except UnicodeError:
        raise Blocked("configuration_not_utf8") from None
    found: dict[str, str] = {}
    for line in content.splitlines():
        match = re.match(r"^([A-Z][A-Z0-9_]*)=(.*)$", line)
        if match and match[1] in PRESENCE_NAMES:
            require(match[1] not in found, "duplicate_credential_configuration")
            found[match[1]] = match[2].strip().strip("\"'")
    return found


def runtime() -> dict[str, Any]:
    rows = []
    for name, service in (("firbo-api", "firbo-api"), ("firbo-omniroute", "omniroute")):
        row = docker_json(["container", "inspect", "--format", INSPECT, name])
        require(
            row.get("name") == "/" + name and row.get("running") is True,
            "expected_container_not_running",
        )
        labels = row.get("labels") or {}
        require(isinstance(labels, dict), "invalid_compose_labels")
        require(
            labels.get("com.docker.compose.service") == service, "wrong_compose_service"
        )
        work = labels.get("com.docker.compose.project.working_dir")
        project = labels.get("com.docker.compose.project")
        files = labels.get("com.docker.compose.project.config_files")
        require(
            all(isinstance(x, str) and x for x in (work, project, files)),
            "compose_labels_missing",
        )
        directory = safe_path(Path(work))
        info = directory.stat()
        require(
            stat.S_ISDIR(info.st_mode)
            and info.st_uid == os.geteuid()
            and stat.S_IMODE(info.st_mode) & 0o022 == 0,
            "unsafe_compose_directory_permissions",
        )
        require(re.fullmatch(r"[A-Za-z0-9_-]+", project), "invalid_compose_project")
        paths = [
            safe_path(Path(p) if Path(p).is_absolute() else directory / p)
            for p in files.split(",")
        ]
        require(
            all(p.parent == directory and p.is_file() for p in paths),
            "compose_file_outside_stack_directory",
        )
        rows.append({"directory": directory, "project": project, "files": paths})
    require(
        rows[0]["directory"] == rows[1]["directory"]
        and rows[0]["project"] == rows[1]["project"]
        and rows[0]["files"][0] == rows[1]["files"][0],
        "mixed_compose_projects",
    )
    # Native/voice rollouts recreated only the API with extra overlays. Preserve
    # its authoritative file list; the gateway may still label just the base.
    rows[0]["env_path"] = safe_path(rows[0]["directory"] / ".env")
    return rows[0]


def native_environment_paths(service: str) -> dict[str, Any]:
    binary = shutil.which("systemctl")
    if not binary:
        return {"service": service, "available": False}
    try:
        raw = command([binary, "show", service, "-p", "EnvironmentFiles", "--value"])
        paths = re.findall(r"(/[^\s;]+)\s+\(ignore_errors=(?:yes|no)\)", raw.decode())
        return {
            "service": service,
            "available": bool(paths),
            "environment_files": paths,
        }
    except (Blocked, UnicodeError):
        return {"service": service, "available": False}


def inspect(stack: dict[str, Any]) -> dict[str, Any]:
    configured = values(read_private(stack["env_path"]))
    return {
        "status": "inspected",
        "compose_directory": str(stack["directory"]),
        "environment_file": str(stack["env_path"]),
        "credential_present": {
            name: bool(configured.get(name)) for name in PRESENCE_NAMES
        },
        "gateway_keys_distinct": bool(
            configured.get(KEY_NAMES[0])
            and configured.get(KEY_NAMES[1])
            and configured[KEY_NAMES[0]] != configured[KEY_NAMES[1]]
        ),
        "native_services": [
            native_environment_paths(n) for n in ("openjarvis", "openjarvis-box")
        ],
        "initial_password_is_bootstrap_only": True,
    }


def validate_keys(keys: dict[str, str]) -> None:
    require(
        all(
            re.fullmatch(r"[A-Za-z0-9_.:/+=-]{16,512}", keys.get(n, ""))
            for n in KEY_NAMES
        ),
        "invalid_gateway_key_format",
    )
    require(keys[KEY_NAMES[0]] != keys[KEY_NAMES[1]], "gateway_keys_must_be_distinct")


def hidden_input(prompt: str) -> str:
    # getpass can fall back to echoed input on terminals without echo control.
    # Abort on its warning before that fallback can read a credential.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            return getpass.getpass(prompt)
        except getpass.GetPassWarning:
            raise Blocked("terminal_hidden_input_unavailable") from None


def check_keys(keys: dict[str, str]) -> dict[str, Any]:
    validate_keys(keys)
    report = docker_json(["exec", "-i", "firbo-api", "python", "-c", KEY_PROBE], keys)
    require(report.get("management_http") == 200, "management_key_not_accepted")
    require(report.get("inference_http") == 200, "inference_key_not_accepted")
    require(
        report.get("inference_management_http") in {401, 403},
        "inference_key_has_management_access_or_scope_unverified",
    )
    return report


def atomic_write(path: Path, data: bytes) -> None:
    safe_path(path)
    fd, temporary = tempfile.mkstemp(prefix=".firbo-credential-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def backup(path: Path, data: bytes) -> Path:
    directory = path.parent / ".gateway-credential-backups"
    safe_path(directory)
    directory.mkdir(mode=0o700, exist_ok=True)
    info = directory.stat()
    require(
        info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0,
        "unsafe_backup_permissions",
    )
    fd, filename = tempfile.mkstemp(prefix="gateway-env-", suffix=".env", dir=directory)
    with os.fdopen(fd, "wb") as output:
        os.fchmod(output.fileno(), 0o600)
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    return Path(filename)


def updated_env(original: bytes, keys: dict[str, str]) -> bytes:
    values(original)  # Reject duplicate lines before replacing anything.
    lines = original.decode().splitlines()
    written = set()
    for i, line in enumerate(lines):
        for name in KEY_NAMES:
            if line.startswith(name + "="):
                lines[i] = name + "=" + keys[name]
                written.add(name)
    lines.extend(name + "=" + keys[name] for name in KEY_NAMES if name not in written)
    return ("\n".join(lines) + "\n").encode()


def compose_args(stack: dict[str, Any]) -> list[str]:
    args = [
        "compose",
        "--project-directory",
        str(stack["directory"]),
        "--env-file",
        str(stack["env_path"]),
        "-p",
        stack["project"],
    ]
    for path in stack["files"]:
        args += ["-f", str(path)]
    return args


def preflight_api(stack: dict[str, Any]) -> dict[str, Any]:
    """Reject stale Compose state before a credential-only recreation.

    The private config/Env are used only in memory and never returned/printed.
    """
    original = read_private(stack["env_path"])
    files = {p: read_private(p) for p in stack["files"]}
    current = docker_json(
        [
            "container",
            "inspect",
            "--format",
            (
                '{"image":{{json .Image}},"config":{{json .Config}},'
                '"mounts":{{json .Mounts}},'
                '"networks":{{json .NetworkSettings.Networks}},'
                '"privileged":{{json .HostConfig.Privileged}},'
                '"ports":{{json .HostConfig.PortBindings}}}'
            ),
            "firbo-api",
        ]
    )
    effective = docker_json([*compose_args(stack), "config", "--format", "json"])
    service = effective.get("services", {}).get("firbo-api", {})
    config = current.get("config") or {}
    require(
        isinstance(service, dict) and isinstance(config, dict),
        "invalid_api_configuration",
    )
    require(service.get("container_name") == "firbo-api", "compose_api_identity_drift")
    reference = service.get("image") or (stack["project"] + "-firbo-api")
    require(isinstance(reference, str) and reference, "invalid_compose_image")
    resolved = docker_json(
        ["image", "inspect", "--format", '{"image":{{json .Id}}}', reference]
    )
    require(
        resolved.get("image") == current.get("image")
        and isinstance(current.get("image"), str),
        "compose_api_image_drift",
    )
    for declared, field in (
        ("entrypoint", "Entrypoint"),
        ("command", "Cmd"),
        ("user", "User"),
    ):
        if declared in service:
            require(service[declared] == config.get(field), "compose_api_runtime_drift")
    environment = service.get("environment") or {}
    require(isinstance(environment, dict), "invalid_compose_environment")
    existing = dict(line.split("=", 1) for line in config.get("Env", []) if "=" in line)
    require(
        all(
            value is not None and existing.get(name) == str(value)
            for name, value in environment.items()
        ),
        "compose_api_environment_drift",
    )
    require(
        not service.get("ports")
        and not service.get("privileged")
        and not current.get("ports")
        and not current.get("privileged")
        and not service.get("network_mode"),
        "unsafe_api_compose_configuration",
    )
    declared_networks = service.get("networks") or {"default": None}
    require(isinstance(declared_networks, (dict, list)), "invalid_compose_networks")
    network_config = effective.get("networks") or {}
    require(isinstance(network_config, dict), "invalid_compose_networks")
    expected_networks = []
    for name in declared_networks:
        network = network_config.get(name) or {}
        require(isinstance(network, dict), "invalid_compose_networks")
        expected_networks.append(network.get("name") or (stack["project"] + "_" + name))
    require(
        sorted(expected_networks) == sorted((current.get("networks") or {}).keys()),
        "compose_api_network_drift",
    )
    declared_mounts = []
    for volume in service.get("volumes", []):
        require(
            isinstance(volume, dict) and volume.get("type") == "bind",
            "unsupported_api_mount_type",
        )
        declared_mounts.append(
            (
                "bind",
                volume.get("source"),
                volume.get("target"),
                bool(volume.get("read_only")),
            )
        )
    actual_mounts = [
        (m.get("Type"), m.get("Source"), m.get("Destination"), not m.get("RW"))
        for m in current.get("mounts", [])
    ]
    require(sorted(declared_mounts) == sorted(actual_mounts), "compose_api_mount_drift")
    require(
        read_private(stack["env_path"]) == original
        and all(read_private(p) == data for p, data in files.items()),
        "configuration_changed",
    )
    return {"original_env": original, "files": files}


def require_unchanged_compose(snapshot: dict[str, Any]) -> None:
    require(
        all(read_private(p) == data for p, data in snapshot["files"].items()),
        "compose_configuration_changed",
    )


def recreate_api(stack: dict[str, Any]) -> None:
    args = compose_args(stack)
    docker(
        [
            *args,
            "up",
            "-d",
            "--no-deps",
            "--force-recreate",
            "--no-build",
            "--pull",
            "never",
            "firbo-api",
        ]
    )


def verify_api(keys: dict[str, str]) -> None:
    for attempt in range(6):
        try:
            report = docker_json(
                ["exec", "-i", "firbo-api", "python", "-c", API_PROBE], keys
            )
            if report.get("loaded") is True and report.get("health_http") == 200:
                return
        except Blocked:
            pass
        if attempt < 5:
            time.sleep(1)
    raise Blocked("api_restart_or_credential_verification_failed")


def set_keys(stack: dict[str, Any], keys: dict[str, str]) -> dict[str, Any]:
    check_keys(keys)  # Nothing changes before all scope checks pass.
    snapshot = preflight_api(stack)
    path = stack["env_path"]
    original = read_private(path)
    require(original == snapshot["original_env"], "configuration_changed")
    replacement = updated_env(original, keys)
    saved = backup(path, original)
    require(read_private(path) == original, "configuration_changed")
    atomic_write(path, replacement)
    try:
        require_unchanged_compose(snapshot)
        recreate_api(stack)
        verify_api(keys)
    except Blocked:
        # Never overwrite an operator's concurrent edit during recovery.
        require(
            read_private(path) == replacement,
            "restart_failed_configuration_changed_no_rollback",
        )
        atomic_write(path, original)
        previous = {n: values(original).get(n, "") for n in KEY_NAMES}
        try:
            require_unchanged_compose(snapshot)
            recreate_api(stack)
            verify_api(previous)
        except Blocked:
            raise Blocked("restart_failed_env_restored_runtime_unverified") from None
        raise Blocked("restart_failed_env_and_previous_runtime_restored") from None
    return {
        "status": "gateway_keys_saved_and_api_verified",
        "private_backup": str(saved),
        "supabase_inference_secret_update_required": True,
        "old_keys_not_revoked": True,
        "providers_models_combos_unchanged": True,
    }


def reset_dashboard(
    stack: dict[str, Any], password: str, confirm: str
) -> dict[str, Any]:
    del stack  # Identity checks ran before asking for any secret.
    require(password == confirm, "passwords_do_not_match")
    require(
        12 <= len(password)
        and len(password.encode()) <= 72
        and not any(ord(c) < 32 or ord(c) == 127 for c in password),
        "password_must_be_12_plus_characters_and_at_most_72_utf8_bytes_without_controls",
    )
    capability = docker_json(["exec", "firbo-omniroute", "node", "-e", RESET_PROBE])
    require(
        capability.get("stdin_supported") is True,
        "installed_reset_cli_has_no_stdin_support",
    )
    docker(
        [
            "exec",
            "-i",
            "firbo-omniroute",
            "node",
            "bin/reset-password.mjs",
            "--password-stdin",
        ],
        password.encode(),
    )
    try:
        docker(["restart", "firbo-omniroute"])
        healthy = False
        for attempt in range(6):
            try:
                docker(["exec", "firbo-omniroute", "node", "healthcheck.mjs"])
                healthy = True
                break
            except Blocked:
                if attempt < 5:
                    time.sleep(1)
        require(healthy, "gateway_health_check_failed")
    except Blocked:
        raise Blocked(
            "dashboard_password_changed_gateway_restart_or_health_failed"
        ) from None
    return {
        "status": "dashboard_password_reset_gateway_restarted",
        "gateway_health_verified": True,
        "existing_sessions_not_revoked_by_cli": True,
        "providers_keys_models_combos_unchanged": True,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        nargs="?",
        default="inspect",
        choices=(
            "inspect",
            "check-gateway-keys",
            "set-gateway-keys",
            "reset-dashboard",
        ),
    )
    parser.add_argument(
        "--require-directory",
        type=Path,
        help="Refuse a routing setup executed outside the running Compose directory.",
    )
    args = parser.parse_args(argv)
    try:
        stack = runtime()
        if args.require_directory is not None:
            require(
                stack["directory"] == args.require_directory.resolve(),
                "wrong_compose_directory",
            )
        if args.action == "inspect":
            report = inspect(stack)
        elif args.action == "check-gateway-keys":
            configured = values(read_private(stack["env_path"]))
            report = {
                "status": "gateway_key_scopes_checked",
                **check_keys({n: configured.get(n, "") for n in KEY_NAMES}),
            }
        else:
            require(
                sys.stdin.isatty() and sys.stderr.isatty(),
                "local_terminal_required_for_secret_input",
            )
            if args.action == "set-gateway-keys":
                keys = {
                    KEY_NAMES[0]: hidden_input("New inference-only key: "),
                    KEY_NAMES[1]: hidden_input("New management key: "),
                }
                report = set_keys(stack, keys)
            else:
                password = hidden_input("New gateway password (12+ characters): ")
                confirm = hidden_input("Confirm new gateway password: ")
                report = reset_dashboard(stack, password, confirm)
        print(json.dumps(report, indent=2))
        return 0
    except (Blocked, OSError, ValueError) as exc:
        code = str(exc) if isinstance(exc, Blocked) else "local_configuration_error"
        print(json.dumps({"status": "blocked", "error": code}), file=sys.stderr)
        return 1
    except (EOFError, KeyboardInterrupt):
        print(
            json.dumps({"status": "cancelled", "error": "operator_cancelled"}),
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
