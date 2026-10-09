"""Offline tests for the deployed FIRBO egress acceptance receipt."""

from __future__ import annotations

import http.client
import importlib.util
import json
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from datetime import datetime, timezone
from email.message import Message
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "firbo_egress_acceptance", ROOT / "tools" / "firbo_egress_acceptance.py"
)
assert SPEC and SPEC.loader
acceptance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(acceptance)


class FakeSocket:
    def __init__(self, certificate: bytes):
        self.certificate = certificate

    def getpeercert(self, *, binary_form: bool):
        if not binary_form:
            raise AssertionError("binary certificate required")
        return self.certificate


class FakeResponse:
    def __init__(self, status: int, body: bytes, duplicate_length: bool = False):
        self.status = status
        self.body = body
        self.headers = Message()
        self.headers.add_header("Content-Type", "application/json")
        self.headers.add_header("Content-Length", str(len(body)))
        if duplicate_length:
            self.headers.add_header("Content-Length", str(len(body)))
        self.headers.add_header("Cache-Control", "no-store")

    def read(self, limit: int):
        return self.body[:limit]

    def close(self):
        pass


class FakeConnections:
    def __init__(self, *, success_status: int | None = None, duplicate=False):
        self.calls = []
        self.success_status = success_status
        self.duplicate = duplicate

    def __call__(self, host, port, *, timeout, context):
        test = self
        if port != 443 or timeout <= 0:
            raise AssertionError("bounded HTTPS/443 required")
        if context.verify_mode != ssl.CERT_REQUIRED or not context.check_hostname:
            raise AssertionError("default TLS verification required")

        class Connection:
            sock = FakeSocket(("certificate:" + host).encode())

            def request(self, method, path, *, body, headers):
                if method != "POST" or body != b"{}":
                    raise AssertionError("fixed malformed POST required")
                test.calls.append(
                    {
                        "host": host,
                        "path": path,
                        "authorization": headers.get("Authorization"),
                    }
                )
                self.path = path
                self.authorized = "Authorization" in headers

            def getresponse(self):
                if test.success_status is not None:
                    return FakeResponse(test.success_status, b"{}")
                if not self.authorized:
                    return FakeResponse(401, b'{"error":"unauthorized"}')
                if self.path == "/v1/mcp":
                    return FakeResponse(
                        502,
                        b'{"error":"egress_denied"}',
                        duplicate_length=test.duplicate,
                    )
                return FakeResponse(400, b'{"error":"bad_request"}')

            def close(self):
                pass

        return Connection()


class AcceptanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.release = Path(self.temporary.name) / "release.json"
        self.release.write_text(
            json.dumps(
                {
                    "schema": "firbo-egress-release/v1",
                    "mcp": {"public_url": "https://egress.firboai.app/v1/mcp"},
                    "page": {"public_url": "https://egress.firboai.app/v1/page"},
                }
            ),
            encoding="utf-8",
        )
        self.environment = {
            "FIRBO_MCP_EGRESS_TOKEN": "m" * 40,
            "FIRBO_PAGE_EGRESS_TOKEN": "p" * 40,
        }

    def test_receipt_proves_four_fixed_rejections_without_exposing_tokens(self):
        connections = FakeConnections()
        receipt = acceptance.acceptance_receipt(
            self.release,
            self.environment,
            now=datetime(2026, 10, 7, 10, 0, tzinfo=timezone.utc),
            connection_factory=connections,
        )
        self.assertEqual(receipt["schema"], "firbo-egress-acceptance/v1")
        self.assertEqual(receipt["checked_at"], "2026-10-07T10:00:00Z")
        self.assertFalse(receipt["contains_secrets"])
        self.assertFalse(receipt["upstream_dispatch_expected"])
        self.assertEqual(len(connections.calls), 4)
        self.assertEqual(
            [(call["path"], bool(call["authorization"])) for call in connections.calls],
            [
                ("/v1/mcp", False),
                ("/v1/mcp", True),
                ("/v1/page", False),
                ("/v1/page", True),
            ],
        )
        encoded = json.dumps(receipt)
        self.assertNotIn(self.environment["FIRBO_MCP_EGRESS_TOKEN"], encoded)
        self.assertNotIn(self.environment["FIRBO_PAGE_EGRESS_TOKEN"], encoded)
        for service in receipt["services"].values():
            for probe in (service["anonymous"], service["authenticated_malformed"]):
                self.assertEqual(probe["attempts"], 1)
                self.assertRegex(probe["tls_peer_sha256"], r"^[a-f0-9]{64}$")

    def test_invalid_routes_and_tokens_fail_before_network(self):
        base_config = json.loads(self.release.read_text(encoding="utf-8"))
        for changed in (
            {"mcp": {"public_url": "http://egress.firboai.app/v1/mcp"}},
            {"page": {"public_url": "https://127.0.0.1/v1/page"}},
            {"page": {"public_url": "https://egress.firboai.app/other"}},
        ):
            config = json.loads(json.dumps(base_config))
            config.update(changed)
            self.release.write_text(json.dumps(config), encoding="utf-8")
            connections = FakeConnections()
            with self.assertRaisesRegex(
                acceptance.AcceptanceError, "release_route_invalid"
            ):
                acceptance.acceptance_receipt(
                    self.release,
                    self.environment,
                    connection_factory=connections,
                )
            self.assertEqual(connections.calls, [])
        self.release.write_text(json.dumps(base_config), encoding="utf-8")

        with self.assertRaisesRegex(
            acceptance.AcceptanceError, "dedicated_tokens_required"
        ):
            acceptance.acceptance_receipt(
                self.release,
                {
                    **self.environment,
                    "FIRBO_PAGE_EGRESS_TOKEN": self.environment[
                        "FIRBO_MCP_EGRESS_TOKEN"
                    ],
                },
                connection_factory=FakeConnections(),
            )

    def test_unexpected_success_and_ambiguous_framing_fail_closed(self):
        with self.assertRaisesRegex(
            acceptance.AcceptanceError, "deployed_response_mismatch"
        ):
            acceptance.acceptance_receipt(
                self.release,
                self.environment,
                connection_factory=FakeConnections(success_status=200),
            )
        with self.assertRaisesRegex(
            acceptance.AcceptanceError, "response_contract_invalid"
        ):
            acceptance.acceptance_receipt(
                self.release,
                self.environment,
                connection_factory=FakeConnections(duplicate=True),
            )

    def test_absolute_watchdog_closes_a_stalled_request(self):
        closed = threading.Event()

        def factory(_host, _port, *, timeout, context):
            self.assertTrue(context.check_hostname)
            self.assertGreater(timeout, 0)

            class Connection:
                sock = None

                def request(self, _method, _path, *, body, headers):
                    self.assertEqual(body, b"{}")
                    self.assertNotIn("Authorization", headers)
                    if not closed.wait(1):
                        raise AssertionError("watchdog did not close stalled request")
                    raise OSError("closed")

                def close(self):
                    closed.set()

            connection = Connection()
            connection.assertEqual = self.assertEqual
            connection.assertNotIn = self.assertNotIn
            return connection

        with self.assertRaisesRegex(
            acceptance.AcceptanceError, "acceptance_deadline_exceeded"
        ):
            acceptance._post(
                "https://egress.firboai.app/v1/mcp",
                None,
                0.01,
                factory,
            )

    def test_delayed_watchdog_cannot_admit_a_late_response(self):
        clock = [0.0]

        class DelayedTimer:
            def __init__(self, *_args):
                pass

            def start(self):
                pass

            def cancel(self):
                pass

            def join(self):
                pass

        class Connection:
            sock = FakeSocket(b"synthetic-certificate")

            def request(self, *_args, **_kwargs):
                pass

            def getresponse(self):
                response = FakeResponse(401, b'{"error":"unauthorized"}')
                original_read = response.read

                def read(limit):
                    clock[0] = 2.0
                    return original_read(limit)

                response.read = read
                return response

            def close(self):
                pass

        with (
            patch.object(acceptance.threading, "Timer", DelayedTimer),
            patch.object(acceptance.time, "monotonic", side_effect=lambda: clock[0]),
            self.assertRaisesRegex(
                acceptance.AcceptanceError, "acceptance_deadline_exceeded"
            ),
        ):
            acceptance._post(
                "https://egress.firboai.app/v1/mcp",
                None,
                1.0,
                lambda *_args, **_kwargs: Connection(),
            )

    def test_invalid_total_duration_cannot_publish_a_four_probe_receipt(self):
        clock = [0.0]
        original_post = acceptance._post

        def late_post(*args, **kwargs):
            result = original_post(*args, **kwargs)
            clock[0] += 8.0
            return result

        connections = FakeConnections()
        with (
            patch.object(acceptance, "_post", side_effect=late_post),
            self.assertRaisesRegex(
                acceptance.AcceptanceError, "acceptance_deadline_exceeded"
            ),
        ):
            acceptance.acceptance_receipt(
                self.release,
                self.environment,
                monotonic=lambda: clock[0],
                connection_factory=connections,
            )
        self.assertEqual(len(connections.calls), 4)


