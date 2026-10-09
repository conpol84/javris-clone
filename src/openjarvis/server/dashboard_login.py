"""Optional, host-scoped admin login. No API credential is sent to the browser."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import deque
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs

DOMAIN = "jarvis.firboai.app"
ORIGIN = "https://" + DOMAIN
COOKIE = "__Host-firbo_jarvis"
LOGIN = "/_firbo/login"
LOGOUT = "/_firbo/logout"
TTL = 8 * 3600
VERSION = "firbo-dashboard-login/1"

PAGE = """<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OpenJarvis · Sign in</title><style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;
padding:24px;background:#080e1a;color:#edf2fa;font:16px system-ui,sans-serif}
main{width:100%;max-width:440px;background:#111d2f;border:1px solid #29394e;
border-radius:20px;padding:36px}small{color:#73d6c3;letter-spacing:.14em}
h1{font-size:30px;letter-spacing:-.04em;margin:18px 0 8px}
p{color:#aebdd0;line-height:1.6}
label{display:block;margin:22px 0 8px}input,button{font:inherit;width:100%;padding:13px;
border-radius:9px}input{border:1px solid #40516b;background:#080e1a;color:#edf2fa}
input:focus,button:focus,a:focus{outline:3px solid #73d6c3;outline-offset:3px}
button{border:0;background:#73d6c3;color:#08241d;font-weight:700;
margin-top:26px;cursor:pointer}
a{color:#73d6c3}footer{margin-top:25px;color:#899bb3;font-size:13px;line-height:1.5}
.error{color:#ffc8bf;background:#43272c;padding:12px;border-radius:8px}
</style></head><body><main><small>FIRBO / OPENJARVIS</small>
<h1>Your server workspace</h1><p>Sign in to manage OpenJarvis on your server.</p>
__NOTICE____FORM__<footer>This administrator login is separate from your Firbo account.
<br><a href="https://firboai.app/">Back to Firbo</a></footer></main></body></html>"""
FORM = """<form method="post" action="/_firbo/login">
<label for="username">Username</label><input id="username" name="username"
autocomplete="username" required maxlength="64" autofocus>
<label for="password">Password</label><input id="password" name="password"
type="password" autocomplete="current-password" required maxlength="256">
<button type="submit">Sign in</button></form>"""
SIGNED_IN = """<p>You are signed in. <a href="/">Open dashboard</a></p>
<form method="post" action="/_firbo/logout">
<button type="submit">Sign out</button></form>"""


def password_digest(password: str, salt: bytes) -> bytes:
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32)


async def read_body(receive):
    body = b""
    while True:
        event = await receive()
        if event["type"] != "http.request":
            raise ValueError("request_disconnected")
        body += event.get("body", b"")
        if len(body) > 4096:
            raise OverflowError("request_too_large")
        if not event.get("more_body", False):
            return body


class DashboardLoginMiddleware:
    def __init__(self, app, *, settings: dict, api_key: str):
        self.app = app
        self.username = settings["username"]
        self.salt = bytes.fromhex(settings["salt"])
        self.digest = bytes.fromhex(settings["password_hash"])
        if not api_key or len(self.salt) != 32 or len(self.digest) != 32:
            raise ValueError("invalid_dashboard_login_configuration")
        if not isinstance(self.username, str) or not 1 <= len(self.username) <= 64:
            raise ValueError("invalid_dashboard_login_configuration")
        self.api_key = api_key.encode()
        self.sessions: dict[str, float] = {}
        self.attempts: deque[float] = deque()

    def session(self, headers: dict) -> str | None:
        # Duplicate cookie names are ambiguous and never authorize a request.
        raw = headers.get(b"cookie", b"").decode("latin1")
        if sum(p.strip().startswith(COOKIE + "=") for p in raw.split(";")) != 1:
            return None
        try:
            cookies = SimpleCookie(raw)
            token = cookies[COOKIE].value
        except Exception:
            return None
        if len(token) != 64:
            return None
        digest = hashlib.sha256(token.encode()).hexdigest()
        now = time.monotonic()
        self.sessions = {k: v for k, v in self.sessions.items() if v > now}
        return digest if digest in self.sessions else None

    async def reply(
        self, send, status, body=b"", *, cookie=None, location=None, html=False
    ):
        headers = [
            (
                b"content-type",
                b"text/html; charset=utf-8" if html else b"application/json",
            ),
            (b"cache-control", b"no-store"),
            (b"x-content-type-options", b"nosniff"),
            (b"referrer-policy", b"no-referrer"),
            (b"x-frame-options", b"DENY"),
            (
                b"content-security-policy",
                b"default-src 'none'; style-src 'unsafe-inline'; "
                b"form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            ),
            (b"content-length", str(len(body)).encode()),
        ]
        if cookie:
            headers.append((b"set-cookie", cookie.encode()))
        if location:
            headers.append((b"location", location.encode()))
        await send(
            {"type": "http.response.start", "status": status, "headers": headers}
        )
        await send({"type": "http.response.body", "body": body})

    async def page(self, send, *, status=200, error=False, signed_in=False):
        notice = (
            '<p class="error" role="alert">Incorrect username or password.</p>'
            if error
            else ""
        )
        body = PAGE.replace("__NOTICE__", notice).replace(
            "__FORM__", SIGNED_IN if signed_in else FORM
        )
        await self.reply(send, status, body.encode(), html=True)

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        pairs = [(k.lower(), v) for k, v in scope.get("headers", [])]
        hosts = [
            v.decode("latin1").lower().split(":")[0].rstrip(".")
            for k, v in pairs
            if k == b"host"
        ]
        if DOMAIN not in hosts:
            return await self.app(scope, receive, send)
        headers = dict(pairs)
        valid_headers = all(
            sum(k == key for k, _ in pairs) <= 1
            for key in (b"host", b"origin", b"cookie")
        )
        session = self.session(headers) if valid_headers else None
        origin = headers.get(b"origin", b"").decode("latin1")
        method = scope.get("method", "GET")
        path = scope.get("path", "/")

        if scope["type"] == "websocket":
            if not session or origin != ORIGIN:
                await send({"type": "websocket.close", "code": 1008})
                return
        else:
            if not valid_headers or (origin and origin != ORIGIN):
                return await self.reply(send, 403, b'{"error":"origin_denied"}')
            if method not in ("GET", "HEAD") and origin != ORIGIN:
                return await self.reply(send, 403, b'{"error":"origin_required"}')
            if path == LOGIN and method == "GET":
                return await self.page(send, signed_in=bool(session))
            if path == LOGIN and method == "POST":
                if (
                    headers.get(b"content-type", b"").split(b";")[0]
                    != b"application/x-www-form-urlencoded"
                ):
                    return await self.reply(send, 415)
                now = time.monotonic()
                while self.attempts and self.attempts[0] <= now - 300:
                    self.attempts.popleft()
                if len(self.attempts) >= 12:
                    return await self.reply(send, 429, b'{"error":"try_again_later"}')
                self.attempts.append(now)
                try:
                    body = await asyncio.wait_for(read_body(receive), timeout=5)
                    fields = parse_qs(
                        body.decode("utf-8"), strict_parsing=True, max_num_fields=2
                    )
                    if set(fields) != {"username", "password"} or any(
                        len(v) != 1 for v in fields.values()
                    ):
                        raise ValueError()
                    username, password = fields["username"][0], fields["password"][0]
                    if len(username) > 64 or len(password) > 256:
                        raise ValueError()
                except OverflowError:
                    return await self.reply(send, 413)
                except (ValueError, UnicodeError, asyncio.TimeoutError):
                    return await self.reply(send, 400)
                # A global attempt budget bounds CPU work; no username enumeration.
                actual = password_digest(password, self.salt)
                correct = hmac.compare_digest(actual, self.digest)
                correct &= hmac.compare_digest(
                    username.encode(), self.username.encode()
                )
                if not correct:
                    return await self.page(send, status=401, error=True)
                self.sessions = {k: v for k, v in self.sessions.items() if v > now}
                if len(self.sessions) >= 64:
                    return await self.reply(send, 429)
                token = secrets.token_hex(32)
                self.sessions[hashlib.sha256(token.encode()).hexdigest()] = now + TTL
                return await self.reply(
                    send,
                    303,
                    location="/",
                    cookie=(
                        f"{COOKIE}={token}; Path=/; Secure; HttpOnly; "
                        f"SameSite=Strict; Max-Age={TTL}"
                    ),
                )
            if path == LOGOUT and method == "POST":
                if session:
                    self.sessions.pop(session, None)
                return await self.reply(
                    send,
                    303,
                    location=LOGIN,
                    cookie=(
                        f"{COOKIE}=; Path=/; Secure; HttpOnly; "
                        "SameSite=Strict; Max-Age=0"
                    ),
                )
            if not session:
                if method in ("GET", "HEAD") and not path.startswith(("/api/", "/v1/")):
                    return await self.reply(send, 303, location=LOGIN)
                return await self.reply(send, 401, b'{"error":"sign_in_required"}')
            if path == "/_firbo/status":
                return await self.reply(
                    send, 200, json.dumps({"version": VERSION}).encode()
                )
            if path.startswith("/_firbo/"):
                return await self.reply(send, 404)

        # The key stays server-side. Client Authorization can never override it.
        forwarded = [(k, v) for k, v in pairs if k not in (b"authorization", b"cookie")]
        forwarded.append((b"authorization", b"Bearer " + self.api_key))
        await self.app({**scope, "headers": forwarded}, receive, send)


def install_dashboard_login(app):
    """Called last in create_app so authentication runs before existing API auth."""
    config = os.environ.get("FIRBO_DASHBOARD_LOGIN_CONFIG")
    if not config:
        return
    settings = json.loads(Path(config).read_text())
    api_key = getattr(app.state, "api_key", "") or os.environ.get(
        "OPENJARVIS_API_KEY", ""
    )
    # Fail at service startup, before exposing any request, on malformed configuration.
    DashboardLoginMiddleware(None, settings=settings, api_key=api_key)
    app.add_middleware(DashboardLoginMiddleware, settings=settings, api_key=api_key)
