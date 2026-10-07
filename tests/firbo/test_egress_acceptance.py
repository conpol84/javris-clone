"""Offline tests for the deployed FIRBO egress acceptance receipt."""

from __future__ import annotations

import importlib.util
import json
import ssl
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from email.message import Message
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()
