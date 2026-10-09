#!/usr/bin/env python3
"""Owner-operated password recovery for the installed Jarvis dashboard."""

import fcntl
import getpass
import hashlib
import json
import os
import pathlib
import secrets
import socket
import subprocess
import tempfile
import time
import warnings
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

CONFIG = pathlib.Path("/home/jarvis/.openjarvis/dashboard-login.json")
ORIGIN = "https://jarvis.firboai.app"
DOMAIN = "jarvis.firboai.app"
MODULE_HASH = "37056dc0646ebec50cdc10bd75a25b398c2b8afbfaa32de0a792edfd229f8348"


def require(value, code):
    if not value:
        raise RuntimeError(code)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http(base, path, *, data=None, cookie=None):
    headers = {"Host": DOMAIN}
    if data is not None:
        headers.update(
            {"Origin": ORIGIN, "Content-Type": "application/x-www-form-urlencoded"}
        )
    if cookie:
        headers["Cookie"] = cookie
    request = Request(base + path, data=data, headers=headers)
    opener = build_opener(ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(request, timeout=12)
    except HTTPError as error:
        response = error
    with response:
        return response.code, response.headers, response.read(262144)


def verify(base, password):
    status, headers, body = http(base, "/_firbo/login")
    require(status == 200 and b'type="password"' in body, "login_form_unavailable")
    require(headers.get("Referrer-Policy") == "same-origin", "origin_repair_missing")
    require(http(base, "/v1/info")[0] == 401, "anonymous_api_not_protected")
    data = urlencode({"username": "admin", "password": password}).encode()
    status, headers, _ = http(base, "/_firbo/login", data=data)
    require(
        status == 303 and headers.get("Location") == "/", "new_password_login_failed"
    )
    cookie = headers.get("Set-Cookie", "")
    require(
        all(
            s in cookie
            for s in ("__Host-firbo_jarvis=", "Secure", "HttpOnly", "SameSite=Strict")
        ),
        "session_cookie_missing",
    )
    cookie = cookie.split(";", 1)[0]
    try:
        status, _, body = http(base, "/", cookie=cookie)
        require(status == 200 and b"<html" in body.lower(), "dashboard_unavailable")
        status, _, body = http(base, "/v1/info", cookie=cookie)
        require(
            status == 200 and isinstance(json.loads(body), dict), "dashboard_api_failed"
        )
    finally:
        http(base, "/_firbo/logout", data=b"", cookie=cookie)
    require(http(base, "/v1/info", cookie=cookie)[0] == 401, "logout_failed")


def restart():
    subprocess.run(
        ["systemctl", "restart", "openjarvis.service"],
        check=True,
        capture_output=True,
        timeout=45,
    )
    for _ in range(20):
        try:
            if http("http://127.0.0.1:8765", "/_firbo/login")[0] == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("service_not_ready")


def reset_password(path, backup_root, password):
    require(12 <= len(password) <= 256, "password_must_be_12_to_256_characters")
    require(not path.is_symlink() and path.is_file(), "unexpected_config_file")
    info = path.stat()
    require(info.st_nlink == 1 and info.st_mode & 0o077 == 0, "config_not_private")
    original = path.read_bytes()
    settings = json.loads(original)
    require(settings.get("username") == "admin", "unexpected_username")
    salt = secrets.token_bytes(32)
    settings["salt"] = salt.hex()
    settings["password_hash"] = hashlib.scrypt(
        password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32
    ).hex()
    changed = json.dumps(settings).encode()
    backup = pathlib.Path(tempfile.mkdtemp(prefix="firbo-password-", dir=backup_root))
    saved = backup / path.name
    saved.touch(mode=0o600)
    saved.write_bytes(original)
    print("BACKUP:", backup, flush=True)

    def replace(data):
        fd, name = tempfile.mkstemp(prefix=".firbo-password-", dir=path.parent)
        staged = pathlib.Path(name)
        try:
            with os.fdopen(fd, "wb") as stream:
                stream.write(data)
                stream.flush()
                os.fsync(stream.fileno())
            os.chown(staged, info.st_uid, info.st_gid)
            staged.chmod(0o600)
            os.replace(staged, path)
        finally:
            staged.unlink(missing_ok=True)

    require(not path.is_symlink() and path.read_bytes() == original, "config_changed")
    replace(changed)
    try:
        restart()
        for base in ("http://127.0.0.1:8765", ORIGIN):
            verify(base, password)
        print("PASSWORD_RESET_AND_LOGIN_VERIFIED")
        print("USERNAME: admin")
        print("Open a NEW tab: " + ORIGIN + "/_firbo/login")
    except BaseException:
        require(
            not path.is_symlink() and path.read_bytes() == changed,
            "concurrent_config_change_manual_recovery",
        )
        replace(original)
        restart()
        print("ROLLBACK: previous password restored")
        raise


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
    require(
        len(paths) == 1
        and hashlib.sha256(paths[0].read_bytes()).hexdigest() == MODULE_HASH,
        "installed_login_version_changed",
    )
    # Explicit /dev/tty and warnings-as-errors prevent echoed stdin fallback.
    with open("/dev/tty", "r+") as tty, warnings.catch_warnings():
        require(tty.isatty(), "interactive_terminal_required")
        warnings.simplefilter("error", getpass.GetPassWarning)
        password = getpass.getpass("NEW Jarvis password (12+ characters): ", stream=tty)
        require(
            password == getpass.getpass("Repeat NEW password: ", stream=tty),
            "passwords_do_not_match",
        )
    fd = os.open(
        "/run/lock/firbo-dashboard-password.lock",
        os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW,
        0o600,
    )
    with os.fdopen(fd, "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        reset_password(CONFIG, pathlib.Path("/var/backups"), password)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            "STOP:",
            str(error) if isinstance(error, RuntimeError) else type(error).__name__,
        )
        raise SystemExit(1)
