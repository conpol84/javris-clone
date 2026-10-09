"""Pinned rollout bytes and real filesystem rollback; no service/network calls."""

import hashlib
import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[2]
SCRIPT = ROOT / "deploy/hostinger/server-output-budget.py"
spec = importlib.util.spec_from_file_location("budget_rollout", SCRIPT)
rollout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rollout)


def test_runtime_manifest_matches_exact_candidate_files():
    for name, (_, digest) in rollout.MANIFEST.items():
        path = ROOT / "src/openjarvis/server" / name
        assert hashlib.sha256(path.read_bytes()).hexdigest() == digest
    assert rollout.load_base().MANIFEST == rollout.MANIFEST


def test_exact_installed_selftest_runs_real_handler_without_inference():
    result = subprocess.run(
        [sys.executable, "-B", "-c", rollout.SELFTEST],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "firbo_output_budget_selftest_passed"


def test_rollout_rejects_modified_or_linked_helper(tmp_path, monkeypatch):
    monkeypatch.setattr(rollout, "__file__", str(tmp_path / SCRIPT.name))
    helper = tmp_path / "update-openjarvis-engine.py"
    helper.write_bytes(b"raise Exception('must never execute')")
    with pytest.raises(RuntimeError, match="hash_mismatch"):
        rollout.load_base()
    helper.unlink()
    helper.symlink_to(ROOT / "deploy/hostinger/update-openjarvis-engine.py")
    with pytest.raises(RuntimeError, match="unsafe_local_file"):
        rollout.load_base()


def test_failed_live_verification_restores_old_routes_and_removes_helper(tmp_path):
    base = rollout.load_base()
    folder = tmp_path / "package"
    folder.mkdir()
    original = b"old routes preserved"
    (folder / "routes.py").write_bytes(original)
    (folder / "routes.py").chmod(0o640)
    (folder / "other.py").write_bytes(b"other session preserved")
    commands = []

    def fail():
        raise RuntimeError("health_failed")

    with pytest.raises(RuntimeError, match="health_failed"):
        base.transact(
            folder,
            {"routes.py": b"new", "output_budget.py": b"helper"},
            tmp_path / "backup",
            list(rollout.PORTS),
            commands.append,
            fail,
        )
    assert (folder / "routes.py").read_bytes() == original
    assert (folder / "routes.py").stat().st_mode & 0o777 == 0o640
    assert not (folder / "output_budget.py").exists()
    assert (folder / "other.py").read_bytes() == b"other session preserved"
    assert (tmp_path / "backup/routes.py").read_bytes() == original
    assert commands[-2:] == [
        ["systemctl", "start", service] for service in rollout.PORTS
    ]
