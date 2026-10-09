"""Exercise the ASGI boundary, including browser/API/WebSocket credentials."""

import importlib.util
import json
import pathlib
import unittest
from urllib.parse import urlencode

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "dashboard_login", ROOT / "src/openjarvis/server/dashboard_login.py"
)
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)


class LoginTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        salt = b"a" * 32
        self.seen = []

        async def upstream(scope, receive, send):
            self.seen.append(scope)
            if scope["type"] == "websocket":
                await send({"type": "websocket.accept"})
            else:
                await send(
                    {"type": "http.response.start", "status": 200, "headers": []}
                )
                await send({"type": "http.response.body", "body": b"upstream"})

        self.gate = login.DashboardLoginMiddleware(
            upstream,
            settings={
                "username": "admin",
                "salt": salt.hex(),
                "password_hash": login.password_digest("correct-password", salt).hex(),
            },
            api_key="server-only-api-key",
        )

    async def request(
        self, path="/", method="GET", headers=(), body=b"", host=login.DOMAIN, ws=False
    ):
        scope = {
            "type": "websocket" if ws else "http",
            "path": path,
            "method": method,
            "headers": [(b"host", host.encode()), *headers],
        }
        sent = []

        async def receive():
            return {"type": "http.request", "body": body, "more_body": False}

        async def send(message):
            sent.append(message)

        await self.gate(scope, receive, send)
        return sent

    async def sign_in(self, password="correct-password"):
        result = await self.request(
            login.LOGIN,
            "POST",
            [
                (b"origin", login.ORIGIN.encode()),
                (b"content-type", b"application/x-www-form-urlencoded"),
            ],
            urlencode({"username": "admin", "password": password}).encode(),
        )
        return result

    async def cookie(self):
        result = await self.sign_in()
        self.assertEqual(result[0]["status"], 303)
        value = dict(result[0]["headers"])[b"set-cookie"]
        for flag in (b"Secure", b"HttpOnly", b"SameSite=Strict", b"Path=/"):
            self.assertIn(flag, value)
        return value.split(b";")[0]

    async def test_login_page_is_public_but_dashboard_and_api_are_not(self):
        self.assertEqual((await self.request())[0]["status"], 303)
        page = await self.request(login.LOGIN)
        self.assertEqual(page[0]["status"], 200)
        self.assertIn(b'type="password"', page[1]["body"])
        self.assertNotIn(b"server-only-api-key", page[1]["body"])
        for path in ("/api/status", "/v1/info"):
            result = await self.request(
                path, headers=[(b"authorization", b"Bearer server-only-api-key")]
            )
            self.assertEqual(result[0]["status"], 401)
            self.assertNotIn(b"www-authenticate", dict(result[0]["headers"]))
        self.assertEqual(self.seen, [])

    async def test_password_and_cookie_authentication_no_browser_key(self):
        self.assertEqual((await self.sign_in("wrong-password"))[0]["status"], 401)
        cookie = await self.cookie()
        result = await self.request(
            "/v1/info",
            headers=[(b"cookie", cookie), (b"authorization", b"Basic stale")],
        )
        self.assertEqual(result[0]["status"], 200)
        headers = dict(self.seen[-1]["headers"])
        self.assertEqual(headers[b"authorization"], b"Bearer server-only-api-key")
        self.assertNotIn(b"cookie", headers)
        self.assertNotIn(b"server-only-api-key", repr(result).encode())

    async def test_logout_and_expiry_invalidate_cookie(self):
        cookie = await self.cookie()
        await self.request(
            login.LOGOUT,
            "POST",
            [(b"cookie", cookie), (b"origin", login.ORIGIN.encode())],
        )
        self.assertEqual(
            (await self.request("/v1/info", headers=[(b"cookie", cookie)]))[0][
                "status"
            ],
            401,
        )
        cookie = await self.cookie()
        for key in self.gate.sessions:
            self.gate.sessions[key] = 0
        self.assertEqual(
            (await self.request("/v1/info", headers=[(b"cookie", cookie)]))[0][
                "status"
            ],
            401,
        )

    async def test_csrf_duplicate_cookie_and_forgery(self):
        cookie = await self.cookie()
        for origin in (None, b"https://evil.example", b"null"):
            headers = [(b"cookie", cookie)] + ([(b"origin", origin)] if origin else [])
            self.assertEqual(
                (await self.request("/v1/chat/completions", "POST", headers))[0][
                    "status"
                ],
                403,
            )
        for bad in (
            cookie + b"0",
            cookie + b"; " + cookie,
            login.COOKIE.encode() + b"=forged",
        ):
            self.assertEqual(
                (await self.request("/v1/info", headers=[(b"cookie", bad)]))[0][
                    "status"
                ],
                401,
            )
        self.assertEqual(
            (
                await self.request(
                    "/v1/info", headers=[(b"cookie", cookie), (b"cookie", cookie)]
                )
            )[0]["status"],
            403,
        )

    async def test_websocket_requires_session_and_same_origin(self):
        cookie = await self.cookie()
        for headers in (
            [],
            [(b"cookie", cookie)],
            [(b"cookie", cookie), (b"origin", b"https://evil.example")],
        ):
            self.assertEqual(
                (await self.request("/v1/chat/stream", headers=headers, ws=True))[0][
                    "type"
                ],
                "websocket.close",
            )
        result = await self.request(
            "/v1/chat/stream",
            headers=[(b"cookie", cookie), (b"origin", login.ORIGIN.encode())],
            ws=True,
        )
        self.assertEqual(result[0]["type"], "websocket.accept")
        self.assertEqual(
            dict(self.seen[-1]["headers"])[b"authorization"],
            b"Bearer server-only-api-key",
        )

    async def test_other_hosts_preserve_existing_api_auth_and_box(self):
        headers = [(b"authorization", b"Bearer existing-token")]
        for host in ("api.firboai.app", "127.0.0.1:8765", "other.example"):
            await self.request("/v1/info", headers=headers, host=host)
            self.assertEqual(
                dict(self.seen[-1]["headers"])[b"authorization"],
                b"Bearer existing-token",
            )

    async def test_bounded_login_input_and_rate(self):
        headers = [
            (b"origin", login.ORIGIN.encode()),
            (b"content-type", b"application/x-www-form-urlencoded"),
        ]
        self.assertEqual(
            (await self.request(login.LOGIN, "POST", headers, b"x" * 4097))[0][
                "status"
            ],
            413,
        )
        self.assertEqual(
            (
                await self.request(
                    login.LOGIN, "POST", headers, b"username=a&username=b&password=c"
                )
            )[0]["status"],
            400,
        )
        for _ in range(10):
            await self.sign_in("wrong")
        self.assertEqual((await self.sign_in())[0]["status"], 429)

    async def test_status_never_returns_key_or_session(self):
        cookie = await self.cookie()
        response = await self.request("/_firbo/status", headers=[(b"cookie", cookie)])
        self.assertEqual(json.loads(response[1]["body"]), {"version": login.VERSION})


if __name__ == "__main__":
    unittest.main()
