"""Known-version update rollback and exact download manifests."""

import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import subprocess
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "repair", ROOT / "tools/debian/repair-desktop-input.py"
)
repair = importlib.util.module_from_spec(spec)
spec.loader.exec_module(repair)


class UpdateTests(unittest.TestCase):
    def test_actual_manifest(self):
        for name, digest in repair.NEW.items():
            self.assertEqual(
                hashlib.sha256(
                    (ROOT / "frontend/public" / name).read_bytes()
                ).hexdigest(),
                digest,
            )

    def exercise(self, fail=False):
        with tempfile.TemporaryDirectory() as folder, contextlib.ExitStack() as stack:
            home = pathlib.Path(folder)
            target = home / "Downloads"
            target.mkdir()
            proc = home / "proc/42"
            proc.mkdir(parents=True)
            (proc / "cmdline").write_bytes(
                str(target / "firbo-connector.mjs").encode() + b"\0"
            )
            (proc / "environ").write_text("DISPLAY=:99\0")
            old = {name: b"old adapter" for name in repair.NEW}
            for name, data in old.items():
                (target / name).write_bytes(data)
            untouched = home / ".firbo-connector.json"
            untouched.write_bytes(b"private pairing must remain untouched")
            events = []
            first_start = True

            def run(args, **kwargs):
                nonlocal first_start
                events.append(args)
                if "start" in args and first_start:
                    first_start = False
                    if fail:
                        raise subprocess.CalledProcessError(1, args)
                if "MainPID" in args:
                    return SimpleNamespace(stdout="42\n")
                if args[0] == "/usr/bin/python3":
                    return SimpleNamespace(stdout=json.dumps({"image": "synthetic"}))
                return SimpleNamespace(stdout="active")

            def open_url(url, **kwargs):
                return io.BytesIO(
                    (ROOT / "frontend/public" / url.rsplit("/", 1)[-1]).read_bytes()
                )

            stack.enter_context(patch.object(repair.os, "geteuid", return_value=1000))
            stack.enter_context(
                patch.object(repair.socket, "gethostname", return_value="Firbo-debian")
            )
            stack.enter_context(
                patch.object(repair.pathlib.Path, "home", return_value=home)
            )
            stack.enter_context(patch.object(repair, "PROC_ROOT", home / "proc"))
            stack.enter_context(
                patch.object(
                    repair,
                    "OLD",
                    {n: hashlib.sha256(d).hexdigest() for n, d in old.items()},
                )
            )
            stack.enter_context(patch.object(repair, "run", side_effect=run))
            stack.enter_context(
                patch.object(
                    repair, "build_opener", return_value=SimpleNamespace(open=open_url)
                )
            )
            stack.enter_context(patch("sys.argv", ["repair", "--source", "a" * 40]))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            if fail:
                with self.assertRaises(subprocess.CalledProcessError):
                    repair.main()
            else:
                repair.main()
            for name in old:
                self.assertEqual(
                    (target / name).read_bytes(),
                    old[name]
                    if fail
                    else (ROOT / "frontend/public" / name).read_bytes(),
                )
                saved = list(home.glob("firbo-input-backup-*/" + name))
                self.assertEqual(saved[0].read_bytes(), old[name])
                self.assertEqual(saved[0].stat().st_mode & 0o777, 0o600)
            self.assertEqual(
                untouched.read_bytes(), b"private pairing must remain untouched"
            )
            self.assertEqual(sum("start" in x for x in events), 2 if fail else 1)

    def test_install_preserves_pairing_and_backup(self):
        self.exercise()

    def test_failed_start_restores_both_adapters_and_restarts(self):
        self.exercise(fail=True)
