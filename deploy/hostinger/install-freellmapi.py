#!/usr/bin/env python3
"""Install only the pinned FreeLLMAPI service on the verified owner's VPS.

Run as root. No provider keys are imported and no inference is sent.
Existing Firbo Compose configuration and containers are not recreated.
"""

import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
from pathlib import Path

IMAGE = (
    "ghcr.io/tashfeenahmed/freellmapi@sha256:"
    "543cedc189d589c69a46018552ae60e38f5685ed7ef62ff4a591fbb5bcb3fc1a"
)
DIRECTORY = Path("/opt/firbo-freellmapi")
NETWORK = "hostinger_default"
PROJECT = "firbo-freellmapi"
CONTAINER = "firbo-freellmapi"
VOLUME = "firbo-freellmapi-data"
EXISTING = ("firbo-api", "firbo-omniroute", "firbo-caddy", "firbo-redis")


def run(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Never print arbitrary Docker/entrypoint output containing credentials.
        raise RuntimeError("command_failed: " + " ".join(args[:3]))
    return result.stdout.strip()


def identifiers():
    return {
        name: run(["docker", "inspect", "--format", "{{.Id}}", name])
        for name in EXISTING
    }


def compose():
    return {
        "services": {
            "freellmapi": {
                "image": IMAGE,
                "container_name": CONTAINER,
                "user": "1000:1000",
                "restart": "unless-stopped",
                "env_file": [".env.freellmapi"],
                "environment": {
                    "NODE_ENV": "production",
                    "PORT": "3001",
                    "FREEAPI_CONFIG_PATH": "/run/freellmapi/bootstrap.json",
                    "FALLBACK_TIME_BUDGET_MS": "15000",
                    "TTFB_BUDGET_DISABLED": "1",
                    "MAX_CONSECUTIVE_UPSTREAM_FAILS": "2",
                    "RESPONSE_CACHE": "false",
                    "RESPONSE_CACHE_PERSIST": "false",
                    "FREELLMAPI_COMPRESSION": "off",
                    "FREEAPI_BLOCK_PRIVATE_PROVIDER_URLS": "true",
                    "FREELLMAPI_UPDATE_CHECK": "off",
                    "REQUEST_ANALYTICS_RETENTION_DAYS": "7",
                    "REQUEST_ANALYTICS_MAX_ROWS": "10000",
                },
                "ports": ["127.0.0.1:3001:3001"],
                "volumes": [
                    "data:/app/server/data",
                    "./bootstrap.json:/run/freellmapi/bootstrap.json:ro",
                ],
                "networks": {"gateway": {"aliases": ["freellmapi"]}},
                "mem_limit": "512m",
                "cpus": "0.50",
                "pids_limit": 128,
                "security_opt": ["no-new-privileges:true"],
                "cap_drop": ["ALL"],
                "logging": {
                    "driver": "json-file",
                    "options": {"max-size": "10m", "max-file": "3"},
                },
                "healthcheck": {
                    "test": [
                        "CMD",
                        "node",
                        "-e",
                        "fetch('http://127.0.0.1:3001/api/ping')"
                        ".then(r=>{if(!r.ok)process.exit(1)})"
                        ".catch(()=>process.exit(1))",
                    ],
                    "interval": "10s",
                    "timeout": "5s",
                    "start_period": "30s",
                    "retries": 6,
                },
            }
        },
        "volumes": {"data": {"name": VOLUME}},
        "networks": {"gateway": {"external": True, "name": NETWORK}},
    }


def write_private(path, content, owner=None):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as stream:
        stream.write(content)
    if owner is not None:
        os.chown(path, owner, owner)


def main():
    if os.geteuid() != 0 or socket.gethostname() != "srv2027143":
        raise RuntimeError("run_as_root_on_srv2027143")
    if DIRECTORY.exists():
        raise RuntimeError("existing_install_directory_preserved; report_status_first")
    if shutil.disk_usage("/opt").free < 2 * 1024**3:
        raise RuntimeError("insufficient_free_disk")
    available = next(
        int(line.split()[1])
        for line in Path("/proc/meminfo").read_text().splitlines()
        if line.startswith("MemAvailable:")
    )
    if available < 1024**2:
        raise RuntimeError("less_than_1_GiB_available_RAM")
    run(["docker", "compose", "version"])
    run(["docker", "image", "inspect", IMAGE])
    before = identifiers()
    networks = json.loads(
        run(
            [
                "docker",
                "inspect",
                "--format",
                "{{json .NetworkSettings.Networks}}",
                "firbo-omniroute",
            ]
        )
    )
    if NETWORK not in networks:
        raise RuntimeError("verified_gateway_network_missing")
    names = run(["docker", "ps", "-a", "--format", "{{.Names}}"]).splitlines()
    volumes = run(["docker", "volume", "ls", "--format", "{{.Name}}"]).splitlines()
    if CONTAINER in names or VOLUME in volumes:
        raise RuntimeError("existing_freellmapi_resources_preserved")
    with socket.socket() as check:
        check.bind(("127.0.0.1", 3001))
    # Docker copies the image's node-owned data directory into the NEW volume.
    # Starting as node avoids privileged entrypoint operations with cap_drop ALL.
    DIRECTORY.mkdir(mode=0o700)
    admin = {"email": "admin@firboai.app", "password": secrets.token_urlsafe(32)}
    write_private(
        DIRECTORY / ".env.freellmapi", "ENCRYPTION_KEY=" + secrets.token_hex(32) + "\n"
    )
    write_private(DIRECTORY / "bootstrap.json", json.dumps({"admin": admin}), 1000)
    write_private(DIRECTORY / "admin-login.json", json.dumps(admin, indent=2) + "\n")
    write_private(DIRECTORY / "compose.json", json.dumps(compose(), indent=2) + "\n")
    command = [
        "docker",
        "compose",
        "-p",
        PROJECT,
        "-f",
        str(DIRECTORY / "compose.json"),
    ]
    run(command + ["config", "--quiet"])
    run(
        command
        + [
            "up",
            "-d",
            "--no-deps",
            "--pull",
            "never",
            "--wait",
            "--wait-timeout",
            "120",
            "freellmapi",
        ],
        timeout=150,
    )
    state = run(
        ["docker", "inspect", "--format", "{{.State.Health.Status}}", CONTAINER]
    )
    if state != "healthy" or identifiers() != before:
        raise RuntimeError("health_or_existing_container_identity_check_failed")
    print(
        json.dumps(
            {
                "installed": True,
                "health": state,
                "existing_containers_preserved": True,
                "image": IMAGE,
                "dashboard": "http://127.0.0.1:3001",
                "omniroute_base_url": "http://freellmapi:3001/v1",
                "credentials_file": str(DIRECTORY / "admin-login.json"),
                "provider_keys_configured": False,
                "inference_verified": False,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
        print(
            json.dumps(
                {
                    "installed": False,
                    "error": str(error),
                    "existing_files_retained": True,
                }
            ),
            file=sys.stderr,
        )
        sys.exit(1)
