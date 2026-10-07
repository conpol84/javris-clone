"""Credential recovery with fictional keys, temporary files and mocked processes.

No Docker daemon, systemd, network, provider, password or live key is accessed.
"""

from __future__ import annotations

import importlib.util
import io
import json
import stat
import warnings
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "gateway_credentials", ROOT / "deploy/hostinger/gateway-credentials.py"
)
assert SPEC and SPEC.loader
credentials = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(credentials)
REAL_PREFLIGHT_API = credentials.preflight_api

NEW_KEYS = {
    "OMNIROUTE_API_KEY": "synthetic-inference-key-20261005",
    "OMNIROUTE_MANAGEMENT_KEY": "synthetic-management-key-20261005",
}
ORIGINAL = (
    b"# synthetic fixture only\n"
    b"OMNIROUTE_API_KEY=synthetic-old-inference\n"
    b"OMNIROUTE_MANAGEMENT_KEY=synthetic-old-management\n"
    b"OPENJARVIS_API_KEY=synthetic-native-unrelated-key\n"
    b"STORAGE_ENCRYPTION_KEY=synthetic-preserved-encryption\n"
)
ACCEPTED = {
    "management_http": 200,
    "inference_http": 200,
    "inference_management_http": 403,
}


@pytest.fixture
def stack(tmp_path, monkeypatch):
    config = tmp_path / "docker-compose.yml"
    config.write_text("# synthetic compose fixture")
    env = tmp_path / ".env"
    env.write_bytes(ORIGINAL)
    env.chmod(0o600)
    result = {
        "directory": tmp_path,
        "project": "synthetic_firbo",
        "files": [config],
        "env_path": env,
    }
    monkeypatch.setattr(
        credentials,
        "preflight_api",
        lambda _: {
            "original_env": env.read_bytes(),
            "files": {config: config.read_bytes()},
        },
    )
    return result


def test_default_inspection_never_prints_credential_values(stack, monkeypatch, capsys):
    monkeypatch.setattr(credentials, "runtime", lambda: stack)
    monkeypatch.setattr(
        credentials,
        "native_environment_paths",
        lambda n: {"service": n, "available": False},
    )
    assert credentials.main([]) == 0
    out = capsys.readouterr().out
    report = json.loads(out)
    assert report["credential_present"]["OPENJARVIS_API_KEY"] is True
    assert report["gateway_keys_distinct"] is True
    assert "synthetic-old" not in out and "unrelated-key" not in out
    assert stack["env_path"].read_bytes() == ORIGINAL


def test_runtime_discovers_exact_shared_stack_with_no_environment_inspection(
    stack, monkeypatch
):
    calls = []

    def docker_json(args, payload=None):
        calls.append(args)
        name = args[-1]
        return {
            "name": "/" + name,
            "running": True,
            "labels": {
                "com.docker.compose.service": "omniroute"
                if name == "firbo-omniroute"
                else "firbo-api",
                "com.docker.compose.project.working_dir": str(stack["directory"]),
                "com.docker.compose.project": stack["project"],
                "com.docker.compose.project.config_files": str(stack["files"][0]),
            },
        }

    monkeypatch.setattr(credentials, "docker_json", docker_json)
    assert credentials.runtime() == stack
    assert all("Config.Env" not in " ".join(args) for args in calls)


def test_mixed_stack_is_rejected(stack, monkeypatch):
    def docker_json(args, payload=None):
        name = args[-1]
        return {
            "name": "/" + name,
            "running": True,
            "labels": {
                "com.docker.compose.service": "omniroute"
                if name == "firbo-omniroute"
                else "firbo-api",
                "com.docker.compose.project.working_dir": str(stack["directory"]),
                "com.docker.compose.project": name,
                "com.docker.compose.project.config_files": str(stack["files"][0]),
            },
        }

    monkeypatch.setattr(credentials, "docker_json", docker_json)
    with pytest.raises(credentials.Blocked, match="mixed_compose_projects"):
        credentials.runtime()


