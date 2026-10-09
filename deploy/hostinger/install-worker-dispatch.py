#!/usr/bin/env python3
"""Install the administrator-only VPS worker selector, preserving current services."""

import argparse
import ast
import fcntl
import hashlib
import json
import os
import pathlib
import re
import socket
import stat
import subprocess
import tempfile
import time
import uuid
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

MODULE_HASH = "3bbdadf3927d268a114d8759ba8927997da9f0d4342a3a767e8241086a5db206"
DROPIN = pathlib.Path(
    "/etc/systemd/system/openjarvis.service.d/91-firbo-worker-dispatch.conf"
)
ENABLE = b"[Service]\nEnvironment=FIRBO_WORKER_DISPATCH_ENABLED=1\n"
HOOK = (
    "    from openjarvis.server.firbo_dispatch import install_worker_dispatch\n\n"
    "    install_worker_dispatch(app)\n"
)


def require(value, code):
    if not value:
        raise RuntimeError(code)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def run(args):
    return subprocess.run(args, check=True, capture_output=True, timeout=45).stdout


def regular(path):
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "unexpected_file_link")
    return info


def patch_app(original):
    """Insert in the exact factory's final return, preserving every other byte."""
    raw = original.decode("utf-8")
    tree = ast.parse(raw)
    factories = [
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "create_app"
    ]
    require(len(factories) == 1, "unexpected_app_factory")
    factory = factories[0]
    last = factory.body[-1]
    require(
        isinstance(last, ast.Return)
        and isinstance(last.value, ast.Name)
        and last.value.id == "app",
        "unexpected_app_factory_return",
    )
    calls = [
        n
        for n in ast.walk(factory)
        if isinstance(n, ast.Call)
        and isinstance(n.func, ast.Name)
        and n.func.id == "install_worker_dispatch"
    ]
    if calls:
        require(
            len(calls) == 1 and raw.count(HOOK) == 1,
            "unexpected_existing_dispatch_hook",
        )
        return original
    require("firbo_dispatch" not in raw, "unexpected_existing_dispatch_source")
    lines = raw.splitlines(keepends=True)
    require(
        lines[last.lineno - 1].strip() == "return app", "unexpected_app_return_line"
    )
    lines.insert(last.lineno - 1, HOOK)
    changed = "".join(lines).encode()
    ast.parse(changed)
    return changed


def replace(path, data, *, uid, gid, mode):
    fd, name = tempfile.mkstemp(prefix=".firbo-dispatch-", dir=path.parent)
    staged = pathlib.Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chown(staged, uid, gid)
        staged.chmod(mode)
        os.replace(staged, path)
    finally:
        staged.unlink(missing_ok=True)


def service_pid(unit):
    value = (
        run(["systemctl", "show", unit, "-p", "MainPID", "--value"]).decode().strip()
    )
    require(value.isdigit() and int(value) > 0, "service_not_running")
    return value


def api_key():
    pid = service_pid("openjarvis.service")
    values = pathlib.Path("/proc", pid, "environ").read_bytes().split(b"\0")
    keys = [v.split(b"=", 1)[1] for v in values if v.startswith(b"OPENJARVIS_API_KEY=")]
    require(len(keys) == 1 and keys[0], "configured_api_key_unavailable")
    return keys[0].decode()


def http(path, key=None, payload=None, *, port=8765):
    headers = {"Host": "127.0.0.1"}
    if key:
        headers["Authorization"] = "Bearer " + key
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"
    request = Request(f"http://127.0.0.1:{port}" + path, headers=headers, data=data)
    try:
        response = build_opener(ProxyHandler({}), NoRedirect()).open(
            request, timeout=10
        )
    except HTTPError as error:
        response = error
    with response:
        return response.code, response.read(262145)


def runtime(key):
    status, raw = http("/v1/info", key)
    require(status == 200 and len(raw) <= 262144, "runtime_not_ready")
    data = json.loads(raw)
    return {k: data.get(k) for k in ("model", "agent", "engine", "runtime")}


def acceptance(key):
    org, request_id = str(uuid.uuid4()), str(uuid.uuid4())
    body = {
        "contract": "firbo-worker-dispatch/v1",
        "request_id": request_id,
        "organization_id": org,
        "kind": "server_task",
        "params": {},
        "devices": [],
    }
    require(
        http("/v1/firbo/dispatch", payload=body)[0] == 401,
        "anonymous_selector_not_protected",
    )
    status, raw = http("/v1/firbo/dispatch", key, body)
    require(status == 200, "selector_not_ready")
    out = json.loads(raw)
    require(
        out.get("contract") == body["contract"]
        and out.get("request_id") == request_id
        and out.get("organization_id") == org
        and out.get("worker", {}).get("kind") == "vps"
        and out.get("job") == {"kind": "server_task", "params": {}},
        "selector_contract_failed",
    )
    body["kind"] = "desktop_task"
    require(
        http("/v1/firbo/dispatch", key, body)[0] == 409, "empty_inventory_not_denied"
    )


