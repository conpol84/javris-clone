"""Real HTTPS form navigation: do not fabricate the browser's Origin header."""

import asyncio
import importlib.util
import os
import pathlib
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "browser_login", ROOT / "src/openjarvis/server/dashboard_login.py"
)
login = importlib.util.module_from_spec(spec)
spec.loader.exec_module(login)


@unittest.skipUnless(os.environ.get("FIRBO_BROWSER_TEST"), "Chromium runs in CI")
class BrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        root = pathlib.Path(cls.temp.name)
        cert, key = root / "cert.pem", root / "key.pem"
        subprocess.run(
            [
                "openssl",
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-keyout",
                str(key),
                "-out",
                str(cert),
                "-days",
                "1",
                "-subj",
                "/CN=localhost",
            ],
            check=True,
            capture_output=True,
        )
        cls.old_policy = False
        cls.origins = []

        async def upstream(scope, receive, send):
            await send(
                {
                    "type": "http.response.start",
                    "status": 200,
                    "headers": [(b"content-type", b"text/html")],
                }
            )
            await send(
                {
                    "type": "http.response.body",
                    "body": b"<html><h1>Authenticated dashboard</h1></html>",
                }
            )

        salt = b"c" * 32
        cls.gate = login.DashboardLoginMiddleware(
            upstream,
            settings={
                "username": "admin",
                "salt": salt.hex(),
                "password_hash": login.password_digest(
                    "browser-test-password", salt
                ).hex(),
            },
            api_key="never-exposed-test-key",
        )

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                self.dispatch()

            def do_POST(self):
                cls.origins.append(self.headers.get("Origin"))
                self.dispatch()

            def dispatch(self):
                body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
                scope = {
                    "type": "http",
                    "method": self.command,
                    "path": self.path.split("?", 1)[0],
                    "headers": [
                        (k.lower().encode(), v.encode())
                        for k, v in self.headers.items()
                    ],
                }
                messages = []

                async def receive():
                    return {"type": "http.request", "body": body}

                async def send(message):
                    messages.append(message)

                asyncio.run(cls.gate(scope, receive, send))
                self.send_response(messages[0]["status"])
                for k, v in messages[0]["headers"]:
                    if cls.old_policy and k == b"referrer-policy":
                        v = b"no-referrer"
                    self.send_header(k.decode(), v.decode())
                self.end_headers()
                for message in messages[1:]:
                    self.wfile.write(message.get("body", b""))

        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        tls = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls.load_cert_chain(cert, key)
        cls.server.socket = tls.wrap_socket(cls.server.socket, server_side=True)
        cls.origin = f"https://127.0.0.1:{cls.server.server_port}"
        # Only the test fixture origin changes; the production allowlist is untouched.
        login.DOMAIN, login.ORIGIN = "127.0.0.1", cls.origin
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.temp.cleanup()

    def browser(self, width, legacy=False):
        from playwright.sync_api import sync_playwright

        type(self).old_policy = legacy
        with sync_playwright() as p:
            browser = p.chromium.launch()
            context = browser.new_context(
                ignore_https_errors=True, viewport={"width": width, "height": 850}
            )
            page = context.new_page()
            page.goto(self.origin + login.LOGIN)
            self.assertLessEqual(
                page.evaluate("document.documentElement.scrollWidth"), width
            )
            page.get_by_label("Username", exact=True).fill("admin")
            page.get_by_label("Password", exact=True).fill("browser-test-password")
            with page.expect_navigation():
                page.get_by_role("button", name="Sign in", exact=True).click()
            if legacy:
                self.assertEqual(self.origins[-1], "null")
                self.assertIn("origin_denied", page.locator("body").inner_text())
            else:
                self.assertEqual(self.origins[-1], self.origin)
                self.assertTrue(
                    page.get_by_role(
                        "heading", name="Authenticated dashboard"
                    ).is_visible()
                )
                self.assertNotIn("never-exposed-test-key", page.content())
                self.assertEqual(
                    context.request.get(self.origin + "/v1/info").status, 200
                )
                page.goto(self.origin + login.LOGIN)
                with page.expect_navigation():
                    page.get_by_role("button", name="Sign out", exact=True).click()
                self.assertTrue(page.get_by_label("Password", exact=True).is_visible())
                self.assertEqual(
                    context.request.get(self.origin + "/v1/info").status, 401
                )
            context.close()
            browser.close()

    def test_reproduces_original_origin_denied_in_real_browser(self):
        self.browser(1280, legacy=True)

    def test_fixed_native_form_login_and_logout_desktop_and_mobile(self):
        for width in (390, 1280):
            with self.subTest(width=width):
                self.browser(width)


if __name__ == "__main__":
    unittest.main()