def test_api_only_native_overlays_are_preserved(stack, monkeypatch):
    overlay = stack["directory"] / "compose.synthetic-native.yaml"
    overlay.write_text("# synthetic native overlay")

    def docker_json(args, payload=None):
        name = args[-1]
        files = [str(stack["files"][0])]
        if name == "firbo-api":
            files.append(str(overlay))
        return {
            "name": "/" + name,
            "running": True,
            "labels": {
                "com.docker.compose.service": "omniroute"
                if name == "firbo-omniroute"
                else "firbo-api",
                "com.docker.compose.project.working_dir": str(stack["directory"]),
                "com.docker.compose.project": stack["project"],
                "com.docker.compose.project.config_files": ",".join(files),
            },
        }

    monkeypatch.setattr(credentials, "docker_json", docker_json)
    assert credentials.runtime()["files"] == [stack["files"][0], overlay]


@pytest.mark.parametrize(
    "field,status,code",
    [
        ("management_http", 403, "management_key_not_accepted"),
        ("inference_http", 401, "inference_key_not_accepted"),
        ("inference_management_http", 200, "scope_unverified"),
        ("inference_management_http", 500, "scope_unverified"),
    ],
)
def test_invalid_scopes_never_write_or_restart(stack, monkeypatch, field, status, code):
    monkeypatch.setattr(
        credentials, "docker_json", lambda *_: {**ACCEPTED, field: status}
    )
    monkeypatch.setattr(
        credentials, "recreate_api", lambda *_: pytest.fail("must not restart")
    )
    with pytest.raises(credentials.Blocked, match=code):
        credentials.set_keys(stack, NEW_KEYS)
    assert stack["env_path"].read_bytes() == ORIGINAL
    assert not (stack["directory"] / ".gateway-credential-backups").exists()


@pytest.mark.parametrize(
    "key",
    ["short", "synthetic-$HOME-injection", "synthetic-key\nline", "synthetic-#comment"],
)
def test_unsafe_key_format_is_rejected_before_docker(monkeypatch, key):
    monkeypatch.setattr(
        credentials, "docker_json", lambda *_: pytest.fail("must not call Docker")
    )
    with pytest.raises(credentials.Blocked, match="invalid_gateway_key_format"):
        credentials.check_keys({**NEW_KEYS, "OMNIROUTE_API_KEY": key})


def test_shared_key_rejected_before_docker(monkeypatch):
    monkeypatch.setattr(
        credentials, "docker_json", lambda *_: pytest.fail("must not call Docker")
    )
    with pytest.raises(credentials.Blocked, match="must_be_distinct"):
        credentials.check_keys(
            dict.fromkeys(credentials.KEY_NAMES, NEW_KEYS["OMNIROUTE_API_KEY"])
        )


def test_valid_keys_private_backup_atomic_write_and_truthful_consumer_notice(
    stack, monkeypatch
):
    monkeypatch.setattr(credentials, "docker_json", lambda *_: ACCEPTED)
    restarts = []
    monkeypatch.setattr(credentials, "recreate_api", lambda s: restarts.append(s))
    monkeypatch.setattr(credentials, "verify_api", lambda k: restarts.append(k))
    report = credentials.set_keys(stack, NEW_KEYS)
    saved = Path(report["private_backup"])
    assert saved.read_bytes() == ORIGINAL
    assert stat.S_IMODE(saved.stat().st_mode) == 0o600
    assert stat.S_IMODE(saved.parent.stat().st_mode) == 0o700
    assert stat.S_IMODE(stack["env_path"].stat().st_mode) == 0o600
    current = stack["env_path"].read_text()
    assert "STORAGE_ENCRYPTION_KEY=synthetic-preserved-encryption" in current
    assert "OPENJARVIS_API_KEY=synthetic-native-unrelated-key" in current
    assert restarts == [stack, NEW_KEYS]
    assert report["supabase_inference_secret_update_required"] is True
    assert report["old_keys_not_revoked"] is True
    assert not any(value in json.dumps(report) for value in NEW_KEYS.values())


