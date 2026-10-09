"""Exercise actual file transactions in disposable directories, no services."""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parents[2] / "deploy/hostinger/update-openjarvis-engine.py"
spec = importlib.util.spec_from_file_location("engine_updater", SCRIPT)
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)


def package(tmp_path):
    folder = tmp_path / "package"
    folder.mkdir()
    for name in ("routes.py", "models.py"):
        (folder / name).write_bytes(b"original " + name.encode())
        (folder / name).chmod(0o640)
    (folder / "unrelated.py").write_bytes(b"Claude preserved")
    return folder


def test_unknown_local_code_is_refused(tmp_path):
    folder = package(tmp_path)
    before = updater.inventory(folder)
    with pytest.raises(RuntimeError, match="local_changes_preserved"):
        updater.check_baseline(before)
    assert updater.inventory(folder) == before


def test_known_original_updated_and_mixed_states_are_accepted():
    before = {name: values[0] for name, values in updater.MANIFEST.items()}
    after = {name: values[1] for name, values in updater.MANIFEST.items()}
    updater.check_baseline(before)
    updater.check_baseline(after)
    updater.check_baseline({**before, "routes.py": after["routes.py"]})


def test_success_preserves_metadata_unrelated_files_and_backup(tmp_path):
    folder = package(tmp_path)
    candidates = {name: b"updated " + name.encode() for name in updater.MANIFEST}
    commands = []
    backup = tmp_path / "backup"
    updater.transact(
        folder, candidates, backup, ["one", "two"], command=commands.append
    )
    assert commands == [
        ["systemctl", action, name]
        for action in ("stop", "start")
        for name in ("one", "two")
    ]
    for name, data in candidates.items():
        assert (folder / name).read_bytes() == data
        assert (folder / name).stat().st_mode & 0o777 == 0o640
    assert (folder / "unrelated.py").read_bytes() == b"Claude preserved"
    assert (backup / "routes.py").read_bytes() == b"original routes.py"
    assert backup.stat().st_mode & 0o777 == 0o700
    assert (backup / "routes.py").stat().st_mode & 0o777 == 0o600


def test_failed_verification_restores_all_originals_and_removes_new_file(tmp_path):
    folder = package(tmp_path)
    before = updater.inventory(folder)
    commands = []

    def failed():
        raise RuntimeError("verification_failed")

    with pytest.raises(RuntimeError, match="verification_failed"):
        updater.transact(
            folder,
            {name: b"candidate" for name in updater.MANIFEST},
            tmp_path / "backup",
            ["one", "two"],
            commands.append,
            failed,
        )
    assert updater.inventory(folder) == before
    assert not (folder / "runtime_inventory.py").exists()
    assert commands[-2:] == [
        ["systemctl", "start", "one"],
        ["systemctl", "start", "two"],
    ]


def test_concurrent_drift_is_preserved_and_services_restarted(tmp_path):
    folder = package(tmp_path)
    commands = []

    def command(args):
        commands.append(args)
        if args[1] == "stop":
            (folder / "models.py").write_bytes(b"new Claude edit")

    with pytest.raises(RuntimeError, match="package_changed_during_update"):
        updater.transact(
            folder,
            {name: b"candidate" for name in updater.MANIFEST},
            tmp_path / "backup",
            ["one"],
            command,
        )
    assert (folder / "models.py").read_bytes() == b"new Claude edit"
    assert not (folder / "runtime_inventory.py").exists()
    assert commands[-1] == ["systemctl", "start", "one"]


def test_symlink_is_rejected(tmp_path):
    folder = package(tmp_path)
    (folder / "runtime_inventory.py").symlink_to(folder / "unrelated.py")
    with pytest.raises(RuntimeError, match="unsafe_package_entry"):
        updater.inventory(folder)
