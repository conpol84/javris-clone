#!/usr/bin/env python3
"""Local, private CONFIGURATION + API IMAGE checkpoint; not a database backup.

Usage: python3 recovery_checkpoint.py --capture
Writes only beneath /root/firbo-recovery. Reads Docker metadata/configuration,
including credentials, and keeps those private locally. Prints a sanitized report.
No pull/build/run/exec/restart/stop/load, DB access, provider calls or uploads.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
from typing import Any

EXPECTED = {
    'firbo-api': 'sha256:4de8002d27da8b29ddde0d1f0009de623d2530895e36d1e774c01a3baf754574',
    'firbo-omniroute': 'sha256:a2b9e9405ae4dd4cbbce83468623b98376e7c6d14aa7a04a51afc20c25684da9',
    'firbo-caddy': 'sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52',
    'firbo-redis': 'sha256:cd218f4b106a332c5c992e38a9480bfb9d7e9f8f7b0ec9a0023bfa36d9a408f9',
}
ROOT = Path('/root/firbo-recovery')
GIB = 1024 ** 3
MAX_CONFIG = 2 * 1024 ** 2
# No health log, process log or arbitrary file contents are collected from Docker.
INSPECT = ('{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},'
           '"running":{{json .State.Running}},"restarts":{{json .RestartCount}},'
           '"config":{{json .Config}},"host_config":{{json .HostConfig}},'
           '"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}')


class Blocked(Exception):
    """Only constant, non-sensitive error codes may be sent to the terminal."""


def require(value: Any, code: str) -> None:
    if not value:
        raise Blocked(code)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            h.update(block)
    return h.hexdigest()


def secure_directory(path: Path) -> None:
    # Existing directories are never chmod'ed. Reject symlinks or broad access.
    require(path.is_absolute() and path.resolve() == path, 'unsafe_backup_directory')
    if not path.exists():
        path.mkdir(mode=0o700)
    s = path.lstat()
    require(stat.S_ISDIR(s.st_mode) and s.st_uid == os.geteuid()
            and stat.S_IMODE(s.st_mode) & 0o077 == 0, 'unsafe_backup_permissions')


def private_write(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())


def stable_read(path: Path) -> bytes:
    require(path.is_absolute() and path.resolve() == path, 'symlinked_configuration_not_supported')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid(),
                'configuration_not_root_owned_regular_file')
        require(before.st_size <= MAX_CONFIG, 'configuration_too_large')
        data = stream.read(MAX_CONFIG + 1)
        after = os.fstat(stream.fileno())
    require(len(data) <= MAX_CONFIG and
            (before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
            (after.st_size, after.st_mtime_ns, after.st_ctime_ns), 'configuration_changed_while_reading')
    return data


def docker(args: list[str], *, timeout: int = 20, output: bool = True) -> str:
    # Force the local daemon; never silently follow a remote Docker context.
    binary = shutil.which('docker')
    require(binary is not None, 'docker_missing')
    env = {k: v for k, v in os.environ.items()
           if k not in {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
    try:
        result = subprocess.run([binary, '--host', 'unix:///var/run/docker.sock', *args],
                                stdout=subprocess.PIPE if output else subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL, timeout=timeout, env=env, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise Blocked('docker_unavailable_or_timeout') from None
    require(result.returncode == 0, 'docker_command_failed')
    require(not output or len(result.stdout) <= 4 * MAX_CONFIG, 'docker_response_too_large')
    return result.stdout.decode('utf-8') if output else ''


def read_runtime() -> dict[str, Any]:
    rows = {}
    for name, expected in EXPECTED.items():
        item = json.loads(docker(['container', 'inspect', '--format', INSPECT, name]))
        require(isinstance(item, dict) and item.get('name') == '/' + name, 'wrong_container_identity')
        require(item.get('image') == expected, 'runtime_image_changed_repeat_preflight')
        require(item.get('running') is True, 'container_not_running')
        require(isinstance(item.get('config'), dict), 'invalid_container_configuration')
        rows[name] = item
    return rows


def config_paths(rows: dict[str, Any]) -> list[Path]:
    workdirs, projects = set(), set()
    filenames: list[Path] = []
    for row in rows.values():
        labels = row['config'].get('Labels') or {}
        work = labels.get('com.docker.compose.project.working_dir')
        project = labels.get('com.docker.compose.project')
        files = labels.get('com.docker.compose.project.config_files')
        require(isinstance(work, str) and work and isinstance(project, str) and project
                and isinstance(files, str) and files, 'compose_labels_missing')
        directory = Path(work)
        require(directory.is_absolute() and directory.resolve() == directory,
                'unsafe_compose_working_directory')
        workdirs.add(directory)
        projects.add(project)
        for filename in files.split(','):
            path = Path(filename.strip())
            if not path.is_absolute():
                path = directory / path
            require(path.parent == directory, 'compose_file_outside_working_directory')
            filenames.append(path)
    require(len(workdirs) == 1 and len(projects) == 1, 'mixed_compose_projects')
    workdir = next(iter(workdirs))
    filenames.append(workdir / '.env')
    caddy_mounts = [m for m in rows['firbo-caddy'].get('mounts', [])
                    if m.get('Destination') == '/etc/caddy/Caddyfile' and m.get('Type') == 'bind']
    require(len(caddy_mounts) == 1, 'caddy_configuration_mount_missing')
    caddy = Path(caddy_mounts[0]['Source'])
    require(caddy.parent == workdir, 'caddy_file_outside_working_directory')
    filenames.append(caddy)
    paths = sorted(set(filenames))
    require(len(paths) <= 12, 'too_many_configuration_files')
    require(all(p.is_file() for p in paths), 'configuration_file_missing')
    return paths


def environment_summary(row: dict[str, Any]) -> dict[str, bool]:
    pairs = row['config'].get('Env') or []
    env = dict(p.split('=', 1) for p in pairs if isinstance(p, str) and '=' in p)
    inference, management = env.get('OMNIROUTE_API_KEY', ''), env.get('OMNIROUTE_MANAGEMENT_KEY', '')
    origins = [s.strip() for s in env.get('OPENJARVIS_CORS_ORIGINS', '').split(',')]
    return {
        'inference_key_present': bool(inference), 'management_key_present': bool(management),
        'keys_distinct': bool(inference and management and inference != management),
        'supabase_project_matches': env.get('SUPABASE_URL', '').rstrip('/') == 'https://bfeinnsorgjycivozcau.supabase.co',
        'supabase_public_key_present': bool(env.get('SUPABASE_PUBLISHABLE_KEY')),
        'firbo_origin_allowed': 'https://firboai.app' in origins,
        'wildcard_origin_present': '*' in origins,
        'native_writes_enabled': env.get('FIRBO_CONTROL_WRITES_ENABLED', 'false').lower() == 'true',
    }


def configuration_archive(target: Path, contents: dict[str, bytes]) -> None:
    # Archive names are generated by this program, never taken from host paths.
    with target.open('xb') as output:
        os.chmod(target, 0o600)
        with tarfile.open(fileobj=output, mode='w') as archive:
            for name, data in contents.items():
                require('/' not in name and name not in {'', '.', '..'}, 'invalid_archive_name')
                info = tarfile.TarInfo(name)
                info.size, info.mode = len(data), 0o600
                archive.addfile(info, io.BytesIO(data))
        output.flush()
        os.fsync(output.fileno())


def verify_configuration(target: Path, contents: dict[str, bytes]) -> bool:
    # Rehydrate only known, bounded files into a NEW private directory. Never
    # extract arbitrary archive paths or overwrite a production configuration.
    with tempfile.TemporaryDirectory(prefix='verify-', dir=target.parent) as tmp:
        with tarfile.open(target, 'r:') as archive:
            members = archive.getmembers()
            require(len(members) == len(contents) and {m.name for m in members} == set(contents),
                    'configuration_archive_invalid')
            for member in members:
                expected = contents[member.name]
                require(member.isfile() and member.size == len(expected), 'configuration_archive_invalid')
                stream = archive.extractfile(member)
                require(stream is not None, 'configuration_archive_invalid')
                value = stream.read(len(expected) + 1)
                require(value == expected, 'configuration_archive_invalid')
                restored = Path(tmp) / member.name
                private_write(restored, value)
                require(file_digest(restored) == digest(expected), 'configuration_restore_mismatch')
    return True


def verify_image(target: Path, expected: str) -> bool:
    # Structural validation, NOT docker load or an application restore test.
    with tarfile.open(target, 'r:') as archive:
        manifest = archive.getmember('manifest.json')
        require(manifest.isfile() and manifest.size <= MAX_CONFIG, 'image_manifest_invalid')
        stream = archive.extractfile(manifest)
        require(stream is not None, 'image_manifest_invalid')
        entries = json.loads(stream.read(MAX_CONFIG + 1))
        require(isinstance(entries, list) and 0 < len(entries) <= 16, 'image_manifest_invalid')
        found = False
        for entry in entries:
            require(isinstance(entry, dict) and isinstance(entry.get('Config'), str), 'image_manifest_invalid')
            config = archive.getmember(entry['Config'])
            require(config.isfile() and config.size <= MAX_CONFIG, 'image_config_invalid')
            config_stream = archive.extractfile(config)
            require(config_stream is not None, 'image_config_invalid')
            if 'sha256:' + digest(config_stream.read(MAX_CONFIG + 1)) != expected:
                continue
            layers = entry.get('Layers')
            require(isinstance(layers, list) and 0 < len(layers) <= 1000, 'image_layers_invalid')
            for name in layers:
                member = archive.getmember(name)
                require(member.isfile() and member.size > 0, 'image_layer_missing')
            found = True
        require(found, 'saved_image_identity_mismatch')
    return True


def same_runtime(before: dict[str, Any], after: dict[str, Any]) -> bool:
    # Config and network metadata are retained privately. Compare the exact
    # selection to catch a concurrent recreate/reconnect, not only its name.
    return before == after


def capture() -> tuple[dict[str, Any], int]:
    report: dict[str, Any] = {
        'contract': 'firbo-recovery-checkpoint/v1',
        'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
        'status': 'blocked', 'scope': 'configuration_and_api_image_only',
        'report_contains_secrets': False, 'backup_files_contain_secrets': True,
        'backup_encrypted': False, 'off_host_copy_verified': False,
        'database_backup_performed': False, 'application_restore_test_passed': False,
        'deployment_performed': False,
    }
    try:
        require(os.geteuid() == 0, 'run_in_existing_root_hostinger_console')
        before = read_runtime()
        paths = config_paths(before)
        source = {p: stable_read(p) for p in paths}
        image_data = json.loads(docker(['image', 'inspect', '--format', '{{json .}}', EXPECTED['firbo-api']]))
        require(image_data.get('Id') == EXPECTED['firbo-api'], 'image_inspect_identity_mismatch')
        size = image_data.get('Size')
        require(type(size) is int and 0 < size <= 8 * GIB, 'image_size_requires_review')
        secure_directory(ROOT)
        free = shutil.disk_usage(ROOT).free
        required = 2 * size + GIB
        report['free_disk_gib'] = round(free / GIB, 2)
        report['required_free_gib'] = round(required / GIB, 2)
        require(free >= required, 'insufficient_space_no_archive_written')
        directory = Path(tempfile.mkdtemp(prefix=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-'), dir=ROOT))
        report['backup_directory'] = str(directory)
        contents = {f'config-{i}.bin': value for i, value in enumerate(source.values())}
        contents['runtime.private.json'] = json.dumps(before, sort_keys=True, indent=2).encode()
        contents['paths.private.json'] = json.dumps({f'config-{i}.bin': str(p) for i, p in enumerate(paths)}, indent=2).encode()
        tar_path = directory / 'configuration.private.tar'
        configuration_archive(tar_path, contents)
        report['configuration_roundtrip_verified'] = verify_configuration(tar_path, contents)
        report['configuration_files'] = len(paths)
        image_path = directory / 'firbo-api-image.private.tar'
        docker(['image', 'save', '--output', str(image_path), EXPECTED['firbo-api']], timeout=600, output=False)
        os.chmod(image_path, 0o600)
        report['api_image_archive_verified'] = verify_image(image_path, EXPECTED['firbo-api'])
        require(image_path.stat().st_size <= required - GIB, 'archive_size_requires_review')
        require(all(stable_read(p) == value for p, value in source.items()), 'configuration_changed_repeat_checkpoint')
        report['runtime_unchanged'] = same_runtime(before, read_runtime())
        require(report['runtime_unchanged'], 'runtime_changed_repeat_checkpoint')
        hashes = {p.name: file_digest(p) for p in (tar_path, image_path)}
        private_write(directory / 'SHA256SUMS', ''.join(f'{h}  {name}\n' for name, h in hashes.items()).encode())
        report.update(status='captured', files_sha256=hashes,
                      api_environment_checks=environment_summary(before['firbo-api']),
                      restart_counts={name: row['restarts'] for name, row in before.items()})
        private_write(directory / 'report.safe.json', (json.dumps(report, indent=2) + '\n').encode())
        return report, 0
    except Blocked as exc:
        report['error'] = str(exc)
    except Exception:
        # Never echo a filesystem path, Docker stderr, credentials or raw traceback.
        report['error'] = 'checkpoint_failed_private_files_retained_if_created'
    return report, 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--capture', action='store_true', help='Create private local config/API-image files; no deployment')
    args = parser.parse_args()
    if not args.capture:
        parser.error('--capture is required; nothing was changed')
    old_mask = os.umask(0o077)
    try:
        result, status = capture()
        print(json.dumps(result, indent=2))
    finally:
        os.umask(old_mask)
    raise SystemExit(status)


if __name__ == '__main__':
    main()
