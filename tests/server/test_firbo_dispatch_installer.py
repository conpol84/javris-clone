"""Real file mutation and rollback for the guarded VPS selector installer."""

import contextlib
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import stat
import tempfile
import unittest
from unittest import mock

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

    def peer_state(self, path):
        info = path.stat()
        # Detaching a hardlink necessarily changes its link count and ctime.
        return (
            path.read_bytes(),
            info.st_dev,
            info.st_ino,
            stat.S_IMODE(info.st_mode),
            info.st_uid,
            info.st_gid,
            info.st_size,
            info.st_mtime_ns,
        )

    def assert_no_install_changes(self):
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / "firbo_dispatch.py").exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(list(self.root.glob("firbo-worker-dispatch-*")), [])

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

    def test_hardlinked_package_files_detach_without_changing_cache_peers(self):
        self.app.chmod(0o2640)
        module = self.root / "firbo_dispatch.py"
        module.write_bytes(self.module)
        module.chmod(0o600)
        peers = {}
        for path in (self.app, module):
            peer = self.root / (path.name + ".cache-peer")
            os.link(path, peer)
            peers[path] = (peer, self.peer_state(peer), path.stat())

        backup = self.install()

        self.assertEqual((backup / "app.py").read_bytes(), APP)
        self.assertEqual((backup / "firbo_dispatch.py").read_bytes(), self.module)
        self.assertEqual(self.app.read_bytes(), m.patch_app(APP))
        self.assertEqual(module.read_bytes(), self.module)
        for path, (peer, expected, original) in peers.items():
            with self.subTest(path=path.name):
                self.assertEqual(self.peer_state(peer), expected)
                installed = path.stat()
                self.assertNotEqual(installed.st_ino, original.st_ino)
                self.assertEqual(installed.st_nlink, 1)
                self.assertEqual(peer.stat().st_nlink, 1)
                self.assertEqual(installed.st_uid, original.st_uid)
                self.assertEqual(installed.st_gid, original.st_gid)
                self.assertEqual(
                    stat.S_IMODE(installed.st_mode), stat.S_IMODE(original.st_mode)
                )

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

    def test_hardlink_rollback_preserves_peer_and_original_target_metadata(self):
        self.app.chmod(0o2640)
        peer = self.root / "cached-app.py"
        os.link(self.app, peer)
        expected_peer = self.peer_state(peer)
        original = self.app.stat()

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

        restored = self.app.stat()
        self.assertEqual(self.app.read_bytes(), APP)
        self.assertEqual(self.peer_state(peer), expected_peer)
        self.assertEqual(restored.st_uid, original.st_uid)
        self.assertEqual(restored.st_gid, original.st_gid)
        self.assertEqual(stat.S_IMODE(restored.st_mode), stat.S_IMODE(original.st_mode))
        self.assertNotEqual(restored.st_ino, peer.stat().st_ino)
        self.assertEqual(restored.st_nlink, 1)
        self.assertFalse((self.root / "firbo_dispatch.py").exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.calls, ["reload", "restart", "reload", "restart"])

    def test_symlink_and_directory_app_are_classified_before_any_mutation(self):
        peer = self.root / "real-app.py"
        peer.write_bytes(APP)
        expected = self.peer_state(peer)
        for kind in ("symlink", "directory"):
            with self.subTest(kind=kind):
                self.app.unlink()
                if kind == "symlink":
                    self.app.symlink_to(peer)
                else:
                    self.app.mkdir()
                output = io.StringIO()
                with (
                    contextlib.redirect_stdout(output),
                    self.assertRaisesRegex(RuntimeError, "unexpected_file_link"),
                ):
                    self.install()
                report = json.loads(output.getvalue().removeprefix("FILE_CHECK: "))
                self.assertEqual(report["role"], "app")
                self.assertEqual(report["kind"], kind)
                self.assertGreaterEqual(report["nlink"], 1)
                self.assertEqual(self.peer_state(peer), expected)
                self.assert_no_install_changes()
                if kind == "directory":
                    self.app.rmdir()
                    self.app.write_bytes(APP)

    def test_symlinked_package_ancestor_is_not_followed(self):
        real = self.root / "real-package" / "server"
        real.mkdir(parents=True)
        peer = real / "app.py"
        peer.write_bytes(APP)
        expected = self.peer_state(peer)
        linked = self.root / "linked-package"
        linked.symlink_to(real.parent, target_is_directory=True)
        self.app = linked / "server" / "app.py"
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            self.assertRaisesRegex(RuntimeError, "unexpected_parent_link"),
        ):
            self.install()
        report = json.loads(output.getvalue().removeprefix("FILE_CHECK: "))
        self.assertEqual(report, {"role": "app_parent", "kind": "symlink", "nlink": 1})
        self.assertEqual(self.peer_state(peer), expected)
        self.assertFalse((real / "firbo_dispatch.py").exists())
        self.assert_no_install_changes()

    def test_hardlinked_dropin_is_classified_and_still_refused(self):
        self.dropin.write_bytes(m.ENABLE)
        peer = self.root / "cached-unit.conf"
        os.link(self.dropin, peer)
        expected = self.peer_state(peer)
        output = io.StringIO()
        with (
            contextlib.redirect_stdout(output),
            self.assertRaisesRegex(RuntimeError, "unexpected_file_link"),
        ):
            self.install()
        report = json.loads(output.getvalue().removeprefix("FILE_CHECK: "))
        self.assertEqual(report, {"role": "dropin", "kind": "regular", "nlink": 2})
        self.assertEqual(self.peer_state(peer), expected)
        self.assertEqual(self.app.read_bytes(), APP)
        self.assertEqual(self.calls, [])
        self.assertFalse((self.root / "firbo_dispatch.py").exists())
        self.assertEqual(list(self.root.glob("firbo-worker-dispatch-*")), [])

    def test_same_content_inode_change_is_refused_before_update(self):
        replace = m.replace
        changed_inode = None

        def concurrent(path, data, **options):
            nonlocal changed_inode
            if path == self.app:
                replacement = self.root / "concurrent-app.py"
                replacement.write_bytes(APP)
                replacement.chmod(0o640)
                os.replace(replacement, self.app)
                changed_inode = self.app.stat().st_ino
            return replace(path, data, **options)

        with mock.patch.object(m, "replace", side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError, "concurrent_file_change"):
                self.install()
        self.assertEqual(self.app.read_bytes(), APP)
        self.assertEqual(self.app.stat().st_ino, changed_inode)
        self.assertFalse((self.root / "firbo_dispatch.py").exists())
        self.assertFalse(self.dropin.exists())
        self.assertEqual(self.calls, ["reload", "restart"])
        self.assertEqual(list(self.root.glob(".firbo-dispatch-*")), [])

    def test_same_content_metadata_change_before_update_is_refused(self):
        replace = m.replace

        def concurrent(path, data, **options):
            if path == self.app:
                self.app.chmod(0o600)
            return replace(path, data, **options)

        with mock.patch.object(m, "replace", side_effect=concurrent):
            with self.assertRaisesRegex(RuntimeError, "concurrent_file_change"):
                self.install()
        self.assertEqual(self.app.read_bytes(), APP)
        self.assertEqual(stat.S_IMODE(self.app.stat().st_mode), 0o600)
        self.assertFalse((self.root / "firbo_dispatch.py").exists())
        self.assertFalse(self.dropin.exists())

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

    def test_failure_does_not_overwrite_same_content_concurrent_inode(self):
        changed_inode = None

        def changed():
            nonlocal changed_inode
            replacement = self.root / "concurrent-app.py"
            replacement.write_bytes(self.app.read_bytes())
            replacement.chmod(stat.S_IMODE(self.app.stat().st_mode))
            os.replace(replacement, self.app)
            changed_inode = self.app.stat().st_ino
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
        self.assertEqual(self.app.read_bytes(), m.patch_app(APP))
        self.assertEqual(self.app.stat().st_ino, changed_inode)


if __name__ == "__main__":
    unittest.main()
