"""Offline tests for the read-only FIRBO egress host inventory."""

import hashlib
import importlib.util
import json
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location(
    "firbo_egress_inventory", ROOT / "deploy/hostinger/egress_inventory.py"
)
inventory = importlib.util.module_from_spec(spec)
spec.loader.exec_module(inventory)


class InventoryTests(unittest.TestCase):
    def fake_host(self, calls):
        def which(name):
            return f"/usr/bin/{name}" if name in {"docker", "systemctl", "ss"} else None

        def runner(args):
            calls.append(args)
            if args[0].endswith("docker") and args[1] == "version":
                return True, "29.0.0\n"
            if "inspect" in args:
                name = args[-1]
                row = {
                    "name": "/" + name,
                    "running": True,
                    "ports": {"443/tcp": [{"HostIp": "0.0.0.0", "HostPort": "443"}]}
                    if name == "firbo-caddy"
                    else {},
                    "networks": {"secret-project_default": {"IPAddress": "172.18.0.2"}},
                    "mounts": [
                        {
                            "Source": "/root/secret/Caddyfile",
                            "Destination": "/etc/caddy/Caddyfile",
                            "RW": False,
                        }
                    ]
                    if name == "firbo-caddy"
                    else [],
                    "Env": ["TOKEN=never-return"],
                }
                return True, json.dumps(row)
            if args[0].endswith("systemctl"):
                return args[-1] == "firbo-mcp-egress.service", (
                    "active\n"
                    if args[-1] == "firbo-mcp-egress.service"
                    else "ignored secret\n"
                )
            if args[0].endswith("ss"):
                port = args[-1].split(":")[-1]
                return (
                    True,
                    f"LISTEN 0 128 127.0.0.1:{port} 0.0.0.0:*\n"
                    if port == "9443"
                    else "",
                )
            raise AssertionError(args)

        return which, runner

    def test_report_is_secret_free_and_bounded(self):
        calls = []
        which, runner = self.fake_host(calls)
        report = inventory.collect(
            mcp_bind="127.0.0.1",
            mcp_port=9443,
            page_bind="127.0.0.1",
            page_port=9444,
            runner=runner,
            which=which,
        )
        text = json.dumps(report)
        for forbidden in [
            "secret-project",
            "/root/secret",
            "TOKEN",
            "never-return",
            "ignored secret",
            "172.18",
        ]:
            self.assertNotIn(forbidden, text)
        self.assertTrue(report["read_only"])
        self.assertFalse(report["contains_secrets"])
        self.assertFalse(report["mutations_performed"])
        self.assertFalse(report["network_requests_performed"])
        self.assertEqual(report["docker"]["caddy_shared_network_candidates"], 2)
        self.assertEqual(report["docker"]["egress_containers_sharing_caddy_network"], 2)
        self.assertEqual(report["systemd"]["units"][0]["state"], "active")
        self.assertEqual(report["systemd"]["units"][1]["state"], "unavailable")
        self.assertTrue(report["listeners"][0]["occupied"])
        self.assertFalse(report["listeners"][1]["occupied"])

    def test_commands_are_exact_read_only_queries(self):
        calls = []
        which, runner = self.fake_host(calls)
        inventory.collect(
            mcp_bind="10.0.0.2",
            mcp_port=19001,
            page_bind="10.0.0.2",
            page_port=19002,
            runner=runner,
            which=which,
        )
        self.assertEqual(len(calls), 11)
        for call in calls:
            rendered = " ".join(call)
            self.assertFalse(
                any(
                    word in rendered
                    for word in (
                        " exec ",
                        " logs ",
                        " restart ",
                        " start ",
                        " stop ",
                        "sudo",
                        "cat ",
                    )
                )
            )
            self.assertTrue(
                call[1:3] == ["container", "inspect"]
                or call[1] == "is-active"
                or call[1:3] == ["-H", "-lnt"]
                or call[1:3] == ["version", "--format"]
            )
        self.assertNotIn("Config.Env", inventory.DOCKER_FORMAT)
        self.assertNotIn("Config.Cmd", inventory.DOCKER_FORMAT)
        self.assertNotIn("Config.Labels", inventory.DOCKER_FORMAT)

    def test_missing_tools_do_not_install_or_escalate(self):
        calls = []
        report = inventory.collect(
            mcp_bind="127.0.0.1",
            mcp_port=9443,
            page_bind="127.0.0.1",
            page_port=9444,
            runner=lambda args: calls.append(args) or (False, ""),
            which=lambda name: None,
        )
        self.assertEqual(calls, [])
        self.assertFalse(report["docker"]["found"])
        self.assertFalse(report["systemd"]["found"])
        self.assertIsNone(report["listeners"][0]["occupied"])

    def test_public_and_colliding_listeners_rejected(self):
        cases = [
            {
                "mcp_bind": "0.0.0.0",
                "mcp_port": 9443,
                "page_bind": "127.0.0.1",
                "page_port": 9444,
            },
            {
                "mcp_bind": "127.0.0.1",
                "mcp_port": 80,
                "page_bind": "127.0.0.1",
                "page_port": 9444,
            },
            {
                "mcp_bind": "127.0.0.1",
                "mcp_port": 9443,
                "page_bind": "127.0.0.1",
                "page_port": 9443,
            },
        ]
        for case in cases:
            with self.subTest(case=case), self.assertRaises(inventory.InventoryError):
                inventory.collect(**case, which=lambda name: None)

    def _fixture(self, root: Path):
        files = []
        for index, relative in enumerate(inventory.SERVICE_PATHS):
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            raw = f"safe-service-{index}\n".encode()
            path.write_bytes(raw)
            files.append(
                {
                    "kind": "service",
                    "path": relative,
                    "sha256": hashlib.sha256(raw).hexdigest(),
                    "bytes": len(raw),
                }
            )
        for index, relative in enumerate(inventory.EDGE_PATHS):
            edge = f"edge-{index}\n".encode()
            files.append(
                {
                    "kind": "edge",
                    "path": relative,
                    "sha256": hashlib.sha256(edge).hexdigest(),
                    "bytes": len(edge),
                }
            )
        manifest = root / "manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema": "firbo-egress-bundle/v1",
                    "source": "a" * 40,
                    "files": files,
                }
            )
        )
        return manifest

    def test_exact_service_readback(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self._fixture(root)
            result = inventory.service_readback(root, manifest)
            self.assertTrue(result["performed"])
            self.assertTrue(result["all_files_match"])
            self.assertEqual(len(result["files"]), 4)

            target = root / inventory.SERVICE_PATHS[0]
            target.write_text("changed\n")
            changed = inventory.service_readback(root, manifest)
            self.assertFalse(changed["all_files_match"])
            self.assertFalse(changed["files"][0]["matches_manifest"])

    def test_symlinked_service_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self._fixture(root)
            target = root / inventory.SERVICE_PATHS[0]
            target.unlink()
            target.symlink_to(root / inventory.SERVICE_PATHS[1])
            with self.assertRaises(inventory.InventoryError):
                inventory.service_readback(root, manifest)

    def test_duplicate_manifest_key_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self._fixture(root)
            manifest = root / "duplicate.json"
            manifest.write_text(
                '{"schema":"firbo-egress-bundle/v1","schema":"bad","files":[]}'
            )
            with self.assertRaises(inventory.InventoryError):
                inventory.service_readback(root, manifest)

    def test_manifest_layout_is_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = self._fixture(root)
            value = json.loads(manifest.read_text())
            value["files"].append(
                {
                    "kind": "service",
                    "path": "src/openjarvis/server/unreviewed.py",
                    "sha256": "b" * 64,
                    "bytes": 1,
                }
            )
            manifest.write_text(json.dumps(value))
            with self.assertRaises(inventory.InventoryError):
                inventory.service_readback(root, manifest)

    def test_readback_arguments_are_atomic(self):
        with self.assertRaises(inventory.InventoryError):
            inventory.collect(
                mcp_bind="127.0.0.1",
                mcp_port=9443,
                page_bind="127.0.0.1",
                page_port=9444,
                service_root=ROOT,
                which=lambda name: None,
            )

    def test_output_is_exclusive_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.json"
            inventory._write(path, {"ok": True})
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            with self.assertRaises(inventory.InventoryError):
                inventory._write(path, {"ok": False})

    def test_command_output_limit_discards_raw_data(self):
        completed = type(
            "Completed",
            (),
            {"returncode": 0, "stdout": "x" * (inventory.MAX_COMMAND_OUTPUT + 1)},
        )()
        with patch.object(inventory.subprocess, "run", return_value=completed):
            self.assertEqual(inventory.command(["safe"]), (False, ""))


if __name__ == "__main__":
    unittest.main()