def test_failed_recreate_restores_env_and_verifies_old_runtime(stack, monkeypatch):
    monkeypatch.setattr(credentials, "docker_json", lambda *_: ACCEPTED)
    attempts = []

    def recreate(_):
        attempts.append("restart")
        if len(attempts) == 1:
            raise credentials.Blocked("synthetic_restart_failure")

    monkeypatch.setattr(credentials, "recreate_api", recreate)
    monkeypatch.setattr(credentials, "verify_api", lambda keys: attempts.append(keys))
    with pytest.raises(credentials.Blocked, match="env_and_previous_runtime_restored"):
        credentials.set_keys(stack, NEW_KEYS)
    assert stack["env_path"].read_bytes() == ORIGINAL
    assert attempts[-1] == {
        "OMNIROUTE_API_KEY": "synthetic-old-inference",
        "OMNIROUTE_MANAGEMENT_KEY": "synthetic-old-management",
    }


def test_failed_rollback_never_claims_runtime_restored(stack, monkeypatch):
    monkeypatch.setattr(credentials, "docker_json", lambda *_: ACCEPTED)
    monkeypatch.setattr(
        credentials,
        "recreate_api",
        lambda _: (_ for _ in ()).throw(credentials.Blocked("failure")),
    )
    with pytest.raises(credentials.Blocked, match="env_restored_runtime_unverified"):
        credentials.set_keys(stack, NEW_KEYS)
    assert stack["env_path"].read_bytes() == ORIGINAL


def test_concurrent_edit_is_preserved_on_failure(stack, monkeypatch):
    monkeypatch.setattr(credentials, "docker_json", lambda *_: ACCEPTED)

    def recreate(_):
        stack["env_path"].write_text("# synthetic concurrent operator edit\n")
        raise credentials.Blocked("failure")

    monkeypatch.setattr(credentials, "recreate_api", recreate)
    with pytest.raises(credentials.Blocked, match="configuration_changed_no_rollback"):
        credentials.set_keys(stack, NEW_KEYS)
    assert "concurrent operator edit" in stack["env_path"].read_text()


def test_symlink_env_and_backup_directories_are_rejected(stack):
    target = stack["directory"] / "synthetic-env"
    target.write_bytes(ORIGINAL)
    stack["env_path"].unlink()
    stack["env_path"].symlink_to(target)
    with pytest.raises(credentials.Blocked, match="symlinked"):
        credentials.read_private(stack["env_path"])
    directory = stack["directory"] / ".gateway-credential-backups"
    directory.symlink_to(stack["directory"], target_is_directory=True)
    with pytest.raises(credentials.Blocked, match="symlinked"):
        credentials.backup(target, ORIGINAL)


def test_duplicate_key_lines_are_rejected():
    with pytest.raises(credentials.Blocked, match="duplicate_credential"):
        credentials.updated_env(
            ORIGINAL + b"OMNIROUTE_API_KEY=synthetic-duplicate\n", NEW_KEYS
        )


def test_recreate_uses_original_compose_files_without_pull_build_or_other_services(
    stack, monkeypatch
):
    calls = []
    monkeypatch.setattr(
        credentials, "docker", lambda args, data=None: calls.append(args)
    )
    credentials.recreate_api(stack)
    args = calls[0]
    assert args[-1] == "firbo-api"
    assert "--no-deps" in args and "--no-build" in args
    assert args[args.index("--pull") + 1] == "never"
    assert str(stack["files"][0]) in args
    assert "omniroute" not in args


