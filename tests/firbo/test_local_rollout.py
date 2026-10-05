"""Local rollout pure validation contracts; full Docker lifecycle is a separate job."""

import contextlib
import importlib.util
import io
import json
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlsplit

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "local_rollout", ROOT / "deploy/hostinger/local_model_rollout.py"
)
rollout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollout)


def test_exact_runtime_hashes():
    assert set(rollout.SOURCE_HASHES) == {
        "firbo_free_app.py",
        "free_inference.py",
        "local_tts.py",
    }
    for n, h in rollout.SOURCE_HASHES.items():
        assert rollout.sha((ROOT / "src/openjarvis/server" / n).read_bytes()) == h


def test_native_source_library_stays_pinned():
    assert (
        rollout.sha((ROOT / "deploy/hostinger/native_control_rollout.py").read_bytes())
        == rollout.NATIVE_SHA
    )


def test_actual_canary_accepts_current_runtime_and_denies_anonymous_requests(
    monkeypatch,
):
    from fastapi.testclient import TestClient

    from openjarvis.server.firbo_free_app import app

    requests = []

    def in_process_urlopen(request, *, timeout):
        url = urlsplit(request.full_url)
        assert (url.scheme, url.netloc) == ("http", "127.0.0.1:8000")
        requests.append((request.get_method(), url.path))
        response = client.request(
            request.get_method(),
            url.path,
            content=request.data,
            headers=dict(request.header_items()),
        )
        body = io.BytesIO(response.content)
        if response.status_code >= 400:
            raise urllib.error.HTTPError(
                request.full_url, response.status_code, response.reason_phrase, {}, body
            )
        body.code = response.status_code
        return body

    class InProcessCanary:
        def docker(self, *args, **kwargs):
            assert args == ("exec", "candidate", "python", "-c", rollout.CANARY)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                exec(compile(rollout.CANARY, "<rollout-canary>", "exec"), {})
            self.result = json.loads(output.getvalue())
            return output.getvalue()

    def unexpected_retry(seconds):
        pytest.fail("Current runtime must pass the first canary probe")

    monkeypatch.setattr(urllib.request, "urlopen", in_process_urlopen)
    monkeypatch.setattr(rollout.time, "sleep", unexpected_retry)
    probe = InProcessCanary()
    with TestClient(app) as client:
        assert rollout.check_api(probe, "candidate") is True
    assert probe.result["hashes"] == rollout.SOURCE_HASHES
    assert requests == [
        ("GET", "/health"),
        ("GET", "/v1/firbo/free/status"),
        ("POST", "/v1/firbo/free/chat/completions"),
        ("GET", "/v1/firbo/session"),
    ]


def test_admin_pilot_never_enables_customers_or_cloud():
    values = rollout.env_values("/ledger")
    assert values["FIRBO_FREE_ADMIN_PILOT"] == "true"
    assert (
        values["FIRBO_FREE_ORGANIZATIONS"]
        == values["FIRBO_FREE_CLOUD_ORGANIZATIONS"]
        == values["FIRBO_FREE_OPENROUTER_MODELS"]
        == ""
    )
    assert values["FIRBO_CONTROL_WRITES_ENABLED"] == "false"
    assert values["FIRBO_FREE_LOCAL_MODELS"] == "qwen3:1.7b"
    assert values["FIRBO_FREE_MODEL_DIGEST"] == rollout.MODEL_SHA


class Commands:
    def __init__(self):
        self.args = []

    def docker(self, *args, **kw):
        self.args.append(args)


@pytest.mark.parametrize("downloader", [True, False])
def test_model_has_no_public_port_and_hard_resource_limits(tmp_path, downloader):
    n = Commands()
    rollout.ollama_run(
        n,
        "test",
        rollout.IMAGE,
        "testnet",
        tmp_path / "models",
        tmp_path,
        downloader=downloader,
    )
    args = n.args[0]
    assert "--publish" not in args and "-p" not in args and "--privileged" not in args
    assert (
        args[args.index("--memory") + 1]
        == args[args.index("--memory-swap") + 1]
        == "3g"
    )
    assert args[args.index("--cpus") + 1] == "1.25"
    assert "OLLAMA_NO_CLOUD=1" in args and "OLLAMA_NUM_PARALLEL=1" in args
    assert "readonly" in args[args.index("--mount") + 1] if not downloader else True


def test_unexpected_host_rejected_before_docker(monkeypatch):
    monkeypatch.setattr(rollout.platform, "node", lambda: "another-server")
    with pytest.raises(rollout.Blocked, match="wrong_host"):
        rollout.check_resources()


def test_non_pinned_source_ref_rejected():
    with pytest.raises(rollout.Blocked, match="invalid_source_ref"):
        rollout.download("main", "a", "x")


def test_corrupt_model_fails_before_reading_untrusted_descriptors(tmp_path):
    p = tmp_path / "manifests/registry.ollama.ai/library/qwen3/1.7b"
    p.parent.mkdir(parents=True)
    p.write_text("{}")
    with pytest.raises(rollout.Blocked, match="model_manifest_changed"):
        rollout.verify_model(tmp_path)


def test_wrong_model_manifest_is_not_a_success(tmp_path):
    with pytest.raises(rollout.Blocked, match="model_manifest_missing"):
        rollout.verify_model(tmp_path)


def test_compose_changes_are_fenced(tmp_path):
    old = {
        "services": {
            "firbo-api": {
                "image": "old",
                "build": {"context": "."},
                "command": ["original"],
                "environment": {"SECRET": "not-real"},
                "volumes": [
                    {"target": "/home/openjarvis", "source": "old", "type": "bind"}
                ],
                "networks": {"default": None},
            }
        },
        "networks": {"default": {"name": "oldnet"}},
    }
    s = {"effective": old}
    import copy

    merged = copy.deepcopy(old)
    v = merged["services"]["firbo-api"]
    v.update(
        image="new",
        command=["openjarvis.server.firbo_free_app:app"],
        pull_policy="never",
    )
    v.pop("build")
    v["environment"].update(rollout.env_values("/var/lib/firbo-free/admission.sqlite3"))
    v["volumes"].append(
        {"target": "/var/lib/firbo-free", "source": str(tmp_path), "type": "bind"}
    )
    v["networks"]["firbo_local"] = None
    merged["networks"]["firbo_local"] = {"name": "privatenet", "external": True}
    rollout.validate_overlay(s, merged, "new", "privatenet", tmp_path)
    merged["services"]["injected"] = {"privileged": True}
    with pytest.raises(rollout.Blocked, match="unexpected_compose_change"):
        rollout.validate_overlay(s, merged, "new", "privatenet", tmp_path)
