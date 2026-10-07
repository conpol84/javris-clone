"""Pinned HTTPS transport for reading arbitrary public text pages.

Every redirect is validated and resolved independently.  A connection is made
only to the selected public numeric address while TLS still verifies the URL's
hostname.  There is no proxy, retry, alternate-address fallback or compression.
"""

from __future__ import annotations

import concurrent.futures
import http.client
import ipaddress
import re
import socket
import ssl
import threading
import time
from urllib.parse import urljoin, urlsplit

MAX_RESPONSE = 1_000_000
MAX_REDIRECTS = 3
TIMEOUT = 15.0
_DNS_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2)
_DNS_SLOTS = threading.BoundedSemaphore(2)


class PageEgressDenied(ValueError):
    """Generic errors only; never include page URLs or response bodies."""


def public_ip(value: str) -> bool:
    try:
        address = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped or address.sixtofour or address.teredo or "%" in value:
            return False
        if address not in ipaddress.ip_network("2000::/3"):
            return False
        if any(
            address in ipaddress.ip_network(network)
            for network in ("2001::/23", "2001:db8::/32", "3fff::/20")
        ):
            return False
    elif any(
        address in ipaddress.ip_network(network)
        for network in ("192.0.0.0/24", "192.88.99.0/24")
    ):
        return False
    return address.is_global and not address.is_multicast and not address.is_reserved


def target_url(value: str) -> tuple[str, str]:
    if (
        not isinstance(value, str)
        or len(value.encode("utf-8")) > 2_000
        or any(ord(character) <= 32 or ord(character) == 127 for character in value)
        or "\\" in value
    ):
        raise PageEgressDenied("target_denied")
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.fragment
            or parsed.port not in (None, 443)
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", host)
            or "." not in host
            or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in host.split(".")
            )
            or host.rsplit(".", 1)[1]
            in {
                "local",
                "internal",
                "localhost",
                "lan",
                "home",
                "corp",
                "test",
                "invalid",
            }
        ):
            raise PageEgressDenied("target_denied")
        try:
            socket.inet_aton(host)
        except OSError:
            pass
        else:
            raise PageEgressDenied("target_denied")
        path = parsed.path or "/"
        return host, path + ("?" + parsed.query if parsed.query else "")
    except (ValueError, UnicodeError) as exc:
        raise PageEgressDenied("target_denied") from exc


def resolve_public(host: str, deadline: float | None = None) -> tuple[int, str]:
    if not _DNS_SLOTS.acquire(blocking=False):
        raise PageEgressDenied("dns_unavailable")

    def lookup():
        try:
            return socket.getaddrinfo(host, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
        finally:
            _DNS_SLOTS.release()

    future = _DNS_POOL.submit(lookup)
    try:
        timeout = 3.0 if deadline is None else min(3.0, deadline - time.monotonic())
        if timeout <= 0:
            raise TimeoutError("page_egress_timeout")
        answers = future.result(timeout=timeout)
    except TimeoutError as exc:
        raise TimeoutError("page_egress_timeout") from exc
    except Exception as exc:
        raise PageEgressDenied("dns_unavailable") from exc
    if not answers or len(answers) > 32:
        raise PageEgressDenied("dns_denied")
    for family, kind, _proto, _canon, address in answers:
        if (
            family not in (socket.AF_INET, socket.AF_INET6)
            or kind != socket.SOCK_STREAM
            or not public_ip(address[0])
        ):
            raise PageEgressDenied("dns_denied")
    return answers[0][0], answers[0][4][0]


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host: str, family: int, ip: str, deadline: float):
        super().__init__(
            host, 443, timeout=TIMEOUT, context=ssl.create_default_context()
        )
        self.family, self.ip, self.deadline = family, ip, deadline
        self.expired = threading.Event()
        self._deadline_timer = None

    def remaining(self) -> float:
        remaining = self.deadline - time.monotonic()
        if self.expired.is_set() or remaining <= 0:
            raise TimeoutError("page_egress_timeout")
        return remaining

    def connect(self):
        raw = socket.socket(self.family, socket.SOCK_STREAM)
        try:
            raw.settimeout(self.remaining())
            raw.connect((self.ip, 443))
            raw.settimeout(self.remaining())
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
            tls_socket = self.sock

            def expire():
                self.expired.set()
                try:
                    tls_socket.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

            self._deadline_timer = threading.Timer(self.remaining(), expire)
            self._deadline_timer.daemon = True
            self._deadline_timer.start()
        except BaseException:
            raw.close()
            self.close()
            raise

    def stop_deadline(self):
        timer = self._deadline_timer
        if timer is not None:
            timer.cancel()
            timer.join()
            self._deadline_timer = None


