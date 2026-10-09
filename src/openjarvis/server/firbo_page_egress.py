"""Private page-egress service; expose only through authenticated HTTPS ingress."""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Mapping

from openjarvis.security.page_egress import PageEgressDenied, forward_page

MAX_ENVELOPE = 4_096
MAX_HEADERS = 16_000
INGRESS_TIMEOUT = 5.0
PRIVATE_BIND_NETWORKS = tuple(
    ipaddress.ip_network(value)
    for value in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")
)


def _valid_token(token: str) -> bool:
    return (
        len(token) >= 32
        and token.isascii()
        and all(32 < ord(character) < 127 for character in token)
    )


def service_configuration(environment: Mapping[str, str]) -> tuple[str, str, int]:
    token = environment.get("FIRBO_PAGE_EGRESS_TOKEN", "")
    if not _valid_token(token):
        raise ValueError("page_egress_configuration_required")
    raw_bind = environment.get("FIRBO_PAGE_EGRESS_BIND", "127.0.0.1")
    try:
        bind = ipaddress.ip_address(raw_bind)
    except ValueError as exc:
        raise ValueError("page_egress_configuration_required") from exc
    if not isinstance(bind, ipaddress.IPv4Address) or not (
        bind.is_loopback or any(bind in network for network in PRIVATE_BIND_NETWORKS)
    ):
        raise ValueError("page_egress_configuration_required")
    raw_port = environment.get("FIRBO_PAGE_EGRESS_PORT", "8094")
    if not raw_port.isascii() or not raw_port.isdecimal():
        raise ValueError("page_egress_configuration_required")
    port = int(raw_port)
    if not 1024 <= port <= 65535:
        raise ValueError("page_egress_configuration_required")
    return token, str(bind), port


def make_handler(token: str):
    if not _valid_token(token):
        raise ValueError("page_egress_configuration_required")

    class Handler(BaseHTTPRequestHandler):
        server_version = "FirboPageEgress/1"

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

            self._ingress_timer = threading.Timer(INGRESS_TIMEOUT, expire)
            self._ingress_timer.daemon = True
            self._ingress_timer.start()
            try:
                super().handle()
            except OSError:
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
            total = len(self.raw_requestline) + sum(
                len(name) + len(value) + 4 for name, value in self.headers.items()
            )
            if total > MAX_HEADERS:
                self.reply(431, b'{"error":"headers_too_large"}', "application/json")
                return False
            return True

        def reply(self, status: int, body: bytes, content_type: str):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)
            self.close_connection = True

        def do_POST(self):
            if self.path != "/v1/page":
                return self.reply(404, b'{"error":"not_found"}', "application/json")
            auth_values = self.headers.get_all("Authorization") or []
            if (
                len(auth_values) != 1
                or not auth_values[0].isascii()
                or not hmac.compare_digest(auth_values[0], "Bearer " + token)
            ):
                return self.reply(401, b'{"error":"unauthorized"}', "application/json")
            lengths = self.headers.get_all("Content-Length") or []
            if (
                self.headers.get("Transfer-Encoding")
                or len(lengths) != 1
                or not re_full_decimal(lengths[0])
            ):
                return self.reply(400, b'{"error":"bad_request"}', "application/json")
            length = int(lengths[0])
            if not 0 < length <= MAX_ENVELOPE:
                return self.reply(
                    413, b'{"error":"request_too_large"}', "application/json"
                )
            try:
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError("bad_request")
                envelope = json.loads(raw)
                if (
                    not isinstance(envelope, dict)
                    or set(envelope) != {"url"}
                    or not isinstance(envelope["url"], str)
                ):
                    raise ValueError("bad_request")
            except (ValueError, TimeoutError):
                return self.reply(400, b'{"error":"bad_request"}', "application/json")
            self.stop_ingress()
            if (
                self._ingress_expired.is_set()
                or time.monotonic() >= self._ingress_deadline
            ):
                self.close_connection = True
                return
            try:
                status, content_type, body = forward_page(envelope["url"])
            except PageEgressDenied:
                return self.reply(502, b'{"error":"egress_denied"}', "application/json")
            except Exception:
                return self.reply(
                    502, b'{"error":"upstream_unavailable"}', "application/json"
                )
            return self.reply(status, body, content_type)

    return Handler


def re_full_decimal(value: str) -> bool:
    return 1 <= len(value) <= 4 and value.isascii() and value.isdecimal()


def main(argv: list[str] | None = None):
    args = sys.argv[1:] if argv is None else argv
    try:
        token, bind, port = service_configuration(os.environ)
    except ValueError:
        raise SystemExit("page_egress_configuration_required") from None
    if args == ["--check-config"]:
        address = ipaddress.ip_address(bind)
        print(
            json.dumps(
                {
                    "contract": "firbo-page-egress-config/v1",
                    "configuration_valid": True,
                    "bind_scope": "loopback" if address.is_loopback else "private",
                    "bind_address": bind,
                    "port": port,
                    "contains_secrets": False,
                    "listener_started": False,
                },
                separators=(",", ":"),
            )
        )
        return
    if args:
        raise SystemExit("usage: firbo_page_egress [--check-config]")
    HTTPServer((bind, port), make_handler(token)).serve_forever()


if __name__ == "__main__":
    main()
