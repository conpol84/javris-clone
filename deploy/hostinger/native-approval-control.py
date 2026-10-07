#!/usr/bin/env python3
"""Guarded native approval rollout and explicit local operator grant issuance.

No provider requests, key printing, global approval switch or inference retry.
Only openjarvis.service is restarted; firbo-api and the box service are untouched.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pwd
import secrets
import socket
import stat
import subprocess
import tempfile
import time
from pathlib import Path

PACKAGE = Path("/home/jarvis/.openjarvis/.venv/lib/python3.13/site-packages/openjarvis")
APPROVAL_ROOT = Path("/run/firbo-native-approval")
BACKUPS = Path("/var/backups")
SERVICE = "openjarvis.service"
READ_ONLY_BASELINES = frozenset(
    {"tools/_stubs.py", "tools/shell_exec.py", "cli/serve.py"}
)
BASELINES = {
    "tools/_stubs.py": (
        "8f4f1f19ed26ee1d897abaa9e0b7bdbd134f96f7c7a3649b8e93fb3dbd0799b2"
    ),
    "tools/shell_exec.py": (
        "ae6b85c423e8b0314debc260a0704200486952f2ca4c8292e43fe1713f51328c"
    ),
    "cli/serve.py": (
        "166a0f95776f73fb2889840525c202e5e5c5d256d7fa08c2f24508aec8ab4339"
    ),
    "server/routes.py": (
        "87b57f19cb494d676e9c5db2400f5c23df9942bdc387e64988899ced2be8146d"
    ),
    "server/models.py": (
        "e56606d12181a167f387f7aa3be0b21484c88c150e17487fa8c52b612ad19fc1"
    ),
}
# Filled from the exact reviewed runtime bytes, never downloaded at install time.
BUNDLE = {
    "server/routes.py": (
        "a7f73bb266da83e01ced8faa6add7f295f087ca857908240a511df77e94bc8ad"
    ),
    "server/models.py": (
        "592c67a9d40ac8198ab31cd55517d30f6d5744d1f253869cce66d2d09202f4f9"
    ),
    "server/native_approval.py": (
        "65e57f97efb4f4199a55096091247410c921c9bb82682ca20d8c7d1b5319fe02"
    ),
}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_regular(path, *, allow_hardlinks=False):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(
            stat.S_ISREG(info.st_mode)
            and (info.st_nlink == 1 or (allow_hardlinks and info.st_nlink > 1))
            and info.st_size <= 512000,
            "unexpected_file",
        )
        return os.read(fd, 512001)
    finally:
        os.close(fd)


def operator():
    require(
        os.geteuid() == 0 and socket.gethostname() == "srv2027143", "wrong_host_or_user"
    )
    return pwd.getpwnam("jarvis")


def approval_directories(user):
    for path, mode, uid, gid in (
        (APPROVAL_ROOT, 0o755, 0, 0),
        (APPROVAL_ROOT / "grants", 0o711, 0, 0),
        (APPROVAL_ROOT / "used", 0o700, user.pw_uid, user.pw_gid),
    ):
        if not path.exists() and not path.is_symlink():
            path.mkdir(mode=mode)
            os.chown(path, uid, gid)
            os.chmod(path, mode)
        info = path.lstat()
        require(
            stat.S_ISDIR(info.st_mode)
            and info.st_uid == uid
            and stat.S_IMODE(info.st_mode) == mode,
            "approval_directory_changed",
        )


def issue_approval(request, arguments):
    """Called only by the operator's verifier; explicit terminal consent first."""
    user = operator()
    for name, expected in BUNDLE.items():
        require(
            digest(read_regular(PACKAGE / name)) == expected,
            "installed_bundle_mismatch",
        )
    require(
        not request.get("stream") and not request.get("tools"), "unsupported_request"
    )
    require(
        set(arguments) == {"command", "timeout", "working_dir"}, "unsupported_arguments"
    )
    # Match Pydantic ChatMessage defaults exactly without importing service code.
    messages = [
        {
            "role": m["role"],
            "content": m.get("content", ""),
            "name": None,
            "tool_calls": None,
            "tool_call_id": None,
        }
        for m in request["messages"]
    ]

    def canonical(value):
        return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)

    action_hash = digest(
        canonical({"tool": "shell_exec", "arguments": arguments}).encode()
    )
    print(
        json.dumps(
            {
                "approve_once": "shell_exec",
                "arguments": arguments,
                "model": request["model"],
                "valid_seconds": 300,
                "action_sha256": action_hash,
            },
            indent=2,
        ),
        flush=True,
    )
    with open("/dev/tty", "r+") as terminal:
        terminal.write(
            "Type APPROVE "
            + action_hash[:12]
            + " to authorize only this exact action: "
        )
        terminal.flush()
        answer = terminal.readline().strip()
    require(answer == "APPROVE " + action_hash[:12], "operator_declined_no_dispatch")
    approval_directories(user)
    grant_id = secrets.token_hex(32)
    now = int(time.time())
    grant = {
        "schema": "firbo-native-approval/v1",
        "id": grant_id,
        "uid": user.pw_uid,
        "request_sha256": digest(
            canonical({"model": request["model"], "messages": messages}).encode()
        ),
        "tool": "shell_exec",
        "arguments": arguments,
        "created_at": now,
        "expires_at": now + 300,
    }
    raw = canonical(grant).encode()
    require(len(raw) <= 32768, "approval_too_large")
    fd = os.open(
        APPROVAL_ROOT / "grants" / (grant_id + ".key"),
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o644,
    )
    with os.fdopen(fd, "wb") as output:
        os.fchmod(output.fileno(), 0o644)
        output.write(raw)
        output.flush()
        os.fsync(output.fileno())
    return grant_id


