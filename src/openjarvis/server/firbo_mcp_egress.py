"""Private MCP egress service; deploy only behind authenticated HTTPS ingress.

One bounded request at a time. No target, credential or body logging. Startup
requires a dedicated service token and explicit public origin allowlist.
"""

from __future__ import annotations

import hmac
import json
import os
import socket
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from openjarvis.security.mcp_egress import EgressDenied, forward_mcp, target_url

MAX_ENVELOPE = 128_000
INGRESS_TIMEOUT = 5.0
MAX_HEADERS = 16_000


def make_handler(token: str, origins: frozenset[str]):
    if (
        len(token) < 32
        or not token.isascii()
        or any(ord(c) <= 32 or ord(c) == 127 for c in token)
        or not origins
    ):
        raise ValueError("egress_configuration_required")
    for origin in origins:
        host, path = target_url(origin, origins)
        if origin != f"https://{host}" or path != "/":
            raise ValueError("egress_configuration_required")

    class Handler(BaseHTTPRequestHandler):
        server_version = "FirboMcpEgress/1"

        def log_message(self, _format, *_args):
            pass

        def handle(self):
            self.connection.settimeout(INGRESS_TIMEOUT)
            self._ingress_deadline = time.monotonic() + INGRESS_TIMEOUT
            self._ingress_expired = threading.Event()

            def expire():
                self._ingress_expired.set()
                try:
                    self.connection.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            # A socket inactivity timeout is reset by each incoming byte.
            # One watchdog bounds the entire request line + headers + body.
            self._ingress_timer = threading.Timer(INGRESS_TIMEOUT, expire)
            self._ingress_timer.daemon = True
            self._ingress_timer.start()
            try:
                super().handle()
            except OSError:
                # An expired/disconnected client cannot receive an error body.
                # Avoid HTTPServer traceback logs containing request details.
                self.close_connection = True
            finally:
                self.stop_ingress()

        def stop_ingress(self):
            timer = self._ingress_timer
            if timer is not None:
                timer.cancel()
                timer.join()
                self._ingress_timer = None

        def parse_request(self):
            if not super().parse_request():
                return False
            if (
                len(self.raw_requestline)
                + sum(
                    len(name) + len(value) + 4 for name, value in self.headers.items()
                )
                > MAX_HEADERS
            ):
                self.reply(431, {"error": "headers_too_large"})
                return False
            return True

        def reply(self, status, value):
            raw = json.dumps(value, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(raw)
            self.close_connection = True

        def do_POST(self):
            if self.path != "/v1/mcp":
                return self.reply(404, {"error": "not_found"})
            auth_values = self.headers.get_all("Authorization") or []
            if (
                len(auth_values) != 1
                or not auth_values[0].isascii()
                or not hmac.compare_digest(auth_values[0], "Bearer " + token)
            ):
                return self.reply(401, {"error": "unauthorized"})
            lengths = self.headers.get_all("Content-Length") or []
            if (
                self.headers.get("Transfer-Encoding")
                or len(lengths) != 1
                or not 1 <= len(lengths[0]) <= 6
                or not lengths[0].isascii()
                or not lengths[0].isdecimal()
            ):
                return self.reply(400, {"error": "bad_request"})
            length = int(lengths[0])
            if not 0 < length <= MAX_ENVELOPE:
                return self.reply(413, {"error": "request_too_large"})
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("bad_request")
                envelope = json.loads(raw)
            except (ValueError, TimeoutError):
                return self.reply(400, {"error": "bad_request"})
            self.stop_ingress()
            if (
                self._ingress_expired.is_set()
                or time.monotonic() >= self._ingress_deadline
            ):
                self.close_connection = True
                return
            try:
                status, headers, body = forward_mcp(envelope, origins)
            except EgressDenied:
                return self.reply(502, {"error": "egress_denied"})
            except Exception:
                return self.reply(502, {"error": "upstream_unavailable"})
            # Raw bounded bytes preserve JSON/SSE semantics; never an envelope.
            self.send_response(status)
            for name, value in headers.items():
                self.send_header(name, value)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

    return Handler


def main():
    origins = frozenset(
        x.strip()
        for x in os.environ.get("FIRBO_MCP_EGRESS_ALLOWED_ORIGINS", "").split(",")
        if x.strip()
    )
    handler = make_handler(os.environ.get("FIRBO_MCP_EGRESS_TOKEN", ""), origins)
    HTTPServer(
        ("127.0.0.1", int(os.environ.get("FIRBO_MCP_EGRESS_PORT", "8093"))), handler
    ).serve_forever()


if __name__ == "__main__":
    main()
