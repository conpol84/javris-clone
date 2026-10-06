"""Offline SSRF and real local TLS tests; all addresses/credentials synthetic."""

from __future__ import annotations

import http.client
import json
import socket
import ssl
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

from openjarvis.security import mcp_egress as egress
from openjarvis.server import firbo_mcp_egress as service

ORIGINS = frozenset({"https://mcp.example.com"})
TOKEN = "synthetic-service-token-32-characters"


def envelope():
    return {
        "url": "https://mcp.example.com/mcp",
        "headers": {"authorization": "Bearer synthetic-provider-token"},
        "body": json.dumps(
            {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
        ),
    }


def answer(ip="93.184.216.34"):
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    return family, socket.SOCK_STREAM, 6, "", (ip, 443)


class PolicyTests(unittest.TestCase):
    def test_nonpublic_and_transition_addresses(self):
        for ip in [
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.100.100.200",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "198.18.0.1",
            "192.0.0.9",
            "192.88.99.1",
            "::1",
            "fc00::1",
            "fe80::1",
            "::ffff:93.184.216.34",
            "2002:5db8:d822::",
            "2001:db8::1",
            "3fff::1",
            "invalid",
        ]:
            with self.subTest(ip=ip):
                self.assertFalse(egress.public_ip(ip))
        for ip in ["93.184.216.34", "2606:4700:4700::1111"]:
            self.assertTrue(egress.public_ip(ip))

    def test_bad_targets_stop_before_dns(self):
        for url in [
            "http://mcp.example.com/mcp",
            "https://127.1/",
            "https://2130706433/",
            "https://0x7f000001/",
            "https://[::1]/",
            "https://u:p@mcp.example.com/",
            "https://mcp.example.com:8443/",
            "https://mcp.example.com/#x",
            "https://mcp.example.com\\@evil.com/",
            "https://mcp.example.com/\r\nx",
            "https://a.internal/",
            "https://unapproved.example.com/",
            "https://a..com/",
            "https://-a.example.com/",
        ]:
            with self.subTest(url=url), patch.object(egress, "resolve_public") as dns:
                request = envelope()
                request["url"] = url
                with self.assertRaises(egress.EgressDenied):
                    egress.forward_mcp(request, ORIGINS)
                dns.assert_not_called()

    def test_mixed_dns_answers_are_denied_before_socket(self):
        for rows in [
            [answer(), answer("127.0.0.1")],
            [answer("::1"), answer()],
            [],
            [answer("100.64.0.1")],
        ]:
            with (
                patch.object(socket, "getaddrinfo", return_value=rows),
                patch.object(egress, "PinnedHTTPSConnection") as transport,
            ):
                with self.assertRaises(egress.EgressDenied):
                    egress.forward_mcp(envelope(), ORIGINS)
                transport.assert_not_called()

    def test_dns_failure_and_pool_saturation_fail_closed(self):
        with patch.object(socket, "getaddrinfo", side_effect=socket.gaierror):
            with self.assertRaises(egress.EgressDenied):
                egress.resolve_public("mcp.example.com")
        with patch.object(egress, "_DNS_SLOTS") as slots:
            slots.acquire.return_value = False
            with self.assertRaises(egress.EgressDenied):
                egress.resolve_public("mcp.example.com")

    def test_header_and_body_rejection_before_dns(self):
        for headers in [
            {"host": "127.0.0.1"},
            {"authorization": "secret\r\nX: y"},
            {"mcp-session-id": "bad session"},
        ]:
            request = envelope()
            request["headers"] = headers
            with (
                patch.object(egress, "resolve_public") as dns,
                self.assertRaises(egress.EgressDenied),
            ):
                egress.forward_mcp(request, ORIGINS)
            dns.assert_not_called()
        for body in [
            "x" * 30_001,
            "not json",
            '{"jsonrpc":"2.0","method":"arbitrary"}',
        ]:
            request = envelope()
            request["body"] = body
            with (
                patch.object(egress, "resolve_public") as dns,
                self.assertRaises(egress.EgressDenied),
            ):
                egress.forward_mcp(request, ORIGINS)
            dns.assert_not_called()

    def test_socket_is_numeric_but_tls_uses_original_hostname(self):
        raw, context = MagicMock(), MagicMock()
        with (
            patch.object(socket, "socket", return_value=raw),
            patch.object(ssl, "create_default_context", return_value=context),
            patch.object(socket, "getaddrinfo") as dns,
        ):
            conn = egress.PinnedHTTPSConnection(
                "mcp.example.com",
                socket.AF_INET,
                "93.184.216.34",
                time.monotonic() + 10,
            )
            conn.connect()
            raw.connect.assert_called_once_with(("93.184.216.34", 443))
            context.wrap_socket.assert_called_once_with(
                raw, server_hostname="mcp.example.com"
            )
            dns.assert_not_called()
            conn.stop_deadline()
            conn.close()
            self.assertIsNone(conn._deadline_timer)

    def test_tls_failure_does_not_retry_another_ip(self):
        raw, context = MagicMock(), MagicMock()
        context.wrap_socket.side_effect = ssl.SSLCertVerificationError(
            "synthetic failure"
        )
        with (
            patch.object(socket, "socket", return_value=raw),
            patch.object(ssl, "create_default_context", return_value=context),
        ):
            conn = egress.PinnedHTTPSConnection(
                "mcp.example.com",
                socket.AF_INET,
                "93.184.216.34",
                time.monotonic() + 10,
            )
            with self.assertRaises(ssl.SSLCertVerificationError):
                conn.connect()
            raw.connect.assert_called_once()
            raw.close.assert_called_once()


class LocalTLS(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        cert, key = Path(self.temp.name) / "cert.pem", Path(self.temp.name) / "key.pem"
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
                "/CN=mcp.example.com",
                "-addext",
                "subjectAltName=DNS:mcp.example.com",
            ],
            check=True,
            capture_output=True,
        )  # fixed synthetic fixture, no shell
        self.requests, self.sni = [], []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_POST(self):
                body = self.rfile.read(int(self.headers["Content-Length"]))
                outer.requests.append((self.path, dict(self.headers), body))
                self.send_response(outer.status)
                if outer.slow_chunk:
                    self.wfile.write(
                        b"HTTP/1.0 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1;"
                    )
                    for _ in range(12):
                        if outer.stopped.wait(0.05):
                            return
                        try:
                            self.wfile.write(b"x")
                            self.wfile.flush()
                        except OSError:
                            return
                    self.wfile.write(b"\r\nx\r\n0\r\n\r\n")
                    return
                if outer.slow_headers:
                    self.wfile.write(b"HTTP/1.1 200 OK\r\n")
                    for _ in range(12):
                        if outer.stopped.wait(0.05):
                            return
                        try:
                            self.wfile.write(b"X-Synthetic: drip\r\n")
                            self.wfile.flush()
                        except OSError:
                            return
                    self.wfile.write(b"Content-Length: 2\r\n\r\n{}")
                    return
                if outer.status == 302:
                    self.send_header(
                        "Location", "http://169.254.169.254/latest/meta-data/"
                    )
                self.send_header("Content-Type", "application/json")
                if outer.emit_length:
                    self.send_header("Content-Length", str(len(outer.payload)))
                self.end_headers()
                self.wfile.write(outer.payload)

        self.payload, self.status = (
            b'{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}',
            200,
        )
        self.emit_length = True
        self.slow_headers = False
        self.slow_chunk = False
        self.stopped = threading.Event()
        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(cert, key)
        context.set_servername_callback(
            lambda _sock, name, _context: self.sni.append(name)
        )
        self.server.socket = context.wrap_socket(self.server.socket, server_side=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client_context = ssl.create_default_context(cafile=str(cert))

    def tearDown(self):
        self.stopped.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def forward(self, request=None, context=None, origins=ORIGINS):
        port, attempts = self.server.server_port, []
        real_socket = socket.socket
        real_connection = egress.PinnedHTTPSConnection
        connections = []

        def capture_connection(*args):
            conn = real_connection(*args)
            connections.append(conn)
            return conn

        class SyntheticPublicSocket(real_socket):
            def connect(self, address):
                attempts.append(address)
                if address != ("93.184.216.34", 443):
                    raise AssertionError("Unexpected socket destination")
                return super().connect(("127.0.0.1", port))

        with (
            patch.object(socket, "getaddrinfo", return_value=[answer()]) as dns,
            patch.object(socket, "socket", SyntheticPublicSocket),
            patch.object(egress, "PinnedHTTPSConnection", capture_connection),
            patch.object(
                ssl,
                "create_default_context",
                return_value=context or self.client_context,
            ),
        ):
            try:
                result = egress.forward_mcp(request or envelope(), origins)
            finally:
                for conn in connections:
                    self.assertIsNone(conn._deadline_timer)
                    self.assertIsNone(conn.sock)
            dns.assert_called_once_with(
                "mcp.example.com", 443, socket.AF_UNSPEC, socket.SOCK_STREAM
            )
        self.assertEqual(attempts, [("93.184.216.34", 443)])
        return result

    def test_actual_tls_host_sni_body_and_one_dns(self):
        status, headers, body = self.forward()
        self.assertEqual(status, 200)
        self.assertEqual(body, self.payload)
        self.assertEqual(headers["content-type"], "application/json")
        self.assertEqual(self.sni, ["mcp.example.com"])
        path, headers, body = self.requests[0]
        self.assertEqual(path, "/mcp")
        self.assertEqual(headers["Host"], "mcp.example.com")
        self.assertEqual(headers["authorization"], "Bearer synthetic-provider-token")

    def test_actual_slow_headers_obey_total_deadline(self):
        self.slow_headers = True
        started = time.monotonic()
        with patch.object(egress, "TIMEOUT", 0.2):
            with self.assertRaisesRegex(TimeoutError, "egress_timeout"):
                self.forward()
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(len(self.requests), 1)

    def test_actual_slow_chunk_metadata_obeys_total_deadline(self):
        self.slow_chunk = True
        started = time.monotonic()
        with patch.object(egress, "TIMEOUT", 0.2):
            with self.assertRaisesRegex(TimeoutError, "egress_timeout"):
                self.forward()
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertEqual(len(self.requests), 1)

    def test_actual_redirect_is_not_followed(self):
        self.status = 302
        with self.assertRaisesRegex(egress.EgressDenied, "redirect_denied"):
            self.forward()
        self.assertEqual(len(self.requests), 1)

    def test_actual_response_size_cap(self):
        self.payload = b"x" * 400_001
        with self.assertRaisesRegex(egress.EgressDenied, "response_too_large"):
            self.forward()

    def test_actual_stream_without_length_is_bounded(self):
        self.emit_length = False
        self.payload = b"x" * 400_001
        with self.assertRaisesRegex(egress.EgressDenied, "response_too_large"):
            self.forward()

    def test_actual_trusted_certificate_wrong_hostname_is_rejected(self):
        request = envelope()
        request["url"] = "https://other.example.com/mcp"
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.forward(
                request=request, origins=frozenset({"https://other.example.com"})
            )
        self.assertEqual(self.requests, [])

    def test_actual_untrusted_certificate_is_rejected(self):
        context = ssl.create_default_context()
        with self.assertRaises(ssl.SSLCertVerificationError):
            self.forward(context=context)
        self.assertEqual(self.requests, [])


class ServiceTests(unittest.TestCase):
    def test_startup_needs_explicit_credentials_and_origins(self):
        for token, origins in [
            ("", ORIGINS),
            (TOKEN, frozenset()),
            (TOKEN, frozenset({"https://mcp.example.com/path"})),
            ("x\ny" * 32, ORIGINS),
        ]:
            with self.assertRaises(ValueError):
                service.make_handler(token, origins)

    def test_actual_service_auth_and_envelope_forwarding(self):
        server = HTTPServer(("127.0.0.1", 0), service.make_handler(TOKEN, ORIGINS))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with patch.object(
                service,
                "forward_mcp",
                return_value=(
                    200,
                    {"content-type": "application/json"},
                    b'{"ok":true}',
                ),
            ) as forward:
                for auth, expected in [("Bearer wrong", 401), ("Bearer " + TOKEN, 200)]:
                    conn = http.client.HTTPConnection(
                        "127.0.0.1", server.server_port, timeout=3
                    )
                    conn.request(
                        "POST",
                        "/v1/mcp",
                        json.dumps(envelope()),
                        {"Authorization": auth},
                    )
                    response = conn.getresponse()
                    self.assertEqual(response.status, expected)
                    response.read()
                    conn.close()
                forward.assert_called_once_with(envelope(), ORIGINS)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main()
