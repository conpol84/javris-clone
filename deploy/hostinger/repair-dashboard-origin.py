#!/usr/bin/env python3
"""Repair the installed login response header; preserve password and access rules."""

import hashlib
import os
import pathlib
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

OLD = "b4e107a7cdbb41e5bed35f214731eadcfeaf4e9ef2b276cd05bb9b88c9ec2e64"
NEW = "37056dc0646ebec50cdc10bd75a25b398c2b8afbfaa32de0a792edfd229f8348"
DOMAIN = "jarvis.firboai.app"


def require(value, code):
    if not value:
        raise RuntimeError(code)


def restart():
    subprocess.run(
        ["systemctl", "restart", "openjarvis.service"],
        check=True,
        timeout=45,
        capture_output=True,
    )


def verify(base):
    opener = build_opener(ProxyHandler({}))
    request = Request(base + "/_firbo/login", headers={"Host": DOMAIN})
    with opener.open(request, timeout=12) as response:
        require(response.code == 200, "login_not_ready")
        require(
            response.headers.get_all("Referrer-Policy") == ["same-origin"],
            "wrong_referrer_policy",
        )
        require(b'type="password"' in response.read(65536), "login_form_missing")
    request = Request(base + "/v1/info", headers={"Host": DOMAIN})
    try:
        with opener.open(request, timeout=12):
            raise RuntimeError("anonymous_api_not_protected")
    except HTTPError as error:
        require(error.code == 401, "unexpected_api_status")
        error.close()


def main():
    require(
        os.geteuid() == 0 and socket.gethostname() == "srv2027143",
        "run_on_VPS_root_srv2027143",
    )
    os.umask(0o077)
    paths = list(
        pathlib.Path("/home/jarvis/.openjarvis/.venv/lib").glob(
            "python*/site-packages/openjarvis/server/dashboard_login.py"
        )
    )
    require(len(paths) == 1, "installed_login_not_unique")
    path = paths[0]
    require(not path.is_symlink() and path.stat().st_nlink == 1, "unexpected_file_link")
    original = path.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    if digest == NEW:
        verify("https://" + DOMAIN)
        print("LOGIN_ORIGIN_ALREADY_FIXED")
        return
    require(digest == OLD, "installed_version_changed")
    fixed = original.replace(
        b'(b"referrer-policy", b"no-referrer")', b'(b"referrer-policy", b"same-origin")'
    )
    require(hashlib.sha256(fixed).hexdigest() == NEW, "patch_hash_mismatch")
    backup = pathlib.Path(
        tempfile.mkdtemp(prefix="firbo-login-origin-", dir="/var/backups")
    )
    (backup / path.name).write_bytes(original)
    print("BACKUP:", backup, flush=True)
    info = path.stat()

    def replace(data):
        fd, name = tempfile.mkstemp(prefix=".firbo-origin-", dir=path.parent)
        staged = pathlib.Path(name)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chown(staged, info.st_uid, info.st_gid)
            staged.chmod(info.st_mode & 0o777)
            os.replace(staged, path)
        finally:
            staged.unlink(missing_ok=True)

    require(path.read_bytes() == original, "file_changed_during_preflight")
    replace(fixed)
    try:
        restart()
        for attempt in range(15):
            try:
                verify("http://127.0.0.1:8765")
                break
            except Exception:
                if attempt == 14:
                    raise
                time.sleep(1)
        verify("https://" + DOMAIN)
        print("LOGIN_ORIGIN_FIXED — password unchanged; anonymous API still denied")
        print("Open a NEW tab: https://jarvis.firboai.app/_firbo/login")
    except BaseException:
        require(path.read_bytes() == fixed, "concurrent_change_manual_recovery")
        replace(original)
        restart()
        print("ROLLBACK: previous login module restored")
        raise


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            "STOP:",
            str(error) if isinstance(error, RuntimeError) else type(error).__name__,
        )
        raise SystemExit(1)
