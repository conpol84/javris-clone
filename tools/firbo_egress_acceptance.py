#!/usr/bin/env python3
"""Generate a no-upstream-dispatch receipt for deployed FIRBO egress routes.

The probe performs two POSTs per service: anonymous denial and an authenticated
malformed-envelope denial. With the byte-pinned service bundle these requests
are rejected before DNS resolution or any provider/page transport. Tokens are
read only from the environment and are never written to the receipt or errors.
"""

from __future__ import annotations

import argparse
import hashlib
import http.client
import ipaddress
import json
import os
import re
import ssl
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Mapping
from urllib.parse import urlsplit

MAX_RESPONSE = 512
TOTAL_TIMEOUT = 30.0
PER_REQUEST_TIMEOUT = 8.0
PROBE_BODY = b"{}"
ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "deploy" / "firbo-egress-bundle.json"
ConnectionFactory = Callable[..., http.client.HTTPSConnection]


class AcceptanceError(ValueError):
    """Bounded, non-secret acceptance failure."""


def _fail(code: str) -> None:
    raise AcceptanceError(code)


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _read_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        _fail(f"{label}_invalid")
    if not isinstance(value, dict):
        _fail(f"{label}_invalid")
    return value


def _public_route(value: object, expected_path: str) -> str:
    if not isinstance(value, str) or len(value) > 2_000:
        _fail("release_route_invalid")
    try:
        parsed = urlsplit(value)
        host = (parsed.hostname or "").lower()
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
            or parsed.path != expected_path
            or parsed.query
            or parsed.fragment
            or "." not in host
            or ":" in host
            or value != f"https://{host}{expected_path}"
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", host)
            or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in host.split(".")
            )
            or host.rsplit(".", 1)[1]
            in {"example", "invalid", "localhost", "local", "internal", "test"}
        ):
            _fail("release_route_invalid")
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            _fail("release_route_invalid")
    except (ValueError, UnicodeError):
        _fail("release_route_invalid")
    return value


def _valid_token(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) >= 32
        and value.isascii()
        and all(32 < ord(character) < 127 for character in value)
    )


def _post(
    url: str,
    token: str | None,
    timeout: float,
    connection_factory: ConnectionFactory = http.client.HTTPSConnection,
) -> dict:
    parsed = urlsplit(url)
    context = ssl.create_default_context()
    connection = connection_factory(
        parsed.hostname,
        443,
        timeout=timeout,
        context=context,
    )
    response = None
    expired = threading.Event()

    def expire() -> None:
        expired.set()
        connection.close()

    timer = threading.Timer(timeout, expire)
    timer.daemon = True
    timer.start()
    try:
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "Content-Length": str(len(PROBE_BODY)),
            "Connection": "close",
        }
        if token is not None:
            headers["Authorization"] = "Bearer " + token
        connection.request("POST", parsed.path, body=PROBE_BODY, headers=headers)
        sock = connection.sock
        certificate = sock.getpeercert(binary_form=True) if sock is not None else None
        if not certificate:
            _fail("tls_receipt_missing")
        response = connection.getresponse()
        if 300 <= response.status < 400:
            _fail("redirect_denied")
        lengths = response.headers.get_all("Content-Length") or []
        transfers = response.headers.get_all("Transfer-Encoding") or []
        content_types = response.headers.get_all("Content-Type") or []
        cache_controls = response.headers.get_all("Cache-Control") or []
        if (
            len(lengths) != 1
            or transfers
            or not re.fullmatch(r"[0-9]{1,3}", lengths[0])
            or int(lengths[0]) > MAX_RESPONSE
            or content_types != ["application/json"]
            or cache_controls != ["no-store"]
        ):
            _fail("response_contract_invalid")
        body = response.read(MAX_RESPONSE + 1)
        if len(body) != int(lengths[0]):
            _fail("response_contract_invalid")
        return {
            "status": response.status,
            "body_sha256": _sha256(body),
            "tls_peer_sha256": _sha256(certificate),
            "attempts": 1,
        }
    except AcceptanceError:
        raise
    except (OSError, TimeoutError, ssl.SSLError, http.client.HTTPException):
        _fail(
            "acceptance_deadline_exceeded"
            if expired.is_set()
            else "tls_or_transport_failed"
        )
    finally:
        timer.cancel()
        timer.join()
        if response is not None:
            response.close()
        connection.close()


