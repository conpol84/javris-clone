"""MCP-only HTTPS egress: resolve once, reject mixed DNS, pin the actual socket.

No HTTP proxies, redirects, connection pooling, retry or alternative-address
fallback. TLS verifies the original hostname, never the numeric socket address.
"""

from __future__ import annotations

import concurrent.futures
import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

MAX_BODY = 30_000
MAX_RESPONSE = 400_000
TIMEOUT = 20.0
_DNS_POOL = concurrent.futures.ThreadPoolExecutor(max_workers=2)
_DNS_SLOTS = threading.BoundedSemaphore(2)


class EgressDenied(ValueError):
    """Generic errors only; never include URLs, tokens or provider bodies."""


def public_ip(value: str) -> bool:
    try:
        addr = ipaddress.ip_address(value)
    except ValueError:
        return False
    if isinstance(addr, ipaddress.IPv6Address):
        # Reject transition mechanisms, mapped IPv4 and scoped addresses.
        if addr.ipv4_mapped or addr.sixtofour or addr.teredo or "%" in value:
            return False
        if addr not in ipaddress.ip_network("2000::/3"):
            return False
        if any(
            addr in ipaddress.ip_network(net)
            for net in ("2001::/23", "2001:db8::/32", "3fff::/20")
        ):
            return False
    elif any(
        addr in ipaddress.ip_network(net) for net in ("192.0.0.0/24", "192.88.99.0/24")
    ):
        return False
    return addr.is_global and not addr.is_multicast and not addr.is_reserved


def target_url(value: str, allowed_origins: frozenset[str]):
    if not isinstance(value, str) or len(value) > 2000:
        raise EgressDenied("target_denied")
    if any(ord(c) <= 32 or ord(c) == 127 for c in value) or "\\" in value:
        raise EgressDenied("target_denied")
    try:
        u = urlsplit(value)
        host = u.hostname or ""
        if (
            u.scheme != "https"
            or u.username is not None
            or u.password is not None
            or u.fragment
            or u.port not in (None, 443)
            or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?", host)
            or "." not in host
            or any(
                not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
                for label in host.split(".")
            )
            or host.rsplit(".", 1)[1]
            in {"local", "internal", "localhost", "test", "invalid"}
        ):
            raise EgressDenied("target_denied")
        # Reject alternate numeric forms even when the allowlist contains one.
        try:
            socket.inet_aton(host)
        except OSError:
            pass
        else:
            raise EgressDenied("target_denied")
        if f"https://{host}" not in allowed_origins:
            raise EgressDenied("origin_denied")
        path = u.path or "/"
        return host, path + ("?" + u.query if u.query else "")
    except (ValueError, UnicodeError) as exc:
        raise EgressDenied("target_denied") from exc


def resolve_public(host: str) -> tuple[int, str]:
    if not _DNS_SLOTS.acquire(blocking=False):
        raise EgressDenied("dns_unavailable")

    def lookup():
        try:
            return socket.getaddrinfo(host, 443, socket.AF_UNSPEC, socket.SOCK_STREAM)
        finally:
            _DNS_SLOTS.release()

    future = _DNS_POOL.submit(lookup)
    try:
        answers = future.result(timeout=3.0)
    except Exception as exc:
        # A stuck resolver consumes its slot until it ends; no unbounded queue.
        raise EgressDenied("dns_unavailable") from exc
    if not answers or len(answers) > 32:
        raise EgressDenied("dns_denied")
    for family, kind, _proto, _canon, address in answers:
        if (
            family not in (socket.AF_INET, socket.AF_INET6)
            or kind != socket.SOCK_STREAM
            or not public_ip(address[0])
        ):
            raise EgressDenied("dns_denied")
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
        left = self.deadline - time.monotonic()
        if self.expired.is_set() or left <= 0:
            raise TimeoutError("egress_timeout")
        return left

    def connect(self):
        # socket.connect receives a canonical numeric address: no second DNS.
        raw = socket.socket(self.family, socket.SOCK_STREAM)
        try:
            raw.settimeout(self.remaining())
            raw.connect((self.ip, 443))
            raw.settimeout(self.remaining())
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
            # Buffered HTTP header/chunk reads may perform many individual recv
            # calls. An inactivity timeout alone cannot bound a slow drip.
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
        # http.client.close() can hand a Connection: close socket to the
        # response's buffered reader. Keep the timer until that reader ends.
        timer = self._deadline_timer
        if timer is not None:
            timer.cancel()
            timer.join()
            self._deadline_timer = None


