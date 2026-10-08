"""Read-only private-worker installation preflight; never starts or installs work."""

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import uuid
from pathlib import Path
from urllib.parse import urlsplit

WORKER_SHA256 = "a60e7ab0f98d2c919496b0c59368f114728dfd71dcc8dfb3e9a4bb4775aa50c4"


def regular_bytes(path, uid, private):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_nlink != 1
            or (private and (info.st_uid != uid or info.st_mode & 0o077))
            or info.st_size > 100_000
        ):
            raise ValueError("unsafe_file")
        raw = stream.read(100_001)
        if len(raw) > 100_000:
            raise ValueError("oversized_file")
        return raw


def port_free(port, proc=Path("/proc/net")):
    """Observe Linux listening sockets; a free observation does not reserve a port."""
    for table in ("tcp", "tcp6"):
        rows = (proc / table).read_text().splitlines()[1:]
        for row in rows:
            fields = row.split()
            if len(fields) < 4:
                raise ValueError("invalid_socket_metadata")
            if fields[3] == "0A" and int(fields[1].rsplit(":", 1)[1], 16) == port:
                return False
    return True


def config_valid(cfg, mode):
    required = {"worker_id", "organizations", "worker_token"}
    required |= {"admin_token"} if mode == "server" else {"server"}
    if not isinstance(cfg, dict) or set(cfg) != required:
        return False
    identities = (
        [cfg["worker_id"], *cfg["organizations"]]
        if isinstance(cfg["organizations"], list)
        else []
    )
    if not identities or not 1 <= len(cfg["organizations"]) <= 8:
        return False
    if len(set(cfg["organizations"])) != len(cfg["organizations"]):
        return False
    if any(not isinstance(x, str) or str(uuid.UUID(x)) != x for x in identities):
        return False
    keys = ["worker_token", "admin_token"] if mode == "server" else ["worker_token"]
    if any(
        not isinstance(cfg[k], str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", cfg[k])
        for k in keys
    ):
        return False
    if mode == "server":
        return cfg["worker_token"] != cfg["admin_token"]
    if not isinstance(cfg["server"], str):
        return False
    url = urlsplit(cfg["server"])
    _ = url.port
    return bool(
        url.hostname
        and not url.username
        and not url.password
        and not url.query
        and not url.fragment
        and url.path in ("", "/")
        and (
            url.scheme == "https"
            or (url.scheme == "http" and url.hostname in ("127.0.0.1", "::1"))
        )
    )


def inspect_host(
    mode, source, config, state, port=8095, *, uid=None, proc=Path("/proc/net")
):
    uid = os.getuid() if uid is None else uid
    checks = {
        "linux": sys.platform == "linux",
        "python_supported": sys.version_info >= (3, 11),
        "non_root": uid != 0,
    }
    probes = {
        "pinned_worker_bytes": lambda: (
            hashlib.sha256(regular_bytes(source, uid, False)).hexdigest()
            == WORKER_SHA256
        ),
        "private_scoped_config": lambda: config_valid(
            json.loads(regular_bytes(config, uid, True)), mode
        ),
        "private_state_directory": lambda: private_directory(state, uid),
        "database_path_safe": lambda: safe_database(
            Path(state) / (mode + ".sqlite3"), uid
        ),
    }
    if mode == "server":
        probes["coordinator_port_free"] = lambda: port_free(port, proc)
    for key, probe in probes.items():
        try:
            checks[key] = bool(probe())
        except (
            OSError,
            ValueError,
            TypeError,
            KeyError,
            OverflowError,
            RecursionError,
        ):
            checks[key] = False
    return {
        "schema": "firbo-private-worker-preflight/v1",
        "mode": mode,
        "local_prerequisites_pass": all(checks.values()),
        "checks": checks,
        "worker_source_sha256": WORKER_SHA256,
        "deployed": False,
        "network_acceptance": "not_tested",
        "service_supervision": "not_tested",
        "job_receipt_acceptance": "not_tested",
    }


def private_directory(path, uid):
    info = os.lstat(path)
    return (
        stat.S_ISDIR(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o077
    )


def safe_database(path, uid):
    if not os.path.lexists(path):
        return True
    info = os.lstat(path)
    return (
        stat.S_ISREG(info.st_mode)
        and info.st_nlink == 1
        and info.st_uid == uid
        and not info.st_mode & 0o077
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["server", "worker"])
    parser.add_argument("--source", required=True)
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--port", type=int, default=8095)
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be 1..65535")
    report = inspect_host(
        args.mode, args.source, args.config, args.state_dir, args.port
    )
    print(json.dumps(report, sort_keys=True))
    return 0 if report["local_prerequisites_pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