def _expected(probe: dict, status: int, body: bytes) -> None:
    if probe["status"] != status or probe["body_sha256"] != _sha256(body):
        _fail("deployed_response_mismatch")


def acceptance_receipt(
    release_path: Path,
    environment: Mapping[str, str] = os.environ,
    *,
    now: datetime | None = None,
    monotonic: Callable[[], float] = time.monotonic,
    connection_factory: ConnectionFactory = http.client.HTTPSConnection,
) -> dict:
    release = _read_json(release_path, "release_config")
    if release.get("schema") != "firbo-egress-release/v1":
        _fail("release_config_invalid")
    mcp = release.get("mcp")
    page = release.get("page")
    if not isinstance(mcp, dict) or not isinstance(page, dict):
        _fail("release_config_invalid")
    mcp_url = _public_route(mcp.get("public_url"), "/v1/mcp")
    page_url = _public_route(page.get("public_url"), "/v1/page")
    mcp_token = environment.get("FIRBO_MCP_EGRESS_TOKEN")
    page_token = environment.get("FIRBO_PAGE_EGRESS_TOKEN")
    if (
        not _valid_token(mcp_token)
        or not _valid_token(page_token)
        or mcp_token == page_token
    ):
        _fail("dedicated_tokens_required")

    started = monotonic()

    def probe(url: str, token: str | None) -> dict:
        remaining = TOTAL_TIMEOUT - (monotonic() - started)
        if remaining <= 0:
            _fail("acceptance_deadline_exceeded")
        return _post(
            url,
            token,
            min(PER_REQUEST_TIMEOUT, remaining),
            connection_factory,
        )

    mcp_anonymous = probe(mcp_url, None)
    _expected(mcp_anonymous, 401, b'{"error":"unauthorized"}')
    mcp_authenticated = probe(mcp_url, mcp_token)
    _expected(mcp_authenticated, 502, b'{"error":"egress_denied"}')
    page_anonymous = probe(page_url, None)
    _expected(page_anonymous, 401, b'{"error":"unauthorized"}')
    page_authenticated = probe(page_url, page_token)
    _expected(page_authenticated, 400, b'{"error":"bad_request"}')

    checked = now or datetime.now(timezone.utc)
    if checked.tzinfo is None:
        _fail("clock_invalid")
    return {
        "schema": "firbo-egress-acceptance/v1",
        "checked_at": checked.astimezone(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "bundle_manifest_sha256": _sha256(MANIFEST.read_bytes()),
        "probe_payload_sha256": _sha256(PROBE_BODY),
        "contains_secrets": False,
        "upstream_dispatch_expected": False,
        "services": {
            "mcp": {
                "url": mcp_url,
                "anonymous": mcp_anonymous,
                "authenticated_malformed": mcp_authenticated,
            },
            "page": {
                "url": page_url,
                "anonymous": page_anonymous,
                "authenticated_malformed": page_authenticated,
            },
        },
    }


def _write_output(path: Path | None, receipt: dict) -> None:
    raw = (json.dumps(receipt, sort_keys=True, separators=(",", ":")) + "\n").encode()
    if path is None:
        sys.stdout.buffer.write(raw)
        return
    try:
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as output:
            output.write(raw)
    except OSError:
        _fail("receipt_output_refused")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-config", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    try:
        receipt = acceptance_receipt(args.release_config)
        _write_output(args.output, receipt)
    except AcceptanceError as exc:
        print(f"egress_acceptance: {exc}", file=sys.stderr)
        return 1
    except Exception:
        print("egress_acceptance: acceptance_failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
