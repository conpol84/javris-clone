"""Password recovery with actual middleware login, file replacement and rollback."""

import contextlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from starlette.testclient import TestClient

ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reset = load("reset", "deploy/hostinger/reset-dashboard-password.py")
login = load("login_reset", "src/openjarvis/server/dashboard_login.py")


class ResetTests(unittest.TestCase):
    def exercise(self, failure=False):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            path = root / "login.json"
            salt = b"a" * 32
            original = json.dumps(
                {
                    "username": "admin",
                    "salt": salt.hex(),
                    "password_hash": login.password_digest("old-password", salt).hex(),
                    "preserved": True,
                }
            ).encode()
            path.write_bytes(original)
            path.chmod(0o600)
            clients = []

            def restart():
                app = FastAPI()
                app.get("/")(lambda: HTMLResponse("<html>Dashboard</html>"))
                app.get("/v1/info")(lambda: {"ok": True})
                app.add_middleware(
                    login.DashboardLoginMiddleware,
                    settings=json.loads(path.read_bytes()),
                    api_key="test-key",
                )
                clients.append(
                    TestClient(app, base_url=login.ORIGIN, follow_redirects=False)
                )

            def http(base, route, *, data=None, cookie=None):
                if failure and base == reset.ORIGIN:
                    raise RuntimeError("public_probe_failed")
                client = clients[-1]
                client.cookies.clear()
                headers = {"Origin": login.ORIGIN}
                if cookie:
                    headers["Cookie"] = cookie
                if data is not None:
                    headers["Content-Type"] = "application/x-www-form-urlencoded"
                response = client.request(
                    "GET" if data is None else "POST",
                    route,
                    content=data,
                    headers=headers,
                )
                return response.status_code, response.headers, response.content

            output = io.StringIO()
            password = "Νέος κωδικός & + = 123"
            with (
                patch.object(reset, "restart", restart),
                patch.object(reset, "http", http),
                contextlib.redirect_stdout(output),
            ):
                if failure:
                    with self.assertRaisesRegex(RuntimeError, "public_probe_failed"):
                        reset.reset_password(path, root, password)
                    self.assertEqual(path.read_bytes(), original)
                    self.assertEqual(len(clients), 2)
                else:
                    reset.reset_password(path, root, password)
                    self.assertTrue(json.loads(path.read_bytes())["preserved"])
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                    self.assertNotEqual(path.read_bytes(), original)
                    self.assertNotIn(password.encode(), path.read_bytes())
                    self.assertEqual(
                        clients[-1]
                        .post(
                            login.LOGIN,
                            data={"username": "admin", "password": "old-password"},
                            headers={"Origin": login.ORIGIN},
                        )
                        .status_code,
                        401,
                    )
                    self.assertIn(
                        "PASSWORD_RESET_AND_LOGIN_VERIFIED", output.getvalue()
                    )
            self.assertNotIn(password, output.getvalue())
            backups = list(root.glob("firbo-password-*/login.json"))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_bytes(), original)
            self.assertEqual(backups[0].stat().st_mode & 0o777, 0o600)

    def test_real_login_with_new_unicode_password_old_denied(self):
        self.exercise()

    def test_public_failure_restores_original_password(self):
        self.exercise(failure=True)

    def test_short_password_and_link_refused_before_restart(self):
        with (
            tempfile.TemporaryDirectory() as folder,
            patch.object(reset, "restart") as restart,
        ):
            path = pathlib.Path(folder) / "config"
            path.symlink_to("/nonexistent")
            for password in ("short", "long-enough-password"):
                with self.assertRaises(RuntimeError):
                    reset.reset_password(path, pathlib.Path(folder), password)
            restart.assert_not_called()
