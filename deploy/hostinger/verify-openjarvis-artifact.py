#!/usr/bin/env python3
"""Verify an admin-agent file write/read without installing or restarting anything.

Run beside repair-openjarvis-tools.py on the authorized VPS. Two ordinary agent
requests, no retries, no tool/approval/config changes. A private, unique report
directory is retained for inspection, even after ambiguous execution. This is
VPS acceptance only, not website, physical-device or full-parity acceptance.
"""

import hashlib
import importlib.util
import json
import os
import pwd
import re
import shlex
import socket
import stat
import tempfile
import uuid
from pathlib import Path

ROOT = Path("/home/jarvis/.openjarvis")
SERVICE = "openjarvis.service"
MAX_BYTES = 4096


def receipt(result, name, expected):
    """Only one complete, successful, exact runtime result is accepted."""
    if not isinstance(result, dict):
        return False
    value = result.get("execution")
    if not isinstance(value, dict):
        return False
    rows = value.get("tools")
    return (
        value.get("contract") == "openjarvis-execution/v1"
        and value.get("mode") == "agent"
        and type(value.get("tool_count")) is int
        and value["tool_count"] == 1
        and type(value.get("failed_count")) is int
        and value["failed_count"] == 0
        and value.get("truncated") is False
        and isinstance(rows, list)
        and len(rows) == 1
        and isinstance(rows[0], dict)
        and rows[0].get("name") == name
        and rows[0].get("success") is True
        and rows[0].get("truncated") is False
        and rows[0].get("output", "").strip() == expected.strip()
    )


def inspect_file(directory, expected, owner):
    """Open via directory FD: never follow a replaced directory/file or FIFO."""
    flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
    parent = os.open(directory, flags | os.O_DIRECTORY)
    try:
        folder = os.fstat(parent)
        if folder.st_uid != owner or stat.S_IMODE(folder.st_mode) != 0o700:
            raise ValueError("unexpected_artifact_directory")
        fd = os.open("report.md", flags, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_uid != owner
                or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_size != len(expected)
                or info.st_size > MAX_BYTES
            ):
                raise ValueError("unexpected_artifact_file")
            content = os.read(fd, MAX_BYTES + 1)
            if content != expected:
                raise ValueError("artifact_bytes_mismatch")
            return hashlib.sha256(content).hexdigest()
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def request_id(result):
    value = result.get("id") if isinstance(result, dict) else None
    return (
        value
        if isinstance(value, str)
        and re.fullmatch(r"chatcmpl-[a-zA-Z0-9-]{1,80}", value)
        else None
    )


