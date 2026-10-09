"""Guarded Caddy/app transforms; optional real Caddy binary verification in CI."""

import importlib.util
import json
import os
import pathlib
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "login_installer", ROOT / "deploy/hostinger/install-dashboard-login.py"
)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)

CADDY = b"""{
    admin off
}
api.firboai.app {
    reverse_proxy firbo-api:8000
}
jarvis.firboai.app {
    encode gzip
    basic_auth {
        admin $2a$14$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCDE
    }
    reverse_proxy 172.17.0.1:8765
}
gateway.firboai.app {
    reverse_proxy omniroute:20128
}
"""


class InstallerTests(unittest.TestCase):
    def test_exact_caddy_auth_removal_other_sites_preserved(self):
        candidate = installer.remove_basic(CADDY)
        removed = (
            b"basic_auth {\n        admin "
            b"$2a$14$abcdefghijklmnopqrstuuabcdefghijklmnopqrstuvwxyzABCDE\n    }"
        )
        self.assertEqual(candidate, CADDY.replace(removed, b""))
        self.assertIn(b"reverse_proxy 172.17.0.1:8765", candidate)

    def test_caddy_ambiguous_missing_or_shared_site_fails(self):
        cases = [
            CADDY.replace(b"jarvis.firboai.app", b"other.example"),
            CADDY + CADDY,
            CADDY.replace(
                b"jarvis.firboai.app {", b"other.example jarvis.firboai.app {"
            ),
            CADDY.replace(b"basic_auth {", b"basic_auth @matcher {"),
        ]
        for raw in cases:
            with self.subTest(raw=raw):
                with self.assertRaises(RuntimeError):
                    installer.remove_basic(raw)

    def test_comments_quotes_and_environment_braces_do_not_corrupt_parser(self):
        extra = b'    header X-Test "{fake}"\n    # } fake comment\n'
        raw = CADDY.replace(b"    encode gzip", extra + b"    encode gzip")
        raw += b"{$EXTRA_DOMAIN} {\n respond ok\n}\n"
        candidate = installer.remove_basic(raw)
        self.assertIn(extra, candidate)
        self.assertIn(b"{$EXTRA_DOMAIN}", candidate)

    def test_app_hook_preserves_every_existing_statement(self):
        original = b"def create_app():\n    app = object()\n    return app\n"
        patched = installer.patched_app(original)
        self.assertEqual(patched.replace(installer.HOOK.encode(), b""), original)
        self.assertEqual(installer.patched_app(patched), patched)
        for raw in (
            b"def different():\n    return app\n",
            b"def create_app():\n    return factory()\n",
        ):
            with self.assertRaises(RuntimeError):
                installer.patched_app(raw)

    def test_repository_app_contains_exact_supported_hook(self):
        raw = (ROOT / "src/openjarvis/server/app.py").read_bytes()
        self.assertEqual(installer.patched_app(raw), raw)

    def test_module_hash_matches_installer_manifest(self):
        import hashlib

        actual = hashlib.sha256(
            (ROOT / "src/openjarvis/server/dashboard_login.py").read_bytes()
        ).hexdigest()
        self.assertEqual(actual, installer.MODULE_HASH)

    @unittest.skipUnless(
        os.environ.get("CADDY_BIN"), "real Caddy binary supplied by CI"
    )
    def test_real_caddy_preserves_other_adapted_routes(self):
        def adapt(raw):
            result = subprocess.run(
                [
                    os.environ["CADDY_BIN"],
                    "adapt",
                    "--config",
                    "-",
                    "--adapter",
                    "caddyfile",
                ],
                input=raw,
                capture_output=True,
                check=True,
            )
            return json.loads(result.stdout)

        original, count = installer.auth_removed(adapt(CADDY))
        self.assertEqual(count, 1)
        proposed, count = installer.auth_removed(adapt(installer.remove_basic(CADDY)))
        self.assertEqual(count, 0)
        self.assertEqual(original, proposed)


if __name__ == "__main__":
    unittest.main()
