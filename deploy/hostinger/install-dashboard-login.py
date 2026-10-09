#!/usr/bin/env python3
"""Install Jarvis form login; verify local acceptance before Caddy cutover."""

from __future__ import annotations

import argparse
import ast
import fcntl
import getpass
import hashlib
import json
import os
import pathlib
import pwd
import re
import secrets
import socket
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

DOMAIN = "jarvis.firboai.app"
ORIGIN = "https://" + DOMAIN
LIB_ROOT = pathlib.Path("/home/jarvis/.openjarvis/.venv/lib")
BACKUP_ROOT = pathlib.Path("/var/backups")
MODULE_HASH = "37056dc0646ebec50cdc10bd75a25b398c2b8afbfaa32de0a792edfd229f8348"
CONFIG = pathlib.Path("/home/jarvis/.openjarvis/dashboard-login.json")
DROPIN = pathlib.Path(
    "/etc/systemd/system/openjarvis.service.d/90-firbo-dashboard-login.conf"
)
HOOK = (
    "    from openjarvis.server.dashboard_login import install_dashboard_login\n\n"
    "    install_dashboard_login(app)\n"
)


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def run(args, *, data=None, check=True):
    result = subprocess.run(args, input=data, capture_output=True, timeout=45)
    if check:
        require(result.returncode == 0, "command_failed_" + pathlib.Path(args[0]).name)
    return result


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def http(url, *, data=None, cookie=None, origin=False, host=True):
    headers = {"Host": DOMAIN} if host else {}
    if cookie:
        headers["Cookie"] = cookie
    if data is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if origin:
        headers["Origin"] = ORIGIN
    request = Request(url, headers=headers, data=data)
    opener = build_opener(ProxyHandler({}), NoRedirect())
    try:
        response = opener.open(request, timeout=12)
    except HTTPError as error:
        response = error
    with response:
        return response.code, response.headers, response.read(262144)


def patched_app(raw):
    text = raw.decode()
    tree = ast.parse(text)
    funcs = [
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "create_app"
    ]
    require(len(funcs) == 1, "app_factory_not_unique")
    factory = funcs[0]
    node = factory.body[-1]
    require(
        isinstance(node, ast.Return)
        and isinstance(node.value, ast.Name)
        and node.value.id == "app",
        "app_factory_shape_changed",
    )
    if "install_dashboard_login" in text:
        require(
            text.count(HOOK) == 1 and text.count("install_dashboard_login") == 2,
            "unknown_existing_login_hook",
        )
        return raw
    lines = text.splitlines(keepends=True)
    lines.insert(node.lineno - 1, HOOK)
    candidate = "".join(lines).encode()
    ast.parse(candidate)
    return candidate


def tokens(text):
    # Caddy blocks, quoted tokens and {$ENV} substitutions are distinct tokens.
    pattern = r'#[^\n]*|"(?:\\.|[^"\\])*"|`[^`]*`|\{\$[^}]+\}|[{}]|[^\s{}#]+'
    return [
        (m.group(), m.start(), m.end())
        for m in re.finditer(pattern, text)
        if not m.group().startswith("#")
    ]


def remove_basic(raw):
    text = raw.decode()
    items = tokens(text)
    depth = 0
    site = None
    pairs = []
    starts = []
    for i, (token, _, _) in enumerate(items):
        if token == "{":
            starts.append(i)
            if depth == 0 and i > 0 and items[i - 1][0] in (DOMAIN, ORIGIN):
                require(site is None, "duplicate_jarvis_site")
                # Do not accept a multi-host site block.
                line = text[
                    text.rfind("\n", 0, items[i - 1][1]) + 1 : items[i][1]
                ].strip()
                require(line in (DOMAIN, ORIGIN), "shared_or_unexpected_jarvis_site")
                site = i
            depth += 1
        elif token == "}":
            require(bool(starts), "invalid_caddy_braces")
            pairs.append((starts.pop(), i))
            depth -= 1
    require(depth == 0 and site is not None, "literal_jarvis_site_not_found")
    end = next(b for a, b in pairs if a == site)
    auth = []
    for a, b in pairs:
        if (
            site < a < b < end
            and a > 0
            and items[a - 1][0] in ("basic_auth", "basicauth")
        ):
            auth.append((items[a - 1][1], items[b][2]))
    require(len(auth) == 1, "simple_basic_auth_block_not_unique")
    start, stop = auth[0]
    # Exact byte slice only; all other sites and directives are untouched.
    return (text[:start] + text[stop:]).encode()


