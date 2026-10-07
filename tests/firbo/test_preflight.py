"""Diagnostics tests use mocked subprocesses and network; no live VPS required."""

import importlib.util
import json
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "firbo_preflight", ROOT / "deploy/hostinger/preflight.py"
)
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


class Tests(unittest.TestCase):
    def test_environment_and_host_paths_never_returned(self):
        row = {
            "name": "/firbo-api",
            "image_id": "sha256:" + "a" * 64,
            "status": "running",
            "health": "healthy",
            "restarts": 0,
            "Env": ["SECRET=do-not-print"],
            "mounts": [
                {
                    "Destination": "/home/openjarvis",
                    "Type": "bind",
                    "RW": True,
                    "Source": "/secret/host/path",
                },
                {
                    "Destination": "/private-secret",
                    "Type": "bind",
                    "Source": "/another/secret",
                },
            ],
        }
        text = json.dumps(p.sanitize_container(row, "firbo-api"))
        for value in [
            "SECRET",
            "do-not-print",
            "/secret/host",
            "/private-secret",
            "/another",
        ]:
            self.assertNotIn(value, text)
        self.assertIn("/home/openjarvis", text)

    def test_wrong_container_identity(self):
        self.assertFalse(
            p.sanitize_container({"name": "/other-project"}, "firbo-api")["verified"]
        )

    def test_invalid_input(self):
        for value in [None, [], "unexpected"]:
            self.assertFalse(p.sanitize_container(value, "firbo-api")["verified"])

    def test_arbitrary_status_not_echoed(self):
        row = p.sanitize_container(
            {"name": "/firbo-api", "status": "token=bad", "image_id": "credentials"},
            "firbo-api",
        )
        self.assertEqual(row["status"], "unknown")
        self.assertEqual(row["image_id"], "unknown")

    def test_no_docker_does_not_install_anything(self):
        with (
            patch.object(p.shutil, "which", return_value=None),
            patch.object(p, "command") as command,
            patch.object(p, "health", return_value={}),
        ):
            result = p.collect()
            self.assertFalse(result["docker_found"])
            command.assert_not_called()

    def test_no_docker_access_does_not_escalate(self):
        with (
            patch.object(p.shutil, "which", return_value="/usr/bin/docker"),
            patch.object(p, "command", return_value=(False, "")) as command,
            patch.object(p, "health", return_value={}),
        ):
            result = p.collect()
            self.assertFalse(result["docker_accessible"])
            self.assertEqual(command.call_count, 2)
            self.assertNotIn("sudo", str(command.call_args_list))

    def test_commands_are_read_only_and_scoped(self):
        calls = []

        def command(args):
            calls.append(args)
            if "inspect" in args:
                return False, ""
            return True, "29.0.0"

        with (
            patch.object(p.shutil, "which", return_value="/usr/bin/docker"),
            patch.object(p, "command", side_effect=command),
            patch.object(p, "health", return_value={}),
        ):
            result = p.collect()
        self.assertEqual(len(result["containers"]), 4)
        for cmd in calls:
            self.assertTrue("version" in cmd or cmd[1:3] == ["container", "inspect"])
        self.assertNotIn("Config.Env", p.FORMAT)
        self.assertNotIn("Config.Cmd", p.FORMAT)
        self.assertNotIn("Config.Labels", p.FORMAT)

    def test_unknown_health_destination_rejected(self):
        with self.assertRaises(AssertionError):
            p.health("https://other.test/secret")

    def test_redirect_not_followed(self):
        self.assertIsNone(
            p.NoRedirect().redirect_request(
                None, None, 302, "", {}, "https://other.test"
            )
        )


if __name__ == "__main__":
    unittest.main()
