#!/usr/bin/env python3
"""Read-only local gateway tool-contract probe; never executes returned tools."""

import json
import socket
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

import tomllib


def probe(base, key, model, choice):
    body = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": "Call firbo_probe with marker FIRBO_TOOL_PROBE_OK.",
            }
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "firbo_probe",
                    "description": "A harmless diagnostic marker.",
                    "parameters": {
                        "type": "object",
                        "properties": {"marker": {"type": "string"}},
                        "required": ["marker"],
                    },
                },
            }
        ],
        "tool_choice": choice,
        "stream": False,
        "max_tokens": 128,
    }
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = "Bearer " + key
    try:
        request = Request(
            base.rstrip("/") + "/chat/completions",
            data=json.dumps(body).encode(),
            headers=headers,
        )
        with urlopen(request, timeout=45) as response:
            result = json.load(response)
        choices = result.get("choices", [])
        message = choices[0].get("message", {}) if choices else {}
        calls = message.get("tool_calls") or []
        valid = any(
            call.get("function", {}).get("name") == "firbo_probe" for call in calls
        )
        return {
            "http": 200,
            "tool_calls": len(calls),
            "probe_call": valid,
            "finish_reason": choices[0].get("finish_reason") if choices else None,
        }
    except HTTPError as error:
        return {"http": error.code, "probe_call": False}
    except Exception as error:
        return {"error_type": type(error).__name__, "probe_call": False}


def main():
    if socket.gethostname() != "srv2027143":
        raise RuntimeError("Run on srv2027143")
    home = Path("/home/jarvis/.openjarvis")
    values = dict(
        line.split("=", 1)
        for line in (home / "serve.env").read_text().splitlines()
        if "=" in line and not line.lstrip().startswith("#")
    )
    values = {key: value.strip().strip("'\"") for key, value in values.items()}
    config = tomllib.loads((home / "config.toml").read_text())
    gateway = config.get("engine", {}).get("omniroute", {})
    host = (
        values.get("OMNIROUTE_HOST") or gateway.get("host") or "http://localhost:20128"
    )
    url = urlsplit(host)
    if url.hostname not in {"localhost", "127.0.0.1", "::1"} or url.scheme != "http":
        raise RuntimeError(
            "Gateway is not a local HTTP endpoint; configuration preserved"
        )
    base = host.rstrip("/")
    if not base.endswith("/v1"):
        base += "/v1"
    key = values.get("OMNIROUTE_API_KEY", "")
    results = {}
    for choice in ("auto", "required"):
        results[choice] = probe(base, key, "firbo-quality", choice)
    print(
        json.dumps(
            {
                "gateway_probe": results,
                "tools_executed": False,
                "configuration_changed": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"probe_failed": type(error).__name__}))
        raise SystemExit(1) from None