def test_dashboard_reset_password_only_on_stdin_and_session_limit_honest(
    stack, monkeypatch
):
    calls = []
    monkeypatch.setattr(
        credentials, "docker_json", lambda *_: {"stdin_supported": True}
    )
    monkeypatch.setattr(
        credentials, "docker", lambda args, data=None: calls.append((args, data))
    )
    password = "Synthetic-Pass-Only-2026"
    report = credentials.reset_dashboard(stack, password, password)
    assert calls[0][1] == password.encode()
    assert all(password not in " ".join(args) for args, _ in calls)
    assert calls[1][0] == ["restart", "firbo-omniroute"]
    assert report["existing_sessions_not_revoked_by_cli"] is True
    assert report["gateway_health_verified"] is True
    assert password not in json.dumps(report)


@pytest.mark.parametrize(
    "password,confirm",
    [
        ("short", "short"),
        ("Synthetic-pass-2026", "different"),
        ("Synthetic\npass-2026", "Synthetic\npass-2026"),
        ("x" * 73, "x" * 73),
        ("Ω" * 37, "Ω" * 37),
    ],
)
def test_invalid_dashboard_password_never_reaches_docker(
    stack, monkeypatch, password, confirm
):
    monkeypatch.setattr(
        credentials, "docker_json", lambda *_: pytest.fail("must not call Docker")
    )
    with pytest.raises(credentials.Blocked):
        credentials.reset_dashboard(stack, password, confirm)


def test_reset_restart_failure_reports_password_already_changed(stack, monkeypatch):
    monkeypatch.setattr(
        credentials, "docker_json", lambda *_: {"stdin_supported": True}
    )

    def docker(args, data=None):
        if args[0] == "restart":
            raise credentials.Blocked("synthetic_failure")
        return b""

    monkeypatch.setattr(credentials, "docker", docker)
    with pytest.raises(
        credentials.Blocked, match="password_changed_gateway_restart_or_health_failed"
    ):
        credentials.reset_dashboard(stack, "Synthetic-pass-2026", "Synthetic-pass-2026")


def test_secret_input_refuses_pipe_without_getpass(stack, monkeypatch, capsys):
    monkeypatch.setattr(credentials, "runtime", lambda: stack)
    monkeypatch.setattr(
        credentials.sys, "stdin", io.StringIO("synthetic-unused-piped-secret")
    )
    monkeypatch.setattr(
        credentials.getpass, "getpass", lambda _: pytest.fail("must not prompt")
    )
    assert credentials.main(["reset-dashboard"]) == 1
    assert "local_terminal_required" in capsys.readouterr().err


def test_subprocess_uses_local_docker_and_discards_error_output(monkeypatch):
    monkeypatch.setattr(credentials.shutil, "which", lambda _: "/usr/bin/docker")
    monkeypatch.setenv("DOCKER_HOST", "tcp://synthetic-untrusted.invalid:2375")
    monkeypatch.setenv("OMNIROUTE_API_KEY", "synthetic-stale-export")
    captured = []

    def run(args, **kwargs):
        captured.append((args, kwargs))
        return SimpleNamespace(returncode=1, stdout=b"synthetic-secret-in-error")

    monkeypatch.setattr(credentials.subprocess, "run", run)
    with pytest.raises(credentials.Blocked, match="^local_command_failed$"):
        credentials.docker(
            ["exec", "-i", "firbo-api", "python"], b"synthetic-stdin-only"
        )
    args, kwargs = captured[0]
    assert args[1:3] == ["--host", "unix:///var/run/docker.sock"]
    assert "DOCKER_HOST" not in kwargs["env"]
    assert "OMNIROUTE_API_KEY" not in kwargs["env"]
    assert kwargs["stderr"] == credentials.subprocess.DEVNULL
    assert kwargs["input"] == b"synthetic-stdin-only"


def test_hidden_input_never_falls_back_to_echo(monkeypatch):
    def getpass(prompt):
        warnings.warn(
            "synthetic terminal echo warning", credentials.getpass.GetPassWarning
        )
        pytest.fail("warning must abort before reading input")

    monkeypatch.setattr(credentials.getpass, "getpass", getpass)
    with pytest.raises(credentials.Blocked, match="terminal_hidden_input_unavailable"):
        credentials.hidden_input("Synthetic prompt: ")


