"""Fault injection against real temporary install files; no host service changes."""

import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "login_installer", ROOT / "deploy/hostinger/install-dashboard-login.py"
)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class RollbackTests(unittest.TestCase):
    def exercise(self, failure=None, rollback_fails=False):
        with tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
            root = pathlib.Path(folder)
            app = root / "lib/python3.12/site-packages/openjarvis/server/app.py"
            app.parent.mkdir(parents=True)
            original_app = b"def create_app():\n    app = object()\n    return app\n"
            app.write_bytes(original_app)
            caddy = root / "Caddyfile"
            original_caddy = (
                b"jarvis.firboai.app {\n basic_auth {\n admin hash\n }\n"
                b" reverse_proxy 172.17.0.1:8765\n}\n"
            )
            caddy.write_bytes(original_caddy)
            config = root / "dashboard-login.json"
            dropin = root / "dropin/login.conf"
            module = app.with_name("dashboard_login.py")
            code = (ROOT / "src/openjarvis/server/dashboard_login.py").read_bytes()
            events = []
            raw_config = {
                "match": [{"host": [installer.DOMAIN]}],
                "handle": [
                    {"handler": "authentication", "providers": {"http_basic": {}}},
                    {
                        "handler": "reverse_proxy",
                        "upstreams": [{"dial": "172.17.0.1:8765"}],
                    },
                ],
            }

            def run(args, **kwargs):
                if "inspect" in args:
                    data = [
                        {
                            "Mounts": [
                                {
                                    "Destination": "/etc/caddy/Caddyfile",
                                    "Type": "bind",
                                    "Source": str(caddy),
                                }
                            ]
                        }
                    ]
                    return SimpleNamespace(
                        stdout=json.dumps(data).encode(), returncode=0
                    )
                if "adapt" in args:
                    data = (
                        raw_config
                        if b"basic_auth" in caddy.read_bytes()
                        else installer.auth_removed(raw_config)[0]
                    )
                    return SimpleNamespace(
                        stdout=json.dumps(data).encode(), returncode=0
                    )
                if "reload" in args:
                    restoring = b"basic_auth" in caddy.read_bytes()
                    events.append("restore_outer_auth" if restoring else "cutover")
                    if restoring:
                        self.assertNotEqual(app.read_bytes(), original_app)
                        self.assertTrue(config.exists())
                        if rollback_fails:
                            return SimpleNamespace(stdout=b"", returncode=1)
                if "validate" in args and failure == "validate":
                    raise RuntimeError("injected_validation_failure")
                if "restart" in args and failure == "restart":
                    failure_once = events.count("restart") == 0
                    events.append("restart")
                    if failure_once:
                        raise RuntimeError("injected_restart_failure")
                return SimpleNamespace(stdout=b"active", returncode=0)

            def acceptance(base, password):
                self.assertEqual(password, "private-test-password")
                local = base.startswith("http://127")
                events.append("local_acceptance" if local else "public_acceptance")
                if local:
                    self.assertEqual(caddy.read_bytes(), original_caddy)
                if failure == ("local" if local else "public"):
                    raise RuntimeError("injected_acceptance_failure")

            for name, value in {
                "LIB_ROOT": root / "lib",
                "BACKUP_ROOT": root,
                "CONFIG": config,
                "DROPIN": dropin,
                "MODULE_HASH": hashlib.sha256(code).hexdigest(),
            }.items():
                stack.enter_context(patch.object(installer, name, value))
            stack.enter_context(patch.object(installer, "run", run))
            stack.enter_context(
                patch.object(installer, "http", return_value=(200, {}, b""))
            )
            stack.enter_context(patch.object(installer, "wait_local"))
            stack.enter_context(patch.object(installer, "acceptance", acceptance))
            stack.enter_context(patch.object(installer.os, "geteuid", return_value=0))
            stack.enter_context(patch.object(installer.os, "chown"))
            stack.enter_context(
                patch.object(installer.socket, "gethostname", return_value="srv2027143")
            )
            stack.enter_context(
                patch.object(
                    installer.pwd,
                    "getpwnam",
                    return_value=SimpleNamespace(pw_uid=0, pw_gid=0),
                )
            )
            stack.enter_context(
                patch.object(
                    installer.getpass, "getpass", return_value="private-test-password"
                )
            )
            stack.enter_context(
                patch.object(
                    installer,
                    "build_opener",
                    return_value=SimpleNamespace(open=lambda *a, **k: io.BytesIO(code)),
                )
            )
            # Path.open uses io.open, so this replaces only the /dev/tty prompt.
            stack.enter_context(patch("builtins.open", return_value=io.StringIO()))
            output = stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if failure:
                with self.assertRaises(RuntimeError):
                    installer.install("a" * 40)
            else:
                installer.install("a" * 40)
            self.assertNotIn("private-test-password", output.getvalue())
            if failure and not rollback_fails:
                self.assertEqual(app.read_bytes(), original_app)
                self.assertEqual(caddy.read_bytes(), original_caddy)
                self.assertFalse(config.exists())
                self.assertFalse(dropin.exists())
                self.assertFalse(module.exists())
            else:
                self.assertIn(b"install_dashboard_login(app)", app.read_bytes())
                self.assertTrue(config.exists())
                self.assertEqual(config.stat().st_mode & 0o777, 0o600)
            if not failure:
                self.assertEqual(
                    events, ["local_acceptance", "cutover", "public_acceptance"]
                )

    def test_success_preserves_cutover_order(self):
        self.exercise()

    def test_failures_restore_original_files(self):
        for failure in ("restart", "local", "validate", "public"):
            with self.subTest(failure=failure):
                self.exercise(failure)

    def test_outer_auth_restore_failure_keeps_new_gate(self):
        self.exercise("public", rollback_fails=True)


if __name__ == "__main__":
    unittest.main()
