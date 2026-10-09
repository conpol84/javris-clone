"""Offline SSRF, framing and actual synthetic TLS tests for page egress."""

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
from unittest.mock import patch

from openjarvis.security import page_egress as egress
from openjarvis.server import firbo_page_egress as service

TOKEN = "synthetic-page-service-token-32-characters"


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
            "http://page.example.com/a",
            "https://127.1/",
            "https://2130706433/",
            "https://0x7f000001/",
            "https://[::1]/",
            "https://u:p@page.example.com/",
            "https://page.example.com:8443/",
            "https://page.example.com/#x",
            "https://page.example.com\\@evil.example/",
            "https://page.example.com/\r\nx",
            "https://a.internal/",
            "https://a..com/",
            "https://-a.example.com/",
        ]:
            with self.subTest(url=url), patch.object(egress, "resolve_public") as dns:
                with self.assertRaises(egress.PageEgressDenied):
                    egress.forward_page(url)
                dns.assert_not_called()

    def test_mixed_dns_and_failures_are_denied_before_socket(self):
        for rows in [
            [answer(), answer("127.0.0.1")],
            [answer("::1"), answer()],
            [],
            [answer("100.64.0.1")],
        ]:
            with (
                patch.object(socket, "getaddrinfo", return_value=rows),
                patch.object(egress, "PinnedHTTPSConnection") as transport,
                self.assertRaises(egress.PageEgressDenied),
            ):
                egress.forward_page("https://page.example.com/a")
            transport.assert_not_called()
        with patch.object(socket, "getaddrinfo", side_effect=socket.gaierror):
            with self.assertRaises(egress.PageEgressDenied):
                egress.resolve_public("page.example.com")

    def test_service_configuration_is_private_and_contains_no_secret(self):
        configured = {
            "FIRBO_PAGE_EGRESS_TOKEN": TOKEN,
            "FIRBO_PAGE_EGRESS_BIND": "10.2.3.4",
            "FIRBO_PAGE_EGRESS_PORT": "18094",
        }
        self.assertEqual(
            service.service_configuration(configured), (TOKEN, "10.2.3.4", 18094)
        )
        for changed in [
            {"FIRBO_PAGE_EGRESS_TOKEN": "short"},
            {"FIRBO_PAGE_EGRESS_BIND": "0.0.0.0"},
            {"FIRBO_PAGE_EGRESS_BIND": "93.184.216.34"},
            {"FIRBO_PAGE_EGRESS_PORT": "80"},
        ]:
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                service.service_configuration({**configured, **changed})