class LocalTLSDeadlineTests(unittest.TestCase):
    """Real socket reads must respect the receipt probe's overall deadline."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        cert = Path(self.temporary.name) / "cert.pem"
        key = Path(self.temporary.name) / "key.pem"
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
                "/CN=egress.firboai.app",
                "-addext",
                "subjectAltName=DNS:egress.firboai.app",
            ],
            check=True,
            capture_output=True,
        )
        self.client_context = ssl.create_default_context(cafile=str(cert))
        self.stopped = threading.Event()
        self.mode = "body"
        self.requests = []
        self.detached = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                outer.requests.append((self.path, body))
                try:
                    self.wfile.write(b"HTTP/1.1 401 Unauthorized\r\n")
                    if outer.mode == "headers":
                        for _ in range(15):
                            self.wfile.write(b"X-Synthetic: drip\r\n")
                            self.wfile.flush()
                            if outer.stopped.wait(0.025):
                                return
                    payload = b'{"error":"unauthorized"}'
                    self.wfile.write(
                        b"Content-Type: application/json\r\nCache-Control: no-store\r\n"
                        b"Connection: close\r\nContent-Length: "
                        + str(len(payload)).encode()
                        + b"\r\n\r\n"
                    )
                    for character in payload:
                        self.wfile.write(bytes([character]))
                        self.wfile.flush()
                        if outer.mode == "body" and outer.stopped.wait(0.025):
                            return
                except OSError:
                    pass
                finally:
                    self.close_connection = True

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close_server)

    def close_server(self):
        self.stopped.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def factory(self, host, port, *, timeout, context):
        self.assertEqual(host, "egress.firboai.app")
        self.assertEqual(port, 443)
        self.assertTrue(context.check_hostname)
        outer = self

        class Connection(http.client.HTTPSConnection):
            def connect(self):
                raw = socket.create_connection(
                    outer.server.server_address, self.timeout
                )
                self.sock = outer.client_context.wrap_socket(
                    raw, server_hostname=self.host
                )

            def getresponse(self):
                response = super().getresponse()
                outer.detached.append(self.sock is None)
                return response

        return Connection(host, timeout=timeout)

    def test_real_tls_body_drip_is_interrupted_after_connection_handoff(self):
        started = time.monotonic()
        with self.assertRaisesRegex(
            acceptance.AcceptanceError, "acceptance_deadline_exceeded"
        ):
            acceptance._post(
                "https://egress.firboai.app/v1/mcp", None, 0.15, self.factory
            )
        self.assertLess(time.monotonic() - started, 0.40)
        self.assertEqual(self.detached, [True])
        self.assertEqual(self.requests, [("/v1/mcp", b"{}")])

    def test_real_tls_header_drip_is_interrupted(self):
        self.mode = "headers"
        started = time.monotonic()
        with self.assertRaisesRegex(
            acceptance.AcceptanceError, "acceptance_deadline_exceeded"
        ):
            acceptance._post(
                "https://egress.firboai.app/v1/page", None, 0.15, self.factory
            )
        self.assertLess(time.monotonic() - started, 0.35)
        self.assertEqual(self.requests, [("/v1/page", b"{}")])

    def test_real_tls_valid_response_keeps_exact_receipt(self):
        self.mode = "fast"
        result = acceptance._post(
            "https://egress.firboai.app/v1/mcp", None, 2, self.factory
        )
        acceptance._expected(result, 401, b'{"error":"unauthorized"}')
        self.assertEqual(result["attempts"], 1)
        self.assertEqual(self.detached, [True])


if __name__ == "__main__":
    unittest.main()