def auth_removed(config):
    """Normalize only Jarvis Basic auth for adapted-config comparison."""
    found = 0

    def walk(value, selected=False):
        nonlocal found
        if isinstance(value, dict):
            hosts = [h for m in value.get("match", []) for h in m.get("host", [])]
            if DOMAIN in hosts:
                require(hosts == [DOMAIN], "shared_adapted_jarvis_route")
                selected = True
            if selected and value.get("handler") == "authentication":
                require(
                    set(value.get("providers", {})) == {"http_basic"},
                    "unexpected_auth_provider",
                )
                found += 1
                return None
            result = {k: walk(v, selected) for k, v in value.items()}
            # Caddy can omit a subroute after one handler is removed.
            if set(result) == {"handler", "routes"} and result["handler"] == "subroute":
                routes = result["routes"]
                if len(routes) == 1 and set(routes[0]) == {"handle"}:
                    return routes[0]["handle"]
            return result
        if isinstance(value, list):
            result = []
            for item in value:
                child = walk(item, selected)
                if child is not None:
                    result.extend(child if isinstance(child, list) else [child])
            return result
        return value

    return walk(config), found


def acceptance(base, password):
    status, headers, _ = http(base + "/")
    require(
        status == 303
        and headers.get("Location") == "/_firbo/login"
        and not headers.get("WWW-Authenticate"),
        "anonymous_root_not_login",
    )
    status, _, body = http(base + "/_firbo/login")
    require(status == 200 and b'type="password"' in body, "login_page_missing")
    status, _, _ = http(base + "/v1/info")
    require(status == 401, "anonymous_api_not_protected")
    status, _, _ = http(
        base + "/_firbo/login", data=b"username=admin&password=wrong", origin=True
    )
    require(status == 401, "wrong_password_not_rejected")
    data = urlencode({"username": "admin", "password": password}).encode()
    status, headers, _ = http(base + "/_firbo/login", data=data, origin=True)
    require(status == 303, "login_failed")
    cookie = headers.get("Set-Cookie", "")
    require(
        all(
            x in cookie
            for x in ("__Host-firbo_jarvis=", "Secure", "HttpOnly", "SameSite=Strict")
        ),
        "cookie_flags_missing",
    )
    cookie = cookie.split(";", 1)[0]
    try:
        status, _, body = http(base + "/_firbo/status", cookie=cookie)
        require(
            status == 200
            and json.loads(body).get("version") == "firbo-dashboard-login/1",
            "wrong_login_version",
        )
        status, _, body = http(base + "/", cookie=cookie)
        require(
            status == 200 and b"<html" in body.lower(), "authenticated_dashboard_failed"
        )
        status, _, body = http(base + "/v1/info", cookie=cookie)
        require(
            status == 200 and isinstance(json.loads(body), dict),
            "authenticated_api_failed",
        )
    finally:
        http(base + "/_firbo/logout", data=b"", cookie=cookie, origin=True)
    require(http(base + "/v1/info", cookie=cookie)[0] == 401, "logout_failed")


def wait_local():
    for _ in range(20):
        try:
            if http("http://127.0.0.1:8765/_firbo/login")[0] == 200:
                return
        except Exception:
            pass
        time.sleep(1)
    raise RuntimeError("admin_service_not_ready")


