import hashlib
import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "preflight", ROOT / "deploy/worker/preflight.py"
)
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class PreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name)
        self.state = self.path / "state"
        self.state.mkdir(mode=0o700)
        self.source = self.path / "worker.py"
        self.source.write_bytes((ROOT / "deploy/worker/firbo_worker.py").read_bytes())
        self.cfg = {
            "worker_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            "organizations": ["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
            "worker_token": "w" * 48,
            "server": "https://unreachable.invalid",
        }
        self.config = self.path / "config.json"
        self.save()

    def save(self):
        self.config.write_text(json.dumps(self.cfg))
        self.config.chmod(0o600)

    def report(self, **extra):
        return m.inspect_host("worker", self.source, self.config, self.state, **extra)

    def test_exact_source_private_inputs_and_truthful_output(self):
        report = self.report()
        self.assertTrue(all(v for k, v in report["checks"].items() if k != "non_root"))
        self.assertEqual(report["local_prerequisites_pass"], os.getuid() != 0)
        self.assertFalse(report["deployed"])
        self.assertEqual(report["network_acceptance"], "not_tested")
        self.assertNotIn(self.cfg["worker_token"], json.dumps(report))
        self.assertNotIn(self.cfg["server"], json.dumps(report))
        self.source.write_text("raise RuntimeError('must not be executed')")
        self.assertFalse(self.report()["checks"]["pinned_worker_bytes"])

    def test_private_permissions_symlink_fifo_and_missing_config(self):
        self.config.chmod(0o644)
        self.assertFalse(self.report()["checks"]["private_scoped_config"])
        self.config.unlink()
        self.config.symlink_to(self.source)
        self.assertFalse(self.report()["checks"]["private_scoped_config"])
        self.config.unlink()
        os.mkfifo(self.config, 0o600)
        self.assertFalse(self.report()["checks"]["private_scoped_config"])
        self.config.unlink()
        self.assertFalse(self.report()["checks"]["private_scoped_config"])

    def test_admin_secret_on_worker_and_malformed_scope_rejected(self):
        for delta in (
            {"admin_token": "a" * 48},
            {"organizations": []},
            {"organizations": [self.cfg["organizations"][0]] * 2},
            {"worker_id": "invalid"},
            {"worker_token": "short"},
            {"server": "http://public.example"},
            {"server": "https://user:password@example.test"},
            {"server": "https://example.test:bad"},
        ):
            original = self.cfg.copy()
            self.cfg.update(delta)
            self.save()
            self.assertFalse(self.report()["checks"]["private_scoped_config"])
            self.cfg = original

    def test_state_and_database_paths_rejected_without_changes(self):
        self.state.chmod(0o755)
        self.assertFalse(self.report()["checks"]["private_state_directory"])
        self.state.chmod(0o700)
        db = self.state / "worker.sqlite3"
        db.symlink_to(self.config)
        self.assertFalse(self.report()["checks"]["database_path_safe"])
        db.unlink()
        db.write_bytes(b"x" * 200000)
        db.chmod(0o600)
        self.assertTrue(self.report()["checks"]["database_path_safe"])
        before = hashlib.sha256(db.read_bytes()).hexdigest()
        self.report()
        self.assertEqual(hashlib.sha256(db.read_bytes()).hexdigest(), before)
        db.chmod(0o644)
        self.assertFalse(self.report()["checks"]["database_path_safe"])

    def test_linux_port_observation_ipv4_ipv6_and_unknown_denial(self):
        proc = self.path / "proc"
        proc.mkdir()
        for name in ("tcp", "tcp6"):
            (proc / name).write_text("header\n")
        self.assertTrue(m.port_free(8095, proc))
        (proc / "tcp6").write_text("header\n0: 00000000:1F9F 00000000:0000 0A\n")
        self.assertFalse(m.port_free(8095, proc))
        (proc / "tcp6").write_text("header\n")
        (proc / "tcp").write_text("header\n0: 0100007F:1F9F 00000000:0000 0A\n")
        self.assertFalse(m.port_free(8095, proc))
        self.cfg.pop("server")
        self.cfg["admin_token"] = "a" * 48
        self.save()
        result = m.inspect_host(
            "server", self.source, self.config, self.state, proc=proc
        )
        self.assertFalse(result["checks"]["coordinator_port_free"])
        (proc / "tcp6").unlink()
        (proc / "tcp").write_text("header\n")
        result = m.inspect_host(
            "server", self.source, self.config, self.state, proc=proc
        )
        self.assertFalse(result["checks"]["coordinator_port_free"])

    def test_actual_cli_no_network_or_local_writes_and_exit_status(self):
        before = {str(p): p.read_bytes() for p in (self.source, self.config)}
        command = [
            sys.executable,
            str(ROOT / "deploy/worker/preflight.py"),
            "worker",
            "--source",
            str(self.source),
            "--config",
            str(self.config),
            "--state-dir",
            str(self.state),
        ]
        run = subprocess.run(
            command, capture_output=True, text=True, timeout=5, check=False
        )
        report = json.loads(run.stdout)
        self.assertEqual(run.returncode, 0 if report["local_prerequisites_pass"] else 1)
        self.assertEqual(run.stderr, "")
        self.assertEqual(list(self.state.iterdir()), [])
        self.assertEqual(
            {str(p): p.read_bytes() for p in (self.source, self.config)}, before
        )
        self.config.chmod(0o644)
        run = subprocess.run(
            command, capture_output=True, text=True, timeout=5, check=False
        )
        self.assertEqual(run.returncode, 1)
        self.assertFalse(json.loads(run.stdout)["checks"]["private_scoped_config"])


if __name__ == "__main__":
    unittest.main()
