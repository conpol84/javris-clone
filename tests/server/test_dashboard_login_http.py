"""Real Starlette/FastAPI middleware ordering and WebSocket integration."""

import importlib.util
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

from fastapi import FastAPI, Request, WebSocket
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "dashboard_login", ROOT / "src/openjarvis/server/dashboard_login.py"
)
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)


class ExistingApiAuth(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        if (
            request.url.path.startswith("/v1/")
            and request.headers.get("authorization") != "Bearer private-test-key"
        ):
            return JSONResponse({"error": "api_key_required"}, status_code=401)
        return await call_next(request)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.app = FastAPI()
        self.app.state.api_key = "private-test-key"
        self.app.add_middleware(ExistingApiAuth)

        @self.app.get("/")
        async def home():
            return {"dashboard": "available"}

        @self.app.get("/v1/info")
        async def info(request: Request):
            return {
                "authenticated": request.headers.get("authorization")
                == "Bearer private-test-key"
            }

        @self.app.websocket("/v1/chat/stream")
        async def socket(ws: WebSocket):
            if ws.headers.get("authorization") != "Bearer private-test-key":
                await ws.close(code=1008)
                return
            await ws.accept()
            await ws.send_text("authenticated")
            try:
                while True:
                    await ws.receive_text()
                    await ws.send_text("still_authenticated")
            except WebSocketDisconnect:
                return

        salt = b"b" * 32
        self.app.add_middleware(
            login.DashboardLoginMiddleware,
            settings={
                "username": "admin",
                "salt": salt.hex(),
                "password_hash": login.password_digest("correct-password", salt).hex(),
            },
            api_key=self.app.state.api_key,
        )
        self.client = TestClient(
            self.app, base_url=login.ORIGIN, follow_redirects=False
        )

    def test_real_form_cookie_api_websocket_logout(self):
        with self.client as client:
            self.assertEqual(client.get("/").status_code, 303)
            self.assertEqual(client.get(login.LOGIN).status_code, 200)
            self.assertEqual(client.get("/v1/info").status_code, 401)
            response = client.post(
                login.LOGIN,
                data={"username": "admin", "password": "correct-password"},
                headers={"Origin": login.ORIGIN},
            )
            self.assertEqual(response.status_code, 303)
            self.assertEqual(client.get("/v1/info").json(), {"authenticated": True})
            with client.websocket_connect(
                "wss://jarvis.firboai.app/v1/chat/stream",
                headers={"Origin": login.ORIGIN},
            ) as ws:
                self.assertEqual(ws.receive_text(), "authenticated")
                self.assertEqual(
                    client.post(
                        login.LOGOUT, headers={"Origin": login.ORIGIN}
                    ).status_code,
                    303,
                )
                ws.send_text("must_not_run_after_logout")
                with self.assertRaises(WebSocketDisconnect):
                    ws.receive_text()
            self.assertEqual(
                client.post(login.LOGOUT, headers={"Origin": login.ORIGIN}).status_code,
                303,
            )
            self.assertEqual(client.get("/v1/info").status_code, 401)

    def test_other_host_still_requires_its_existing_api_key(self):
        with self.client as client:
            self.assertEqual(
                client.get("/v1/info", headers={"Host": "api.firboai.app"}).status_code,
                401,
            )
            self.assertEqual(
                client.get(
                    "/v1/info",
                    headers={
                        "Host": "api.firboai.app",
                        "Authorization": "Bearer private-test-key",
                    },
                ).status_code,
                200,
            )

    def test_disabled_hook_and_invalid_configuration(self):
        with patch.dict(os.environ, {}, clear=True):
            app = FastAPI()
            login.install_dashboard_login(app)
            self.assertEqual(app.user_middleware, [])
        with tempfile.NamedTemporaryFile(mode="w") as config:
            config.write("{}")
            config.flush()
            with patch.dict(os.environ, {"FIRBO_DASHBOARD_LOGIN_CONFIG": config.name}):
                with self.assertRaises((KeyError, ValueError)):
                    login.install_dashboard_login(FastAPI())


if __name__ == "__main__":
    unittest.main()