class LocalTLS(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        certificate = Path(self.temp.name) / "certificate.pem"
        key = Path(self.temp.name) / "key.pem"
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
                str(certificate),
                "-days",
                "1",
                "-subj",
                "/CN=page.example.com",
                "-addext",
                "subjectAltName=DNS:page.example.com,DNS:final.example.com",
            ],
            check=True,
            capture_output=True,
        )
        self.mode = "normal"
        self.requests = []
        self.sni = []
        self.stopped = threading.Event()
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_args):
                pass

            def do_GET(self):
                outer.requests.append((self.path, dict(self.headers)))
                if outer.mode == "short":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Content-Length: 10\r\nConnection: close\r\n\r\nshort"
                    )
                    return
                if outer.mode == "duplicate_length":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Content-Length: 2\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                    )
                    return
                if outer.mode == "unsupported_encoding":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Content-Encoding: gzip\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
                    )
                    return
                if outer.mode == "unsupported_transfer":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Transfer-Encoding: gzip\r\nConnection: close\r\n\r\nok"
                    )
                    return
                if outer.mode == "conflicting_framing":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Transfer-Encoding: chunked\r\nContent-Length: 2\r\nConnection: close\r\n\r\n"
                        b"2\r\nok\r\n0\r\n\r\n"
                    )
                    return
                if outer.mode == "chunked":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
                        b"4\r\npage\r\n0\r\n\r\n"
                    )
                    return
                if outer.mode == "close_delimited":
                    self.wfile.write(
                        b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n"
                        b"Connection: close\r\n\r\npage"
                    )
                    return
                if outer.mode == "slow_headers":
                    self.wfile.write(b"HTTP/1.1 200 OK\r\n")
                    self.wfile.flush()
                    for _ in range(12):
                        if outer.stopped.wait(0.05):
                            return
                        try:
                            self.wfile.write(b"X-Synthetic: drip\r\n")
                            self.wfile.flush()
                        except OSError:
                            return
                    return
                if outer.mode == "redirect":
                    self.send_response(302)
                    self.send_header("Location", "https://final.example.com/page")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    outer.mode = "normal"
                    return
                if outer.mode == "private_redirect":
                    self.send_response(302)
                    self.send_header("Location", "https://169.254.169.254/latest")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                if outer.mode == "nontext":
                    self.send_response(200)
                    self.send_header("Content-Type", "application/pdf")
                    self.send_header("Content-Length", "2")
                    self.end_headers()
                    self.wfile.write(b"ok")
                    return
                payload = (
                    b"<html><title>Safe</title><article>public page</article></html>"
                )
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        server_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        server_context.load_cert_chain(certificate, key)
        server_context.set_servername_callback(
            lambda _socket, name, _context: self.sni.append(name)
        )
        self.server.socket = server_context.wrap_socket(
            self.server.socket, server_side=True
        )
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.client_context = ssl.create_default_context(cafile=str(certificate))

    def tearDown(self):
        self.stopped.set()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def forward(self):
        port = self.server.server_port
        real_socket = socket.socket
        real_connection = egress.PinnedHTTPSConnection
        attempts = []
        connections = []

        class SyntheticPublicSocket(real_socket):
            def connect(self, address):
                attempts.append(address)
                if address != ("93.184.216.34", 443):
                    raise AssertionError("unexpected destination")
                return super().connect(("127.0.0.1", port))

        def capture(*args):
            connection = real_connection(*args)
            connections.append(connection)
            return connection

        with (
            patch.object(socket, "getaddrinfo", return_value=[answer()]) as dns,
            patch.object(socket, "socket", SyntheticPublicSocket),
            patch.object(egress, "PinnedHTTPSConnection", capture),
            patch.object(
                ssl, "create_default_context", return_value=self.client_context
            ),
        ):
            try:
                result = egress.forward_page("https://page.example.com/start")
            finally:
                for connection in connections:
                    self.assertIsNone(connection._deadline_timer)
                    self.assertIsNone(connection.sock)
        expected_dns = (
            2
            if self.requests
            and self.requests[0][0] == "/start"
            and len(self.requests) == 2
            else 1
        )
        self.assertEqual(dns.call_count, expected_dns)
        self.assertEqual(attempts, [("93.184.216.34", 443)] * expected_dns)
        return result

    def test_actual_tls_pins_socket_and_preserves_hostname(self):
        status, content_type, body = self.forward()
        self.assertEqual(status, 200)
        self.assertEqual(content_type, "text/html; charset=utf-8")
        self.assertIn(b"public page", body)
        self.assertEqual(self.sni, ["page.example.com"])
        self.assertEqual(self.requests[0][1]["Host"], "page.example.com")

    def test_redirect_revalidates_and_resolves_each_host(self):
        self.mode = "redirect"
        status, _content_type, body = self.forward()
        self.assertEqual(status, 200)
        self.assertIn(b"public page", body)
        self.assertEqual(self.sni, ["page.example.com", "final.example.com"])
        self.assertEqual([request[0] for request in self.requests], ["/start", "/page"])

    def test_redirect_to_metadata_is_denied_without_second_connection(self):
        self.mode = "private_redirect"
        with self.assertRaises(egress.PageEgressDenied):
            self.forward()
        self.assertEqual(self.sni, ["page.example.com"])
        self.assertEqual(len(self.requests), 1)

    def test_incomplete_duplicate_compressed_and_nontext_responses_are_denied(self):
        for mode in [
            "short",
            "duplicate_length",
            "unsupported_encoding",
            "unsupported_transfer",
            "conflicting_framing",
            "nontext",
        ]:
            with self.subTest(mode=mode):
                self.mode = mode
                self.requests.clear()
                self.sni.clear()
                with self.assertRaises(
                    (egress.PageEgressDenied, http.client.HTTPException)
                ):
                    self.forward()

    def test_valid_chunked_and_close_delimited_pages_remain_supported(self):
        for mode in ["chunked", "close_delimited"]:
            with self.subTest(mode=mode):
                self.mode = mode
                self.requests.clear()
                self.sni.clear()
                status, content_type, body = self.forward()
                self.assertEqual(status, 200)
                self.assertEqual(content_type, "text/plain")
                self.assertEqual(body, b"page")

    def test_actual_slow_headers_obey_one_total_deadline(self):
        self.mode = "slow_headers"
        started = time.monotonic()
        with patch.object(egress, "TIMEOUT", 0.2):
            with self.assertRaisesRegex(TimeoutError, "page_egress_timeout"):
                self.forward()
        self.assertLess(time.monotonic() - started, 0.5)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.forwarded = []
        outer = self

        def fake_forward(url):
            outer.forwarded.append(url)
            return 200, "text/plain; charset=utf-8", b"accepted"

        self.patch = patch.object(service, "forward_page", side_effect=fake_forward)
        self.patch.start()
        self.server = HTTPServer(("127.0.0.1", 0), service.make_handler(TOKEN))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.patch.stop()

    def request(self, token=TOKEN, body=None):
        payload = json.dumps(body or {"url": "https://page.example.com/a"})
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        connection.request(
            "POST",
            "/v1/page",
            body=payload,
            headers={
                "Authorization": "Bearer " + token,
                "Content-Type": "application/json",
            },
        )
        response = connection.getresponse()
        result = response.status, dict(response.headers), response.read()
        connection.close()
        return result

    def test_auth_and_exact_envelope_gate_dispatch(self):
        self.assertEqual(self.request(token="wrong")[0], 401)
        self.assertEqual(self.forwarded, [])
        self.assertEqual(
            self.request(body={"url": "https://page.example.com/a", "x": 1})[0], 400
        )
        self.assertEqual(self.forwarded, [])
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(body, b"accepted")
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertEqual(self.forwarded, ["https://page.example.com/a"])

    def test_service_errors_are_generic_and_do_not_expose_target(self):
        self.patch.stop()
        self.patch = patch.object(
            service, "forward_page", side_effect=egress.PageEgressDenied("private")
        )
        self.patch.start()
        status, _headers, body = self.request()
        self.assertEqual(status, 502)
        self.assertEqual(body, b'{"error":"egress_denied"}')
        self.assertNotIn(b"page.example.com", body)

    def test_slow_body_cannot_dispatch_after_absolute_ingress_deadline(self):
        payload = json.dumps({"url": "https://page.example.com/a"}).encode()
        with patch.object(service, "INGRESS_TIMEOUT", 0.2):
            raw = socket.create_connection(("127.0.0.1", self.server.server_port))
            try:
                raw.sendall(
                    b"POST /v1/page HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer "
                    + TOKEN.encode()
                    + b"\r\nContent-Type: application/json\r\nContent-Length: "
                    + str(len(payload)).encode()
                    + b"\r\n\r\n"
                )
                for byte in payload:
                    try:
                        raw.sendall(bytes([byte]))
                    except OSError:
                        break
                    time.sleep(0.02)
            finally:
                raw.close()
        time.sleep(0.05)
        self.assertEqual(self.forwarded, [])


if __name__ == "__main__":
    unittest.main()
