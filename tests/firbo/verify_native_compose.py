"""CI-only review of Docker Compose's evaluated native API opt-in.

Takes ONLY synthetic docker-compose config JSON generated in CI. Never opens
production Compose .env, prints credentials, or contacts a live service.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def verify(mode: str, path: str) -> None:
    if mode not in {"default", "opt-in"}:
        raise ValueError("unrecognized_test_mode")
    parsed = json.loads(Path(path).read_text(encoding="utf-8"))
    api = parsed["services"]["firbo-api"]
    assert api["build"]["args"]["FIRBO_NATIVE_ROUTE_ATTEST"] == "1"
    assert api["entrypoint"] == ["python", "-m", "uvicorn"]
    assert api["command"][1:] == ["--host", "0.0.0.0", "--port", "8000"]

    env = api["environment"]
    if mode == "default":
        assert api["command"][0] == "openjarvis.server.firbo_app:app"
        assert str(env["FIRBO_FREE_ENABLED"]).lower() == "false"
        for name in (
            "FIRBO_FREE_ORGANIZATIONS",
            "FIRBO_FREE_LOCAL_MODELS",
            "FIRBO_FREE_LEDGER",
            "FIRBO_FREE_MODEL_DIGEST",
        ):
            assert env[name] == "", f"default must fail closed: {name}"
    else:
        assert api["command"][0] == "openjarvis.server.firbo_free_app:app"
        assert str(env["FIRBO_FREE_ENABLED"]).lower() == "true"
        assert env["FIRBO_FREE_ORGANIZATIONS"] == (
            "00000000-0000-4000-8000-000000000001"
        )
        assert env["FIRBO_FREE_LOCAL_MODELS"] == "qwen3:1.7b"
        assert env["FIRBO_FREE_LEDGER"] == "/home/openjarvis/local-ceo/ledger.sqlite3"
        assert env["FIRBO_FREE_MODEL_DIGEST"] == "a" * 64

    assert "firbo-api" not in api.get("ports", [])
    assert parsed["services"]["caddy"]["depends_on"].get("firbo-api")
    print("native_compose_gate_passed:" + mode)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: verify_native_compose.py [default|opt-in] config.json")
    verify(sys.argv[1], sys.argv[2])