def verify(api, directory, owner, env, runtime, nonce):
    path = directory / "report.md"
    names = (runtime.get("runtime") or {}).get("tool_names") or []
    safe_names = sorted(
        {
            name
            for name in names
            if isinstance(name, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,60}", name)
        }
    )
    content = (
        "# FIRBO server execution acceptance\n\n"
        f"Reference: {nonce}\n"
        "Service: openjarvis.service\n"
        f"Loaded tools: {len(safe_names)}\n"
        f"Inventory sample: {', '.join(safe_names[:12]) or 'not reported'}\n"
        "This report is a controlled file write/read acceptance task.\n"
        "It does not certify website delivery, browser control, provider billing,\n"
        "customer isolation or production readiness.\n"
    ).encode()
    expected_sha = hashlib.sha256(content).hexdigest()
    # Constant program, safely shell-quoted arguments; no arbitrary prompt-derived
    # path or executable. Exclusive creation prevents overwriting an existing file.
    program = (
        "import os,sys,hashlib; "
        "p,b=sys.argv[1],bytes.fromhex(sys.argv[2]); "
        "f=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600); "
        "s=os.fdopen(f,'wb'); s.write(b); s.flush(); os.fsync(s.fileno()); s.close(); "
        "print(hashlib.sha256(b).hexdigest())"
    )
    command = shlex.join(
        [str(api.PYTHON), "-B", "-c", program, str(path), content.hex()]
    )

    def ask(prompt):
        return api.local_request(
            api.SERVICES[SERVICE],
            env["OPENJARVIS_API_KEY"],
            "/v1/chat/completions",
            {
                "model": runtime["model"],
                "stream": False,
                "max_tokens": 1024,
                "firbo_include_execution": True,
                "messages": [{"role": "user", "content": prompt}],
            },
            timeout=145,
        )

    outcome = {
        "service": SERVICE,
        "reference": nonce,
        "artifact_path": str(path),
        "artifact_verified": False,
        "website_delivery_verified": False,
        "configuration_changed": False,
        "full_parity_complete": False,
    }
    created = ask(
        "Create this single acceptance report using shell_exec exactly once with "
        + json.dumps({"command": command, "timeout": 15, "working_dir": str(directory)})
        + ". Use no other tools. Do not read secrets, use the network "
        "or change other files. "
        "Preserve any required approval: if blocked, stop and report the block."
    )
    outcome["write_request_id"] = request_id(created)
    execution = created.get("execution") if isinstance(created, dict) else None
    tool_rows = execution.get("tools") if isinstance(execution, dict) else None
    outcome["approval_blocked"] = isinstance(tool_rows, list) and any(
        isinstance(row, dict)
        and row.get("success") is False
        and "confirmation" in str(row.get("output", "")).lower()
        for row in tool_rows
    )
    # Accept only the three known successful shell_exec renderings:
    # 1) direct/raw stdout, 2) Python subprocess fallback, 3) Rust backend.
    # The Rust tool includes the exit code and explicit stdout/stderr sections;
    # do not loosen this into substring matching because prose is not evidence.
    rust_stdout = (
        "Exit code: 0\n--- stdout ---\n"
        + expected_sha
        + "\n\n--- stderr ---"
    )
    outcome["write_receipt_verified"] = (
        receipt(created, "shell_exec", expected_sha)
        or receipt(created, "shell_exec", "=== STDOUT ===\n" + expected_sha)
        or receipt(created, "shell_exec", rust_stdout)
    )
    if not outcome["write_receipt_verified"] or not outcome["write_request_id"]:
        return {**outcome, "reason": "write_receipt_unverified_no_retry"}
    read = ask(
        "Use file_read exactly once with "
        + json.dumps({"path": str(path)})
        + ". Report the exact file content. Do not use other tools, change any file, "
        "use the network or bypass an approval."
    )
    outcome["read_request_id"] = request_id(read)
    outcome["read_receipt_verified"] = receipt(read, "file_read", content.decode())
    if (
        not outcome["read_receipt_verified"]
        or not outcome["read_request_id"]
        or outcome["read_request_id"] == outcome["write_request_id"]
    ):
        return {**outcome, "reason": "read_receipt_unverified_no_retry"}
    outcome["sha256"] = inspect_file(directory, content, owner)
    return {**outcome, "artifact_verified": True, "bytes": len(content)}


def main():
    if os.geteuid() != 0 or socket.gethostname() != "srv2027143":
        raise ValueError("run_as_root_on_srv2027143")
    helper = Path(__file__).with_name("repair-openjarvis-tools.py")
    spec = importlib.util.spec_from_file_location("repair", helper)
    api = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(api)
    env, runtime = api.info(SERVICE)
    names = (runtime.get("runtime") or {}).get("tool_names") or []
    if not {"shell_exec", "file_read"}.issubset(names):
        raise ValueError("required_tools_not_loaded_no_configuration_change")
    if ROOT.is_symlink() or ROOT.resolve() != ROOT or not ROOT.is_dir():
        raise ValueError("unexpected_report_parent")
    user = pwd.getpwnam("jarvis")
    directory = Path(tempfile.mkdtemp(prefix="firbo-acceptance-", dir=ROOT))
    os.chown(directory, user.pw_uid, user.pw_gid)
    # Print the safe path first so an ambiguous timeout remains reconcilable.
    print(
        json.dumps({"artifact_directory": str(directory), "phase": "before_request"}),
        flush=True,
    )
    outcome = verify(api, directory, user.pw_uid, env, runtime, uuid.uuid4().hex)
    print(json.dumps(outcome, indent=2))
    return 0 if outcome["artifact_verified"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Never dump upstream bodies, tool prose, process environment or credentials.
        print(
            json.dumps(
                {
                    "artifact_verified": False,
                    "error_type": type(error).__name__,
                    "retry_performed": False,
                    "configuration_changed": False,
                }
            )
        )
        raise SystemExit(1) from None
