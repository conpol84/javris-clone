"""One-request, one-action operator approvals for the native Linux API.

Only root can issue a grant. API authentication alone never authorizes shell
execution. Grants are request-bound, expire within five minutes and are reserved
atomically before inference. A rejected/failed request cannot reuse its grant.
"""

from __future__ import annotations

import ast
import hashlib
import json
import os
import re
import stat
import threading
import time
from contextlib import contextmanager
from pathlib import Path

ROOT = Path("/run/firbo-native-approval")
MAX_BYTES = 32768
PREFIX = "Allow execution of tool 'shell_exec' with args "


class ApprovalDenied(ValueError):
    """Fixed non-secret rejection; never return grant or command contents."""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def request_digest(model, messages):
    # Bind all conversation messages. Endpoint memory injection must not change
    # an operator-approved request; approved requests bypass that enrichment.
    return hashlib.sha256(
        canonical({"model": model, "messages": messages}).encode()
    ).hexdigest()


def _directory(path, owner, mode):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    value = os.fstat(fd)
    if value.st_uid != owner or stat.S_IMODE(value.st_mode) != mode:
        os.close(fd)
        raise ApprovalDenied("approval_directory_invalid")
    return fd


def reserve(grant_id, model, messages):
    """Read the root-issued grant and reserve it once across processes."""
    if not re.fullmatch(r"[0-9a-f]{64}", grant_id) or os.geteuid() == 0:
        raise ApprovalDenied("approval_identity_invalid")
    root_fd = grants_fd = used_fd = fd = -1
    try:
        root_fd = _directory(ROOT, 0, 0o755)
        # Resolve children through the verified directory, not a mutable path.
        grants_fd = os.open(
            "grants", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd
        )
        used_fd = os.open(
            "used", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=root_fd
        )
        for directory, owner, mode in (
            (grants_fd, 0, 0o711),
            (used_fd, os.geteuid(), 0o700),
        ):
            info = os.fstat(directory)
            if info.st_uid != owner or stat.S_IMODE(info.st_mode) != mode:
                raise ApprovalDenied("approval_directory_invalid")
        fd = os.open(
            grant_id + ".key",
            os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
            dir_fd=grants_fd,
        )
        info = os.fstat(fd)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or info.st_nlink != 1
            or stat.S_IMODE(info.st_mode) != 0o644
            or not 0 < info.st_size <= MAX_BYTES
        ):
            raise ApprovalDenied("approval_file_invalid")
        raw = os.read(fd, MAX_BYTES + 1)
        grant = json.loads(raw)
        expected_keys = {
            "schema",
            "id",
            "uid",
            "request_sha256",
            "tool",
            "arguments",
            "created_at",
            "expires_at",
        }
        now = time.time()
        if (
            not isinstance(grant, dict)
            or set(grant) != expected_keys
            or grant["schema"] != "firbo-native-approval/v1"
            or grant["id"] != grant_id
            or type(grant["uid"]) is not int
            or grant["uid"] != os.geteuid()
            or grant["tool"] != "shell_exec"
            or not isinstance(grant["arguments"], dict)
            or grant["request_sha256"] != request_digest(model, messages)
            or type(grant["created_at"]) is not int
            or type(grant["expires_at"]) is not int
            or not grant["created_at"]
            <= now
            < grant["expires_at"]
            <= grant["created_at"] + 300
        ):
            raise ApprovalDenied("approval_scope_or_expiry_invalid")
        expected = canonical(grant["arguments"])
        # .key is already blocked by native file tools (including symlink aliases).
        marker = os.open(
            grant_id + ".key",
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
            0o600,
            dir_fd=used_fd,
        )
        os.close(marker)
    except (OSError, ValueError, TypeError, RecursionError):
        raise ApprovalDenied("approval_unavailable_or_used") from None
    finally:
        for handle in (fd, used_fd, grants_fd, root_fd):
            if handle >= 0:
                os.close(handle)

    lock = threading.Lock()
    consumed = False

    def confirm(prompt):
        nonlocal consumed
        with lock:
            if consumed or time.time() >= grant["expires_at"]:
                return False
            # A mismatch consumes the in-memory opportunity too; the model
            # cannot probe alternative commands until one happens to match.
            consumed = True
            if not isinstance(prompt, str) or len(prompt) > MAX_BYTES:
                return False
            if not prompt.startswith(PREFIX) or not prompt.endswith("?"):
                return False
            try:
                arguments = ast.literal_eval(prompt[len(PREFIX) : -1])
                return isinstance(arguments, dict) and canonical(arguments) == expected
            except (ValueError, TypeError, SyntaxError, RecursionError):
                return False

    return confirm


@contextmanager
def approved_request(agent, req):
    """Caller MUST hold the existing full-run agent lock, including restore."""
    grant_id = req.firbo_native_approval
    if grant_id is None:
        yield
        return
    executor = getattr(agent, "_executor", None)
    if (
        req.stream
        or req.tools
        or executor is None
        or getattr(executor, "_interactive", False)
        or getattr(executor, "_confirm_callback", None) is not None
    ):
        raise ApprovalDenied("approval_route_not_supported")
    confirm = reserve(grant_id, req.model, [m.model_dump() for m in req.messages])
    old_interactive, old_confirm = executor._interactive, executor._confirm_callback
    try:
        executor._interactive = True
        executor._confirm_callback = confirm
        yield
    finally:
        executor._interactive = old_interactive
        executor._confirm_callback = old_confirm