def install(source):
    require(
        os.geteuid() == 0 and socket.gethostname() == "srv2027143",
        "run_on_VPS_root_srv2027143",
    )
    os.umask(0o077)
    require(re.fullmatch(r"[0-9a-f]{40}", source), "immutable_source_required")
    require(
        not CONFIG.exists() and not DROPIN.exists(),
        "login_already_configured_do_not_reinstall",
    )
    paths = list(LIB_ROOT.glob("python*/site-packages/openjarvis/server/app.py"))
    require(len(paths) == 1 and not paths[0].is_symlink(), "installed_app_not_unique")
    app = paths[0]
    module = app.with_name("dashboard_login.py")
    require(not module.exists(), "existing_login_module_requires_review")
    require(
        run(["systemctl", "is-active", "openjarvis.service"]).stdout.strip()
        == b"active",
        "admin_not_active",
    )
    require(
        http("http://127.0.0.1:8765/health", host=False)[0] == 200,
        "local_health_failed",
    )
    details = json.loads(run(["docker", "inspect", "firbo-caddy"]).stdout)[0]
    mounts = [
        m
        for m in details.get("Mounts", [])
        if m.get("Destination") == "/etc/caddy/Caddyfile" and m.get("Type") == "bind"
    ]
    require(len(mounts) == 1, "caddy_bind_mount_not_unique")
    caddy = pathlib.Path(mounts[0]["Source"])
    require(caddy.is_file() and not caddy.is_symlink(), "caddyfile_not_regular")
    original_app, original_caddy = app.read_bytes(), caddy.read_bytes()
    candidate_app, candidate_caddy = (
        patched_app(original_app),
        remove_basic(original_caddy),
    )
    old_config = json.loads(
        run(
            [
                "docker",
                "exec",
                "firbo-caddy",
                "caddy",
                "adapt",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ]
        ).stdout
    )
    expected_config, count = auth_removed(old_config)
    require(count == 1, "live_basic_auth_not_unique")
    url = f"https://raw.githubusercontent.com/conpol84/javris-clone/{source}/src/openjarvis/server/dashboard_login.py"
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(url, timeout=30) as response:
        code = response.read(131073)
    require(
        hashlib.sha256(code).hexdigest() == MODULE_HASH, "module_download_hash_mismatch"
    )
    ast.parse(code)
    account = pwd.getpwnam("jarvis")
    with open("/dev/tty", "w") as tty:
        print(
            "Username: admin. Choose a NEW password (at least 12 characters).",
            file=tty,
            flush=True,
        )
    password = getpass.getpass("New OpenJarvis dashboard password: ")
    require(12 <= len(password) <= 256, "password_length_12_to_256_required")
    require(password == getpass.getpass("Repeat password: "), "passwords_do_not_match")
    salt = secrets.token_bytes(32)
    config = json.dumps(
        {
            "username": "admin",
            "salt": salt.hex(),
            "password_hash": hashlib.scrypt(
                password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32
            ).hex(),
        }
    ).encode()
    backup = pathlib.Path(
        tempfile.mkdtemp(prefix="firbo-jarvis-login-", dir=BACKUP_ROOT)
    )
    for name, data in (("app.py", original_app), ("Caddyfile", original_caddy)):
        dest = backup / name
        dest.write_bytes(data)
        dest.chmod(0o600)
    (backup / "paths.json").write_text(
        json.dumps(
            {
                "app": str(app),
                "caddy": str(caddy),
                "module": str(module),
                "config": str(CONFIG),
                "dropin": str(DROPIN),
            }
        )
    )
    print("BACKUP:", backup, flush=True)
    touched_caddy = False
    touched_app = False
    changed = []
    try:
        require(
            app.read_bytes() == original_app and caddy.read_bytes() == original_caddy,
            "files_changed_during_preflight",
        )
        for path, data, mode in ((module, code, 0o644), (CONFIG, config, 0o600)):
            with path.open("xb") as stream:
                stream.write(data)
            changed.append(path)
            path.chmod(mode)
            os.chown(path, account.pw_uid, account.pw_gid)
        DROPIN.parent.mkdir(exist_ok=True)
        with DROPIN.open("x") as stream:
            stream.write(
                f"[Service]\nEnvironment=FIRBO_DASHBOARD_LOGIN_CONFIG={CONFIG}\n"
            )
        changed.append(DROPIN)
        DROPIN.chmod(0o644)
        require(app.read_bytes() == original_app, "app_changed_during_install")
        touched_app = True
        app.write_bytes(candidate_app)
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "restart", "openjarvis.service"])
        wait_local()
        acceptance("http://127.0.0.1:8765", password)
        print("LOCAL_LOGIN_API_LOGOUT_PASSED", flush=True)
        require(caddy.read_bytes() == original_caddy, "caddy_changed_during_install")
        # Write in-place: Caddy's read-only bind mount must keep the same inode.
        touched_caddy = True
        caddy.write_bytes(candidate_caddy)
        run(
            [
                "docker",
                "exec",
                "firbo-caddy",
                "caddy",
                "validate",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ]
        )
        adapted = json.loads(
            run(
                [
                    "docker",
                    "exec",
                    "firbo-caddy",
                    "caddy",
                    "adapt",
                    "--config",
                    "/etc/caddy/Caddyfile",
                    "--adapter",
                    "caddyfile",
                ]
            ).stdout
        )
        actual_config, count = auth_removed(adapted)
        require(
            count == 0 and actual_config == expected_config,
            "unexpected_caddy_route_change",
        )
        run(
            [
                "docker",
                "exec",
                "firbo-caddy",
                "caddy",
                "reload",
                "--config",
                "/etc/caddy/Caddyfile",
                "--adapter",
                "caddyfile",
            ]
        )
        acceptance(ORIGIN, password)
        require(
            http("http://127.0.0.1:8766/health", host=False)[0] == 200,
            "box_health_failed",
        )
        print("PUBLIC_LOGIN_DASHBOARD_API_LOGOUT_PASSED", flush=True)
        print("OPEN:", ORIGIN + "/_firbo/login")
        print("USERNAME: admin (use the password you just chose)")
        print("SIGN OUT:", ORIGIN + "/_firbo/login")
        print("No inference performed. Device control is a separate acceptance check.")
    except BaseException:
        # Restore outer authentication FIRST. Never expose the original app unguarded.
        if touched_caddy:
            require(
                caddy.read_bytes() in (original_caddy, candidate_caddy),
                "concurrent_caddy_change_manual_recovery_required",
            )
            caddy.write_bytes(original_caddy)
            restored = run(
                [
                    "docker",
                    "exec",
                    "firbo-caddy",
                    "caddy",
                    "reload",
                    "--config",
                    "/etc/caddy/Caddyfile",
                    "--adapter",
                    "caddyfile",
                ],
                check=False,
            )
            if restored.returncode != 0:
                print(
                    "STOP: Caddy rollback needs attention; NEW login remains enabled.",
                    flush=True,
                )
                raise
        if touched_app:
            require(
                app.read_bytes() == candidate_app,
                "concurrent_app_change_manual_recovery_required",
            )
            app.write_bytes(original_app)
        for path in reversed(changed):
            path.unlink(missing_ok=True)
        run(["systemctl", "daemon-reload"])
        run(["systemctl", "restart", "openjarvis.service"])
        print("ROLLBACK: original Basic login and application restored.", flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    require(args.apply, "explicit_apply_required")
    require(os.geteuid() == 0, "root_required")
    with open("/run/firbo-dashboard-login.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        install(args.source)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        # Never dump upstream bodies, environment, password, config or command output.
        print(
            "STOP:",
            str(error) if isinstance(error, RuntimeError) else type(error).__name__,
        )
        raise SystemExit(1)
