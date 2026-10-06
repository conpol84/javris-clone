#!/usr/bin/env python3
"""Pinned PR30 engine update. Default: inspect only; --apply: backup and restart.

Only known original or already-updated files are accepted. Unknown local changes
stop the operation before downloads, backups or service stops. No config, keys,
Compose checkout or provider/device permissions are touched.
"""

import argparse
import ast
import hashlib
import json
import os
import socket
import stat
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

SOURCE = "1cfc4e3a8e80f0d2e95955b3507881fb03171a8b"
PYTHON = Path("/home/jarvis/.openjarvis/.venv/bin/python")
PACKAGE = Path(
    "/home/jarvis/.openjarvis/.venv/lib/python3.13/site-packages/openjarvis/server"
)
SERVICES = ("openjarvis.service", "openjarvis-box.service")
MANIFEST = {
    "routes.py": (
        "9a1baa1161106c1d0eb4a307785cd8563f8a0a1524fe79df8c28abc684425192",
        "87b57f19cb494d676e9c5db2400f5c23df9942bdc387e64988899ced2be8146d",
    ),
    "models.py": (
        "89667dbc0a99af7cb2602151b3bf4b18f54d93d5dfe907f0bedabba44e520b8c",
        "e56606d12181a167f387f7aa3be0b21484c88c150e17487fa8c52b612ad19fc1",
    ),
    "runtime_inventory.py": (
        None,
        "7ffc9c25d70266a2607a7d861e857ea2e6a6dd872b25a2bced2a83d8c66394f5",
    ),
}


def run(args):
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=45, cwd="/tmp"
    )
    if result.returncode:
        # Arbitrary output may contain secrets: return only the operation name.
        raise RuntimeError("command_failed:" + Path(args[0]).name)
    return result.stdout.strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inventory(folder):
    found = {}
    for name in MANIFEST:
        path = folder / name
        if path.is_symlink() or (path.exists() and not path.is_file()):
            raise RuntimeError("unsafe_package_entry:" + name)
        found[name] = digest(path.read_bytes()) if path.exists() else None
    return found


def check_baseline(found):
    unknown = [name for name, value in found.items() if value not in MANIFEST[name]]
    if unknown:
        raise RuntimeError("local_changes_preserved:" + ",".join(unknown))


def download(name):
    url = (
        "https://raw.githubusercontent.com/conpol84/javris-clone/"
        + SOURCE
        + "/src/openjarvis/server/"
        + name
    )
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024 or digest(data) != MANIFEST[name][1]:
        raise RuntimeError("candidate_hash_mismatch:" + name)
    ast.parse(data, filename=name)
    return data


def replace(path, data, metadata):
    fd, temporary = tempfile.mkstemp(prefix=".firbo-update-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(temporary, stat.S_IMODE(metadata.st_mode))
        os.chown(temporary, metadata.st_uid, metadata.st_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def transact(folder, candidates, backup, active, command=run, verify=lambda: None):
    original = {
        name: (folder / name).read_bytes() if (folder / name).exists() else None
        for name in MANIFEST
    }
    metadata = {
        name: (folder / name).stat() for name in MANIFEST if (folder / name).exists()
    }
    fallback_metadata = metadata["routes.py"]
    backup.mkdir(mode=0o700)
    record = {}
    for name, data in original.items():
        info = metadata.get(name)
        record[name] = {
            "sha256": digest(data) if data is not None else None,
            "mode": stat.S_IMODE(info.st_mode) if info else None,
            "uid": info.st_uid if info else None,
            "gid": info.st_gid if info else None,
        }
        if data is not None:
            path = backup / name
            path.write_bytes(data)
            path.chmod(0o600)
    (backup / "manifest.json").write_text(
        json.dumps(
            {"source": SOURCE, "files": record, "active_services": list(active)},
            indent=2,
        )
    )
    changed = False
    try:
        for service in active:
            command(["systemctl", "stop", service])
        # Recheck after stopping: never overwrite changes made since inspection.
        if inventory(folder) != {
            name: digest(data) if data is not None else None
            for name, data in original.items()
        }:
            raise RuntimeError("package_changed_during_update")
        changed = True
        for name, data in candidates.items():
            replace(folder / name, data, metadata.get(name, fallback_metadata))
        for service in active:
            command(["systemctl", "start", service])
        verify()
    except BaseException:
        if changed:
            for service in active:
                command(["systemctl", "stop", service])
            for name, data in original.items():
                path = folder / name
                if data is None:
                    path.unlink(missing_ok=True)
                else:
                    replace(path, data, metadata[name])
        for service in active:
            command(["systemctl", "start", service])
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if os.geteuid() != 0 or socket.gethostname() != "srv2027143":
        raise RuntimeError("run_as_root_on_srv2027143")
    installed = run(
        [
            "runuser",
            "-u",
            "jarvis",
            "--",
            str(PYTHON),
            "-c",
            "import openjarvis; print(openjarvis.__file__)",
        ]
    )
    if Path(installed).resolve().parent / "server" != PACKAGE:
        raise RuntimeError("unexpected_python_package")
    if PACKAGE.resolve() != PACKAGE or PACKAGE.is_symlink():
        raise RuntimeError("unexpected_package_symlink")
    if Path("/home/jarvis/.openjarvis-box/.venv").resolve() != PYTHON.parent.parent:
        raise RuntimeError("box_uses_different_environment")
    active = []
    for service in SERVICES:
        user = run(["systemctl", "show", service, "-p", "User", "--value"])
        if user != "jarvis":
            raise RuntimeError("unexpected_service_user")
        state = run(["systemctl", "show", service, "-p", "ActiveState", "--value"])
        if state != "active":
            raise RuntimeError("service_not_active:" + service)
        active.append(service)
    found = inventory(PACKAGE)
    print(
        json.dumps(
            {
                "source": SOURCE,
                "installed_files": found,
                "services": active,
                "mode": "apply" if args.apply else "inspect",
            },
            indent=2,
        ),
        flush=True,
    )
    check_baseline(found)
    if not args.apply:
        return
    if all(found[name] == hashes[1] for name, hashes in MANIFEST.items()):
        print(json.dumps({"already_installed": True, "execution_verified": False}))
        return
    candidates = {name: download(name) for name in MANIFEST}
    backup = Path(tempfile.mkdtemp(prefix="firbo-engine-", dir="/var/backups"))
    backup.rmdir()  # transact creates it exclusively; refuses an existing backup.

    def verify():
        if inventory(PACKAGE) != {name: hashes[1] for name, hashes in MANIFEST.items()}:
            raise RuntimeError("installed_hash_mismatch")
        run(
            [
                "runuser",
                "-u",
                "jarvis",
                "--",
                str(PYTHON),
                "-B",
                "-c",
                "from openjarvis.server import routes, models, runtime_inventory; "
                "assert 'firbo_include_execution' in "
                "models.ChatCompletionRequest.model_fields; "
                "assert callable(routes._execution_receipt); "
                "assert callable(runtime_inventory.agent_runtime_inventory)",
            ]
        )
        time.sleep(3)
        for service in active:
            run(["systemctl", "is-active", "--quiet", service])

    transact(PACKAGE, candidates, backup, active, verify=verify)
    print(
        json.dumps(
            {
                "installed": True,
                "backup": str(backup),
                "services_active": True,
                "execution_verified": False,
                "full_parity_complete": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(
            json.dumps(
                {
                    "installed": False,
                    "error_type": type(error).__name__,
                    "error": str(error)
                    if isinstance(error, RuntimeError)
                    else "operation_failed",
                }
            ),
            flush=True,
        )
        raise SystemExit(1) from None
