"""OCI/config-ID compatibility and private resume regression tests, no live Docker."""

import copy
import importlib.util
import io
import json
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def load(name, file):
    spec = importlib.util.spec_from_file_location(
        name, ROOT / "deploy/hostinger" / file
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


p = load("continuation", "recovery_continue.py")
old = load("original", "recovery_checkpoint.py")


def pack(path, entries):
    with tarfile.open(path, "w") as tar:
        for name, value in entries.items():
            info = tarfile.TarInfo(name)
            if isinstance(value, tarfile.TarInfo):
                tar.addfile(value)
            else:
                info.size = len(value)
                tar.addfile(info, io.BytesIO(value))
    path.chmod(0o600)


def oci_fixture():
    entries = {}

    def put(value, media):
        raw = (
            value
            if isinstance(value, bytes)
            else json.dumps(value, separators=(",", ":")).encode()
        )
        digest = p.sha(raw)
        entries["blobs/sha256/" + digest[7:]] = raw
        return {"mediaType": media, "digest": digest, "size": len(raw)}

    layer = put(b"layer-content", "application/vnd.oci.image.layer.v1.tar")
    config = put(
        {
            "architecture": "amd64",
            "os": "linux",
            "rootfs": {"type": "layers", "diff_ids": [layer["digest"]]},
        },
        next(iter(p.CONFIG_TYPES)),
    )
    manifest = put(
        {"schemaVersion": 2, "config": config, "layers": [layer]},
        "application/vnd.oci.image.manifest.v1+json",
    )
    inner = put(
        {"schemaVersion": 2, "manifests": [manifest]},
        "application/vnd.oci.image.index.v1+json",
    )
    entries["index.json"] = json.dumps(
        {"schemaVersion": 2, "manifests": [inner]}
    ).encode()
    entries["oci-layout"] = b'{"imageLayoutVersion":"1.0.0"}'
    # Docker/containerd exports may include the classic compatibility manifest as well.
    entries["manifest.json"] = json.dumps(
        [
            {
                "Config": "blobs/sha256/" + config["digest"][7:],
                "Layers": ["blobs/sha256/" + layer["digest"][7:]],
            }
        ]
    ).encode()
    return entries, {
        "manifest": manifest["digest"],
        "index": inner["digest"],
        "config": config["digest"],
        "layer": layer["digest"],
    }


class ContinueTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.image = self.dir / "image.tar"

    def tearDown(self):
        self.tmp.cleanup()

    def test_original_false_negative_is_reproduced_then_fixed(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        with self.assertRaisesRegex(old.Blocked, "saved_image_identity_mismatch"):
            old.verify_image(self.image, ids["manifest"])
        self.assertEqual(
            p.verify_image_archive(self.image, ids["manifest"])["identity_kind"],
            "manifest",
        )

    def test_index_identity(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        self.assertEqual(
            p.verify_image_archive(self.image, ids["index"])["identity_kind"], "index"
        )

    def test_oci_config_identity(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        self.assertEqual(
            p.verify_image_archive(self.image, ids["config"])["identity_kind"], "config"
        )

    def test_export_index_identity(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        self.assertEqual(
            p.verify_image_archive(self.image, p.sha(entries["index.json"]))[
                "identity_kind"
            ],
            "index",
        )

    def test_unrelated_identity_rejected(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        with self.assertRaisesRegex(p.Blocked, "saved_image_identity_mismatch"):
            p.verify_image_archive(self.image, "sha256:" + "0" * 64)

    def test_present_but_unreachable_blob_not_accepted(self):
        entries, ids = oci_fixture()
        rogue = b'{"do-not-accept":true}'
        digest = p.sha(rogue)
        entries["blobs/sha256/" + digest[7:]] = rogue
        pack(self.image, entries)
        with self.assertRaisesRegex(p.Blocked, "saved_image_identity_mismatch"):
            p.verify_image_archive(self.image, digest)

    def test_layer_digest_is_not_an_image_identity(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        with self.assertRaisesRegex(p.Blocked, "saved_image_identity_mismatch"):
            p.verify_image_archive(self.image, ids["layer"])

    def test_corrupt_layer_rejected(self):
        entries, ids = oci_fixture()
        key = "blobs/sha256/" + ids["layer"][7:]
        entries[key] = b"x" * len(entries[key])
        pack(self.image, entries)
        with self.assertRaisesRegex(p.Blocked, "oci_blob_digest_mismatch"):
            p.verify_image_archive(self.image, ids["index"])

    def test_corrupt_manifest_rejected(self):
        entries, ids = oci_fixture()
        key = "blobs/sha256/" + ids["manifest"][7:]
        entries[key] = b"x" * len(entries[key])
        pack(self.image, entries)
        with self.assertRaisesRegex(p.Blocked, "oci_blob_digest_mismatch"):
            p.verify_image_archive(self.image, ids["index"])

    def test_missing_blob_rejected(self):
        entries, ids = oci_fixture()
        del entries["blobs/sha256/" + ids["config"][7:]]
        pack(self.image, entries)
        with self.assertRaisesRegex(p.Blocked, "oci_blob_missing_or_wrong_size"):
            p.verify_image_archive(self.image, ids["index"])

    def test_descriptor_symlink_rejected(self):
        entries, ids = oci_fixture()
        key = "blobs/sha256/" + ids["manifest"][7:]
        info = tarfile.TarInfo(key)
        info.type = tarfile.SYMTYPE
        info.linkname = "/etc/passwd"
        entries[key] = info
        pack(self.image, entries)
        with self.assertRaises(p.Blocked):
            p.verify_image_archive(self.image, ids["index"])

    def test_duplicate_tar_member_rejected(self):
        entries, ids = oci_fixture()
        pack(self.image, entries)
        with tarfile.open(self.image, "a") as tar:
            info = tarfile.TarInfo("index.json")
            info.size = len(entries["index.json"])
            tar.addfile(info, io.BytesIO(entries["index.json"]))
        with self.assertRaisesRegex(p.Blocked, "duplicate_or_excess_archive_members"):
            p.verify_image_archive(self.image, ids["index"])

    def test_traversal_not_extracted(self):
        pack(self.image, {"../escape": b"secret"})
        with self.assertRaises(p.Blocked):
            p.verify_image_archive(self.image, "sha256:" + "0" * 64)
        self.assertFalse((self.dir.parent / "escape").exists())

    def test_duplicate_json_key_rejected(self):
        with self.assertRaisesRegex(p.Blocked, "duplicate_json_key"):
            p.unique_json(b'{"a":1,"a":2}')

    def test_classic_archive_preserved(self):
        config = b'{"legacy":true}'
        pack(
            self.image,
            {
                "manifest.json": b'[{"Config":"config.json","Layers":["layer.tar"]}]',
                "config.json": config,
                "layer.tar": b"layer",
            },
        )
        result = p.verify_image_archive(self.image, p.sha(config))
        self.assertEqual(result["format"], "docker_legacy")
        self.assertFalse(result["application_boot_tested"])

    def test_unsafe_backup_permissions_rejected(self):
        self.image.write_bytes(b"x")
        self.image.chmod(0o644)
        with self.assertRaisesRegex(p.Blocked, "unsafe_private_permissions"):
            p.private_path(self.image)

    def test_environment_report_is_boolean_only(self):
        rows = {
            "firbo-api": {
                "config": {
                    "Env": [
                        "OMNIROUTE_API_KEY=do-not-print",
                        "OMNIROUTE_MANAGEMENT_KEY=do-not-print",
                    ]
                }
            }
        }
        result = p.environment_checks(rows)
        self.assertTrue(all(type(v) is bool for v in result.values()))
        self.assertFalse(result["keys_distinct"])
        self.assertNotIn("do-not-print", json.dumps(result))

    def test_resume_invalid_directory_does_not_inspect(self):
        with patch.object(p, "read_runtime") as inspect:
            report, code = p.continue_checkpoint(self.dir)
        self.assertEqual(code, 1)
        inspect.assert_not_called()
        self.assertFalse(report["deployment_performed"])

    def test_resume_existing_files_without_reexport(self):
        root = self.dir / "recovery"
        root.mkdir(mode=0o700)
        directory = root / "20261003T031626Z-synthetic"
        directory.mkdir(mode=0o700)
        work = self.dir / "work"
        work.mkdir()
        for name in ["compose.yml", ".env", "Caddyfile"]:
            (work / name).write_text("secret-never-print")
        entries, ids = oci_fixture()
        expected = {**p.EXPECTED, "firbo-api": ids["index"]}
        config = {
            "Labels": {
                "com.docker.compose.project.working_dir": str(work),
                "com.docker.compose.project": "firbo",
                "com.docker.compose.project.config_files": str(work / "compose.yml"),
            },
            "Env": ["OMNIROUTE_API_KEY=secret-never-print"],
        }
        rows = {
            name: {
                "name": "/" + name,
                "image": image,
                "running": True,
                "config": copy.deepcopy(config),
                "mounts": [
                    {
                        "Type": "bind",
                        "Destination": "/etc/caddy/Caddyfile",
                        "Source": str(work / "Caddyfile"),
                    }
                ],
            }
            for name, image in expected.items()
        }
        snapshot = p.configuration_snapshot(rows)
        pack(directory / "configuration.private.tar", snapshot)
        pack(directory / "firbo-api-image.private.tar", entries)
        before = {path.name: p.file_hash(path) for path in directory.iterdir()}
        with (
            patch.object(p, "ROOT", root),
            patch.object(p, "EXPECTED", expected),
            patch.object(p, "read_runtime", return_value=rows),
            patch.object(p.subprocess, "run") as process,
        ):
            report, code = p.continue_checkpoint(directory)
        self.assertEqual(code, 0, report)
        process.assert_not_called()
        self.assertEqual(report["status"], "verified_existing_checkpoint")
        self.assertNotIn("secret-never-print", json.dumps(report))
        self.assertFalse(report["image_reexported"])
        for name, digest in before.items():
            self.assertEqual(p.file_hash(directory / name), digest)
        for path in directory.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)


if __name__ == "__main__":
    unittest.main()
