"""Real file mutation and rollback for the guarded VPS selector installer."""

import hashlib
import importlib.util
import pathlib
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "dispatch_installer", ROOT / "deploy/hostinger/install-worker-dispatch.py"
)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
APP = (
    b"# Preserve current Jarvis configuration\ndef create_app():\n"
    b"    app = object()\n    install_dashboard_login(app)\n"
    b"    return app\n\n__all__ = ['create_app']\n"
)


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.app = self.root / "app.py"
        self.app.write_bytes(APP)
        self.app.chmod(0o640)
        self.dropin = self.root / "unit" / "91-firbo-worker-dispatch.conf"
        self.dropin.parent.mkdir()
        self.module = (ROOT / "src/openjarvis/server/firbo_dispatch.py").read_bytes()
        self.calls = []

    def install(self, **changes):
        return m.install(
            self.app,
            self.module,
            dropin=self.dropin,
            backup_root=self.root,
            verify=lambda: self.calls.append("verify"),
            restart=lambda: self.calls.append("restart"),
            reload=lambda: self.calls.append("reload"),
            **changes,
        )

    def test_known_module_hash_matches_committed_bytes(self):
        self.assertEqual(hashlib.sha256(self.module).hexdigest(), m.MODULE_HASH)

    def test_factory_patch_retains_other_source_and_is_idempotent(self):
        fixed = m.patch_app(APP)
        self.assertEqual(fixed.replace(m.HOOK.encode(), b""), APP)
        self.assertEqual(m.patch_app(fixed), fixed)

    def test_unknown_factory_and_existing_hook_refused(self):
        for original in (
            b"def other():\n    return app\n",
            b"def create_app():\n    return another\n",
            b"def create_app():\n    install_worker_dispatch(app)\n    return app\n",
        ):
            with self.subTest(original=original), self.assertRaises(RuntimeError):
                m.patch_app(original)

    def test_real_install_preserves_metadata_and_private_backup(self):
        backup = self.install()
        self.assertEqual((backup / "app.py").read_bytes(), APP)
        self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.app.stat().st_mode & 0o777, 0o640)
        self.assertEqual((self.root / "firbo_dispatch.py").read_bytes(), self.module)
        self.assertEqual(self.dropin.read_bytes(), m.ENABLE)
        self.assertEqual(self.calls, ["reload", "restart", "verify"])

    def test_failed_acceptance_restores_every_file(self):
        def fail():
            raise RuntimeError("acceptance_failed")

        with self.assertRaisesRegex(RuntimeError, "acceptance_failed"):
            m.install(
                self.app,
                self.module,
                dropin=self.dropin,
                backup_root=self.root,
                verify=fail,
                restart=lambda: self.calls.append("restart"),
                reload=lambda: self.calls.append("reload"),
            )
        self.assertEqual(self.app.read_bytes(), APP)
        self.assertFalse((self.root / "firbo_dispatch.py").exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.calls, ["reload", "restart", "reload", "restart"])

    def test_modified_existing_module_or_link_refused_before_change(self):
        module = self.root / "firbo_dispatch.py"
        module.write_bytes(b"other session's module")
        with self.assertRaisesRegex(RuntimeError, "existing_dispatch_module_changed"):
            self.install()
        self.assertEqual(self.app.read_bytes(), APP)
        module.unlink()
        module.symlink_to(self.app)
        with self.assertRaisesRegex(RuntimeError, "unexpected_file_link"):
            self.install()
        self.assertEqual(self.app.read_bytes(), APP)

    def test_failure_does_not_overwrite_concurrent_change(self):
        def changed():
            self.app.write_bytes(b"concurrent session source")
            raise RuntimeError("failed")

        with self.assertRaisesRegex(RuntimeError, "concurrent_change_manual_recovery"):
            m.install(
                self.app,
                self.module,
                dropin=self.dropin,
                backup_root=self.root,
                verify=changed,
                restart=lambda: None,
                reload=lambda: None,
            )
        self.assertEqual(self.app.read_bytes(), b"concurrent session source")


if __name__ == "__main__":
    unittest.main()
