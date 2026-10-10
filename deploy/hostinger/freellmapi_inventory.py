"""Read-only Docker identity and isolation audit for the existing FreeLLMAPI VPS.

Only asks docker inspect for explicitly selected non-secret fields. No container
mutation, shell, volumes, environment, credentials, logs, or provider calls.
"""

import json
import subprocess

CONTAINER = "firbo-freellmapi"
GATEWAY_NETWORK = "hostinger_default"
REVIEWED_IMAGE = (
    "ghcr.io/tashfeenahmed/freellmapi@sha256:"
    "543cedc189d589c69a46018552ae60e38f5685ed7ef62ff4a591fbb5bcb3fc1a"
)

INSPECT_FIELDS = {
    "state": "State",
    "image": "Config.Image",
    "user": "Config.User",
    "ports": "HostConfig.PortBindings",
    "networks": "NetworkSettings.Networks",
    "privileged": "HostConfig.Privileged",
    "capdrop": "HostConfig.CapDrop",
    "security": "HostConfig.SecurityOpt",
    "restart": "HostConfig.RestartPolicy.Name",
}


def field(name):
    """No environment, mount contents or arbitrary Docker output is emitted."""
    if name not in INSPECT_FIELDS:
        raise ValueError("invalid_inventory_field")
    selection = INSPECT_FIELDS[name]
    args = [
        "docker",
        "inspect",
        "--type",
        "container",
        "--format",
        "{{json ." + selection + "}}",
        CONTAINER,
    ]
    result = subprocess.run(
        args, capture_output=True, text=True, timeout=6, check=False
    )
    if result.returncode != 0 or len(result.stdout) > 100_000:
        raise RuntimeError("container_inspect_unavailable")
    return json.loads(result.stdout)


def inventory():
    try:
        values = {name: field(name) for name in INSPECT_FIELDS}
    except (OSError, ValueError, TypeError, subprocess.SubprocessError, RuntimeError):
        return {"installed": False, "ready": False, "reason": "inspect_unavailable"}

    issues = []
    state = values["state"]
    if (
        not isinstance(state, dict)
        or state.get("Running") is not True
        or not isinstance(state.get("Health"), dict)
        or state["Health"].get("Status") != "healthy"
    ):
        issues.append("service_not_healthy")
    if values["image"] != REVIEWED_IMAGE:
        issues.append("image_digest_not_reviewed")
    if values["user"] != "1000:1000":
        issues.append("container_user_drift")

    ports = values["ports"]
    expected_port = {"3001/tcp": [{"HostIp": "127.0.0.1", "HostPort": "3001"}]}
    if ports != expected_port:
        issues.append("listener_not_loopback_only")
    networks = values["networks"]
    if not isinstance(networks, dict) or set(networks) != {GATEWAY_NETWORK}:
        issues.append("network_isolation_drift")
    if values["privileged"] is not False:
        issues.append("privileged_container")
    capdrop = values["capdrop"]
    if not isinstance(capdrop, list) or "all" not in {
        str(item).lower() for item in capdrop
    }:
        issues.append("linux_capabilities_not_dropped")
    security = values["security"]
    if not isinstance(security, list) or not any(
        str(value).startswith("no-new-privileges") for value in security
    ):
        issues.append("no_new_privileges_missing")
    if values["restart"] != "unless-stopped":
        issues.append("restart_policy_drift")

    return {
        "installed": True,
        "ready": len(issues) == 0,
        "health_verified": "service_not_healthy" not in issues,
        "network_isolation_verified": (
            "network_isolation_drift" not in issues
            and "listener_not_loopback_only" not in issues
        ),
        "reviewed_image_verified": "image_digest_not_reviewed" not in issues,
        "inference_verified": False,
        "provider_cost_verified": False,
        "issues": issues,
    }


if __name__ == "__main__":
    report = inventory()
    print(json.dumps(report))
    raise SystemExit(0 if report["ready"] else 1)