def install(
    app_path,
    module,
    *,
    dropin=DROPIN,
    backup_root=pathlib.Path("/var/backups"),
    verify=None,
    restart=None,
    reload=None,
):
    """Atomic file updates with conservative rollback; no inference or device work."""
    require(callable(verify), "acceptance_check_required")
    module_path = app_path.parent / "firbo_dispatch.py"
    require(hashlib.sha256(module).hexdigest() == MODULE_HASH, "module_hash_mismatch")
    app_info = regular(app_path)
    original_app = app_path.read_bytes()
    changed_app = patch_app(original_app)
    originals = {app_path: (original_app, app_info)}
    for path in (module_path, dropin):
        if path.exists() or path.is_symlink():
            info = regular(path)
            originals[path] = (path.read_bytes(), info)
        else:
            originals[path] = (None, None)
    if originals[module_path][0] is not None:
        require(
            hashlib.sha256(originals[module_path][0]).hexdigest() == MODULE_HASH,
            "existing_dispatch_module_changed",
        )
    if originals[dropin][0] is not None:
        require(originals[dropin][0] == ENABLE, "existing_dispatch_dropin_changed")
    require(
        dropin.parent.is_dir() and not dropin.parent.is_symlink(),
        "service_dropin_directory_missing",
    )
    backup = pathlib.Path(
        tempfile.mkdtemp(prefix="firbo-worker-dispatch-", dir=backup_root)
    )
    for path, (data, _) in originals.items():
        if data is not None:
            (backup / path.name).write_bytes(data)
    print("BACKUP:", backup, flush=True)
    updates = {module_path: module, app_path: changed_app, dropin: ENABLE}
    applied = []
    restart = restart or (lambda: run(["systemctl", "restart", "openjarvis.service"]))
    reload = reload or (lambda: run(["systemctl", "daemon-reload"]))
    try:
        for path, data in updates.items():
            before, info = originals[path]
            require(
                (before is None and not path.exists() and not path.is_symlink())
                or (
                    before is not None and regular(path) and path.read_bytes() == before
                ),
                "concurrent_file_change",
            )
            replace(
                path,
                data,
                uid=info.st_uid if info else (0 if path == dropin else app_info.st_uid),
                gid=info.st_gid if info else (0 if path == dropin else app_info.st_gid),
                mode=info.st_mode & 0o777 if info else 0o644,
            )
            applied.append(path)
        reload()
        restart()
        verify()
    except BaseException:
        for path in reversed(applied):
            require(
                regular(path) and path.read_bytes() == updates[path],
                "concurrent_change_manual_recovery",
            )
            before, info = originals[path]
            if before is None:
                path.unlink()
            else:
                replace(
                    path,
                    before,
                    uid=info.st_uid,
                    gid=info.st_gid,
                    mode=info.st_mode & 0o777,
                )
        reload()
        restart()
        print("ROLLBACK: previous service files restored")
        raise
    return backup


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    require(
        os.geteuid() == 0 and socket.gethostname() == "srv2027143",
        "run_on_VPS_root_srv2027143",
    )
    require(re.fullmatch(r"[0-9a-f]{40}", args.source), "immutable_source_required")
    os.umask(0o077)
    url = (
        f"https://raw.githubusercontent.com/conpol84/javris-clone/{args.source}/"
        "src/openjarvis/server/firbo_dispatch.py"
    )
    with build_opener(ProxyHandler({}), NoRedirect()).open(url, timeout=30) as response:
        module = response.read(262145)
    require(hashlib.sha256(module).hexdigest() == MODULE_HASH, "download_hash_mismatch")
    paths = list(
        pathlib.Path("/home/jarvis/.openjarvis/.venv/lib").glob(
            "python*/site-packages/openjarvis/server/app.py"
        )
    )
    require(len(paths) == 1, "installed_app_not_unique")
    regular(paths[0])
    patch_app(paths[0].read_bytes())
    key = api_key()
    before = runtime(key)
    box_pid = service_pid("openjarvis-box.service")
    require(http("/health", port=8766)[0] == 200, "box_not_healthy")
    if not args.apply:
        print("WORKER_DISPATCH_PREFLIGHT_PASSED — no changes made")
        return
    fd = os.open(
        "/run/lock/firbo-worker-dispatch.lock",
        os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)

        def verify():
            for attempt in range(20):
                try:
                    acceptance(key)
                    break
                except Exception:
                    if attempt == 19:
                        raise
                    time.sleep(0.5)
            require(runtime(key) == before, "runtime_configuration_changed")
            require(
                service_pid("openjarvis-box.service") == box_pid
                and http("/health", port=8766)[0] == 200,
                "box_service_changed",
            )

        install(paths[0], module, verify=verify)
    print(
        "VPS_WORKER_DISPATCH_INSTALLED — selector authenticated; no device job executed"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            "STOP:",
            str(error) if isinstance(error, RuntimeError) else type(error).__name__,
        )
        raise SystemExit(1)