def forward_mcp(envelope: dict, allowed_origins: frozenset[str]):
    deadline = time.monotonic() + TIMEOUT
    if not isinstance(envelope, dict) or set(envelope) != {"url", "body", "headers"}:
        raise EgressDenied("request_denied")
    host, path = target_url(envelope["url"], allowed_origins)
    body, supplied = envelope["body"], envelope["headers"]
    if (
        not isinstance(body, str)
        or len(body.encode("utf-8")) > MAX_BODY
        or not isinstance(supplied, dict)
    ):
        raise EgressDenied("request_denied")
    if set(supplied) - {"authorization", "mcp-session-id"}:
        raise EgressDenied("headers_denied")
    for name, value in supplied.items():
        if not isinstance(value, str) or not re.fullmatch(
            r"[\x21-\x7e ]{1,2000}", value
        ):
            raise EgressDenied("headers_denied")
        if name == "mcp-session-id" and not re.fullmatch(r"[\x21-\x7e]{1,200}", value):
            raise EgressDenied("headers_denied")
    try:
        message = json.loads(body)
        if (
            not isinstance(message, dict)
            or message.get("jsonrpc") != "2.0"
            or message.get("method")
            not in {
                "initialize",
                "notifications/initialized",
                "tools/list",
                "tools/call",
            }
        ):
            raise EgressDenied("request_denied")
    except (ValueError, TypeError) as exc:
        raise EgressDenied("request_denied") from exc
    family, ip = resolve_public(host)
    conn = PinnedHTTPSConnection(host, family, ip, deadline)
    res = None
    try:
        conn.request(
            "POST",
            path,
            body=body.encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json, text/event-stream",
                "Accept-Encoding": "identity",
                "Connection": "close",
                **supplied,
            },
        )
        live_socket = conn.sock
        live_socket.settimeout(conn.remaining())
        res = conn.getresponse()
        conn.remaining()
        if 300 <= res.status < 400:
            raise EgressDenied("redirect_denied")
        if res.getheader("Content-Encoding", "identity").lower() != "identity":
            raise EgressDenied("encoding_denied")
        length = res.getheader("Content-Length")
        if length is not None and (
            not length.isdecimal() or int(length) > MAX_RESPONSE
        ):
            raise EgressDenied("response_too_large")
        chunks, size = [], 0
        while not res.isclosed():
            live_socket.settimeout(conn.remaining())
            chunk = res.read1(min(8192, MAX_RESPONSE + 1 - size))
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_RESPONSE:
                raise EgressDenied("response_too_large")
            chunks.append(chunk)
        content_type = res.getheader("Content-Type", "application/json")
        if not re.fullmatch(r"[\x20-\x7e]{1,150}", content_type):
            raise EgressDenied("headers_denied")
        headers = {"content-type": content_type}
        sid = res.getheader("Mcp-Session-Id")
        if sid is not None:
            if not re.fullmatch(r"[\x21-\x7e]{1,200}", sid):
                raise EgressDenied("session_denied")
            headers["mcp-session-id"] = sid
        conn.remaining()
        return res.status, headers, b"".join(chunks)
    except (OSError, http.client.HTTPException) as exc:
        if conn.expired.is_set() or time.monotonic() >= deadline:
            raise TimeoutError("egress_timeout") from exc
        raise
    finally:
        conn.stop_deadline()
        if res is not None:
            res.close()
        conn.close()