def write_atomic(path, raw, uid=0, gid=0, mode=0o644):
    fd, temporary = tempfile.mkstemp(prefix=".firbo-approval-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchown(output.fileno(), uid, gid)
            os.fchmod(output.fileno(), mode)
            output.write(raw)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restart_and_verify():
    subprocess.run(
        ["systemctl", "restart", SERVICE], check=True, capture_output=True, timeout=45
    )
    helper = Path(__file__).with_name("repair-openjarvis-tools.py")
    require(
        digest(read_regular(helper))
        == "c5f88cce2c7de5c35648c145b806400ec6c1c5823b5d21b61da99a3c9b0c69c4",
        "helper_changed",
    )
    spec = importlib.util.spec_from_file_location("approval_health", helper)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    # Readiness only; no model/tool call. Brief startup polling has a fixed bound.
    for attempt in range(10):
        try:
            _, runtime = api.info(SERVICE)
            require(
                {"shell_exec", "file_read"}.issubset(
                    (runtime.get("runtime") or {}).get("tool_names") or []
                ),
                "required_tools_missing",
            )
            return
        except Exception:
            if attempt == 9:
                raise ValueError("service_readiness_failed") from None
            time.sleep(1)


def rollback(backup):
    require(
        backup.parent == BACKUPS and backup.name.startswith("firbo-native-approval-"),
        "invalid_backup_path",
    )
    info = backup.lstat()
    require(
        stat.S_ISDIR(info.st_mode)
        and info.st_uid == 0
        and stat.S_IMODE(info.st_mode) == 0o700,
        "invalid_backup_owner",
    )
    records = json.loads(read_regular(backup / "manifest.json"))
    require(set(records) == set(BUNDLE), "invalid_backup_manifest")
    for name, row in records.items():
        path = PACKAGE / name
        current = digest(read_regular(path)) if path.exists() else None
        require(
            current in (BUNDLE[name], row["sha256"]), "newer_installed_change_preserved"
        )
        if row["sha256"] is not None:
            raw = read_regular(backup / Path(name).name)
            require(digest(raw) == row["sha256"], "backup_hash_mismatch")
    for name, row in records.items():
        path = PACKAGE / name
        if row["sha256"] is None:
            if path.exists():
                path.unlink()
        else:
            write_atomic(
                path,
                read_regular(backup / Path(name).name),
                row["uid"],
                row["gid"],
                row["mode"],
            )
    restart_and_verify()


def install():
    user = operator()
    check_service_policy()
    helper = Path(__file__).with_name("repair-openjarvis-tools.py")
    require(
        digest(read_regular(helper))
        == "c5f88cce2c7de5c35648c145b806400ec6c1c5823b5d21b61da99a3c9b0c69c4",
        "helper_changed",
    )
    require(
        set(BUNDLE)
        == {"server/routes.py", "server/models.py", "server/native_approval.py"},
        "bundle_incomplete",
    )
    staged = {}
    for name, expected in BUNDLE.items():
        raw = read_regular(Path(__file__).with_name(Path(name).name))
        require(digest(raw) == expected, "staged_hash_mismatch")
        compile(raw, name, "exec")
        staged[name] = raw
    for name, expected in BASELINES.items():
        # These three installed modules are only hashed, never replaced/backed
        # up by this installer. Shared inodes are safe to read; all writable
        # targets and staged/backup files retain the single-link requirement.
        installed = read_regular(
            PACKAGE / name, allow_hardlinks=name in READ_ONLY_BASELINES
        )
        require(
            digest(installed) in {expected, BUNDLE.get(name)},
            "unknown_installed_code",
        )
    added = PACKAGE / "server/native_approval.py"
    require(not added.is_symlink(), "unexpected_installed_symlink")
    if added.exists():
        require(
            digest(read_regular(added)) == BUNDLE["server/native_approval.py"],
            "unknown_approval_code",
        )
    if all(
        (PACKAGE / n).exists() and digest(read_regular(PACKAGE / n)) == h
        for n, h in BUNDLE.items()
    ):
        print(json.dumps({"already_installed": True, "restart_performed": False}))
        return
    require(not added.exists(), "partial_install_requires_review")
    # Reject a partially replaced two-file bundle too; preserve it for inspection.
    for name in ("server/routes.py", "server/models.py"):
        require(
            digest(read_regular(PACKAGE / name)) == BASELINES[name],
            "partial_install_requires_review",
        )
    approval_directories(user)
    backup = Path(tempfile.mkdtemp(prefix="firbo-native-approval-", dir=BACKUPS))
    records = {}
    for name in BUNDLE:
        path = PACKAGE / name
        if path.exists():
            raw, info = read_regular(path), path.stat()
            (backup / path.name).write_bytes(raw)
            records[name] = {
                "sha256": digest(raw),
                "uid": info.st_uid,
                "gid": info.st_gid,
                "mode": stat.S_IMODE(info.st_mode),
            }
        else:
            records[name] = {"sha256": None}
    (backup / "manifest.json").write_text(json.dumps(records))
    print(json.dumps({"backup": str(backup), "phase": "before_install"}), flush=True)
    try:
        for name in (
            "server/native_approval.py",
            "server/models.py",
            "server/routes.py",
        ):
            write_atomic(PACKAGE / name, staged[name])
        restart_and_verify()
        require(
            all(digest(read_regular(PACKAGE / n)) == h for n, h in BUNDLE.items()),
            "installed_readback_failed",
        )
    except Exception:
        rollback(backup)
        raise ValueError("install_failed_rolled_back") from None
    print(
        json.dumps(
            {
                "installed": True,
                "service": SERVICE,
                "backup": str(backup),
                "approval_default": "deny",
                "artifact_verified": False,
                "installed_sha256": BUNDLE,
            },
            indent=2,
        )
    )


def check_service_policy():
    result = subprocess.run(
        [
            "systemctl",
            "show",
            SERVICE,
            "--property=User,ProtectSystem,ReadOnlyPaths,InaccessiblePaths",
        ],
        check=True,
        capture_output=True,
        text=True,
        timeout=10,
    )
    values = dict(
        line.split("=", 1) for line in result.stdout.splitlines() if "=" in line
    )
    require(values.get("User") == "jarvis", "unexpected_service_user")
    require(values.get("ProtectSystem") != "strict", "service_sandbox_requires_review")
    for setting in ("ReadOnlyPaths", "InaccessiblePaths"):
        for raw in values.get(setting, "").split():
            path = Path(raw.lstrip("-+"))
            require(
                path != APPROVAL_ROOT
                and path not in APPROVAL_ROOT.parents
                and path != APPROVAL_ROOT / "used",
                "service_sandbox_requires_review",
            )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--install", action="store_true")
    action.add_argument("--rollback", type=Path)
    args = parser.parse_args()
    try:
        operator()
        if args.install:
            install()
        else:
            rollback(args.rollback)
            print(json.dumps({"rolled_back": True, "service": SERVICE}))
    except Exception as error:
        # No raw process output, environment, credential or HTTP body.
        print(
            json.dumps(
                {
                    "success": False,
                    "error_type": type(error).__name__,
                    "reason": str(error)
                    if type(error) is ValueError
                    else "operation_failed",
                }
            )
        )
        raise SystemExit(1) from None