def _framing(response: http.client.HTTPResponse) -> int | None:
    lengths = response.headers.get_all("Content-Length") or []
    transfers = response.headers.get_all("Transfer-Encoding") or []
    if len(lengths) > 1 or len(transfers) > 1 or (lengths and transfers):
        raise PageEgressDenied("response_framing_denied")
    if transfers and transfers[0].strip().lower() != "chunked":
        raise PageEgressDenied("response_framing_denied")
    if not lengths:
        return None
    value = lengths[0]
    if not re.fullmatch(r"[0-9]{1,7}", value):
        raise PageEgressDenied("response_framing_denied")
    declared = int(value)
    if declared > MAX_RESPONSE:
        raise PageEgressDenied("response_too_large")
    return declared


def _read_response(
    response: http.client.HTTPResponse,
    connection: PinnedHTTPSConnection,
    live_socket: ssl.SSLSocket,
    declared: int | None,
) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while not response.isclosed():
        live_socket.settimeout(connection.remaining())
        try:
            chunk = response.read1(min(8192, MAX_RESPONSE + 1 - size))
        except http.client.IncompleteRead as exc:
            raise PageEgressDenied("response_incomplete") from exc
        if not chunk:
            break
        size += len(chunk)
        if size > MAX_RESPONSE:
            raise PageEgressDenied("response_too_large")
        chunks.append(chunk)
    if declared is not None and size != declared:
        raise PageEgressDenied("response_incomplete")
    connection.remaining()
    return b"".join(chunks)


def forward_page(raw_url: str):
    """Return status, safe content type and bounded bytes from a public page."""
    deadline = time.monotonic() + TIMEOUT
    url = raw_url
    for hop in range(MAX_REDIRECTS + 1):
        host, path = target_url(url)
        family, ip = resolve_public(host, deadline)
        connection = PinnedHTTPSConnection(host, family, ip, deadline)
        response = None
        try:
            connection.request(
                "GET",
                path,
                headers={
                    "User-Agent": "Mozilla/5.0 (compatible; FirboAgent/1.0; +https://firboai.app)",
                    "Accept": "text/html,text/plain,application/xhtml+xml",
                    "Accept-Encoding": "identity",
                    "Connection": "close",
                },
            )
            live_socket = connection.sock
            live_socket.settimeout(connection.remaining())
            response = connection.getresponse()
            connection.remaining()
            if response.getheader("Content-Encoding", "identity").lower() != "identity":
                raise PageEgressDenied("encoding_denied")
            declared = _framing(response)
            if response.status in {301, 302, 303, 307, 308}:
                locations = response.headers.get_all("Location") or []
                if len(locations) != 1 or hop >= MAX_REDIRECTS:
                    raise PageEgressDenied("redirect_denied")
                next_url = urljoin(url, locations[0])
                target_url(next_url)
                url = next_url
                continue
            if not 200 <= response.status < 300:
                return response.status, "text/plain; charset=utf-8", b""
            content_types = response.headers.get_all("Content-Type") or []
            if len(content_types) > 1:
                raise PageEgressDenied("headers_denied")
            content_type = content_types[0] if content_types else "text/plain"
            if not re.fullmatch(r"[\x20-\x7e]{1,150}", content_type) or not re.match(
                r"^(?:text/(?:html|plain)|application/xhtml\+xml)(?:\s*;|$)",
                content_type,
                re.IGNORECASE,
            ):
                raise PageEgressDenied("content_type_denied")
            body = _read_response(response, connection, live_socket, declared)
            return response.status, content_type, body
        except (OSError, http.client.HTTPException) as exc:
            if connection.expired.is_set() or time.monotonic() >= deadline:
                raise TimeoutError("page_egress_timeout") from exc
            raise
        finally:
            connection.stop_deadline()
            if response is not None:
                response.close()
            connection.close()
    raise PageEgressDenied("redirect_denied")