def test_private_backup_names_are_excluded_from_repository():
    ignored = (ROOT / ".gitignore").read_text()
    assert "**/.gateway-credential-backups/" in ignored
    assert "**/.firbo-credential-*" in ignored


@pytest.mark.parametrize(
    "drift,expected",
    [
        (None, None),
        ("image", "image_drift"),
        ("environment", "environment_drift"),
        ("command", "runtime_drift"),
        ("mount", "mount_drift"),
        ("network", "network_drift"),
    ],
)
def test_credential_recreate_refuses_stale_runtime_without_writing(
    stack, monkeypatch, drift, expected
):
    configured = credentials.values(ORIGINAL)
    service = {
        "container_name": "firbo-api",
        "image": "synthetic-installed-image",
        "environment": configured,
        "command": ["synthetic-serve"],
        "volumes": [],
    }
    current = {
        "image": "sha256:" + "a" * 64,
        "config": {
            "Env": [f"{n}={v}" for n, v in configured.items()],
            "Cmd": ["synthetic-serve"],
        },
        "mounts": [],
        "networks": {"synthetic_firbo_default": {}},
        "privileged": False,
        "ports": {},
    }
    if drift == "environment":
        service["environment"] = {
            **configured,
            "OPENJARVIS_API_KEY": "synthetic-drifted-key",
        }
    elif drift == "command":
        service["command"] = ["synthetic-different-runtime"]
    elif drift == "mount":
        service["volumes"] = [
            {"type": "bind", "source": "/synthetic", "target": "/synthetic"}
        ]
    elif drift == "network":
        current["networks"] = {"synthetic_different_network": {}}

    def docker_json(args, payload=None):
        if args[0] == "container":
            return current
        if args[0] == "compose":
            return {
                "services": {"firbo-api": service},
                "networks": {"default": {"name": "synthetic_firbo_default"}},
            }
        assert args[0] == "image"
        return {"image": "sha256:" + ("b" if drift == "image" else "a") * 64}

    monkeypatch.setattr(credentials, "docker_json", docker_json)
    if expected:
        with pytest.raises(credentials.Blocked, match=expected):
            REAL_PREFLIGHT_API(stack)
    else:
        assert REAL_PREFLIGHT_API(stack)["original_env"] == ORIGINAL
    assert stack["env_path"].read_bytes() == ORIGINAL


def test_scope_probe_has_no_real_network_and_returns_only_statuses(monkeypatch, capsys):
    statuses = iter([200, 200, 403])

    class FakeConnection:
        def __init__(self, host, port, timeout):
            assert (host, port) == ("omniroute", 20128)

        def request(self, method, path, headers):
            assert method == "GET"
            assert headers["Authorization"].startswith("Bearer synthetic-")

        def getresponse(self):
            return SimpleNamespace(status=next(statuses))

        def close(self):
            pass

    import http.client

    monkeypatch.setattr(http.client, "HTTPConnection", FakeConnection)
    monkeypatch.setattr(credentials.sys, "stdin", io.StringIO(json.dumps(NEW_KEYS)))
    exec(compile(credentials.KEY_PROBE, "<synthetic-local-probe>", "exec"), {})
    assert json.loads(capsys.readouterr().out) == ACCEPTED


def test_setup_no_longer_reuses_management_key_or_suppresses_restart_failures():
    script = (ROOT / "deploy/hostinger/setup-gateway.sh").read_text()
    assert "put it on BOTH" not in script
    assert "setenv(" not in script
    assert "|| true" not in script
    assert "check-gateway-keys --require-directory" in script
    # Compile its embedded Python instead of running gateway operations.
    embedded = (
        script.split("python3 - <<'PY'", 1)[1].split("\n", 1)[1].rsplit("\nPY\n", 1)[0]
    )
    compile(embedded, "<setup-gateway-python>", "exec")
