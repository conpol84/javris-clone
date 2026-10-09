#!/usr/bin/env python3
"""Replace only the known installed native input adapter; keep pairing and policy."""

import argparse
import hashlib
import json
import os
import pathlib
import re
import socket
import subprocess
import tempfile
from urllib.request import HTTPRedirectHandler, ProxyHandler, build_opener

OLD = {
    "firbo-desktop.py": (
        "2b8be9381c03c717945705c1861861d64d12ca41e34ad2814ddb65064c3999a8"
    ),
    "firbo-desktop.mjs": (
        "9398c2981ace17687f73878183ead935f5b1414191f668018f7f66e3d7d3873c"
    ),
}
NEW = {
    "firbo-desktop.py": (
        "5c65a5fcaa96af709643cdb5c99ec4e2b948964ff231359142237ba0f42af4a5"
    ),
    "firbo-desktop.mjs": (
        "3cb4f820213d67931750cf69980ae1dbdeae9c5d91c3c4328313582bb9c1b428"
    ),
}  # Manifest generated from the exact reviewed adapter bytes.
UNIT = "firbo-connector.service"
PROC_ROOT = pathlib.Path("/proc")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def require(value, code):
    if not value:
        raise RuntimeError(code)


def run(args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=30, **kwargs)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    args = parser.parse_args()
    require(
        os.geteuid() != 0 and socket.gethostname() == "Firbo-debian",
        "Run_on_Firbo_debian_as_firbo_NOT_VPS",
    )
    require(re.fullmatch("[a-f0-9]{40}", args.source), "immutable_source_required")
    os.umask(0o077)
    home = pathlib.Path.home()
    target = home / "Downloads"
    pid = run(
        ["systemctl", "--user", "show", UNIT, "-p", "MainPID", "--value"], text=True
    ).stdout.strip()
    proc = PROC_ROOT / pid
    require(
        str(target / "firbo-connector.mjs").encode()
        in (proc / "cmdline").read_bytes().split(b"\0"),
        "unexpected_connector_service",
    )
    raw_env = dict(
        x.split("=", 1) for x in (proc / "environ").read_text().split("\0") if "=" in x
    )
    env = os.environ.copy()
    for key in (
        "DISPLAY",
        "XAUTHORITY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "DBUS_SESSION_BUS_ADDRESS",
    ):
        env.pop(key, None)
        if raw_env.get(key):
            env[key] = raw_env[key]
    require(
        env.get("DISPLAY") and not env.get("WAYLAND_DISPLAY"), "X11_desktop_required"
    )
    old = {}
    for name in OLD:
        path = target / name
        require(
            not path.is_symlink() and path.is_file() and path.stat().st_nlink == 1,
            "unexpected_adapter_file",
        )
        old[name] = path.read_bytes()
        require(
            hashlib.sha256(old[name]).hexdigest() in (OLD[name], NEW[name]),
            "installed_adapter_version_changed",
        )
    if all(hashlib.sha256(old[n]).hexdigest() == NEW[n] for n in OLD):
        print("NATIVE_INPUT_ALREADY_UPDATED")
        return
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with tempfile.TemporaryDirectory(prefix="firbo-input-stage-", dir=home) as folder:
        staged = pathlib.Path(folder)
        updated = {}
        for name, digest in NEW.items():
            url = f"https://raw.githubusercontent.com/conpol84/javris-clone/{args.source}/frontend/public/{name}"
            with opener.open(url, timeout=30) as response:
                data = response.read(262145)
            require(
                hashlib.sha256(data).hexdigest() == digest, "download_hash_mismatch"
            )
            updated[name] = data
            (staged / name).write_bytes(data)
            (staged / name).chmod(0o600)
        run(["node", "--check", str(staged / "firbo-desktop.mjs")])
        probe = run(
            ["/usr/bin/python3", str(staged / "firbo-desktop.py")],
            input='{"action":"observe"}',
            text=True,
            env=env,
        )
        frame = json.loads(probe.stdout)
        require(bool(frame.get("image")), "screen_capture_failed")
        backup = pathlib.Path(tempfile.mkdtemp(prefix="firbo-input-backup-", dir=home))
        for name, data in old.items():
            (backup / name).write_bytes(data)
        print("BACKUP:", backup, flush=True)
        changed = []
        stopped = False
        try:
            run(["systemctl", "--user", "stop", UNIT])
            stopped = True
            for name, data in old.items():
                path = target / name
                require(
                    not path.is_symlink() and path.read_bytes() == data,
                    "adapter_changed",
                )
            for name in NEW:
                os.replace(staged / name, target / name)
                changed.append(name)
            run(["systemctl", "--user", "start", UNIT])
            run(["systemctl", "--user", "is-active", UNIT])
            require(
                all((target / n).read_bytes() == updated[n] for n in NEW),
                "installed_hash_changed",
            )
        except BaseException:
            if stopped:
                run(["systemctl", "--user", "stop", UNIT])
                for name in changed:
                    require(
                        not (target / name).is_symlink()
                        and (target / name).read_bytes() == updated[name],
                        "concurrent_change_manual_recovery",
                    )
                    (staged / name).write_bytes(old[name])
                    os.replace(staged / name, target / name)
                run(["systemctl", "--user", "start", UNIT])
                print("ROLLBACK: previous adapters restored")
            raise
    print("NATIVE_INPUT_UPDATED — pairing and permissions unchanged")
    print("SCREEN_CAPTURE_PASSED — actual CEO task still needs verification")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            "STOP:",
            str(error) if isinstance(error, RuntimeError) else type(error).__name__,
        )
        raise SystemExit(1)
