#!/usr/bin/env python3
"""Revalidate an EXISTING private Firbo checkpoint; never export/restart/deploy.

Accepts classic Docker config IDs and hash-linked OCI manifest/index IDs.
Reads local private configuration and image archives; emits no secret values.
Only side effects: new root-only checksum/report files inside the checkpoint.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import tarfile
from typing import Any

ROOT = Path('/root/firbo-recovery')
MAX_JSON = 8 * 1024 * 1024
EXPECTED = {
    'firbo-api': 'sha256:4de8002d27da8b29ddde0d1f0009de623d2530895e36d1e774c01a3baf754574',
    'firbo-omniroute': 'sha256:a2b9e9405ae4dd4cbbce83468623b98376e7c6d14aa7a04a51afc20c25684da9',
    'firbo-caddy': 'sha256:0c994536bddb66445885237f1a5dcc1916bccea922661c76b4e9fc24061f9b52',
    'firbo-redis': 'sha256:cd218f4b106a332c5c992e38a9480bfb9d7e9f8f7b0ec9a0023bfa36d9a408f9',
}
INSPECT = ('{"name":{{json .Name}},"id":{{json .Id}},"image":{{json .Image}},'
           '"running":{{json .State.Running}},"restarts":{{json .RestartCount}},'
           '"config":{{json .Config}},"host_config":{{json .HostConfig}},'
           '"networks":{{json .NetworkSettings.Networks}},"mounts":{{json .Mounts}}}')
INDEX_TYPES = {'application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json'}
MANIFEST_TYPES = {'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'}
CONFIG_TYPES = {'application/vnd.oci.image.config.v1+json', 'application/vnd.docker.container.image.v1+json'}


class Blocked(Exception):
    """Exception text is always a fixed safe code, never upstream content."""


def require(ok: Any, code: str) -> None:
    if not ok:
        raise Blocked(code)


def sha(data: bytes) -> str:
    return 'sha256:' + hashlib.sha256(data).hexdigest()


def unique_json(raw: bytes) -> Any:
    def pairs(items: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in items:
            require(key not in out, 'duplicate_json_key')
            out[key] = value
        return out
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (ValueError, UnicodeError):
        raise Blocked('invalid_archive_json') from None


def private_path(path: Path, directory: bool = False) -> None:
    require(path.is_absolute() and path.resolve() == path, 'unsafe_private_path')
    info = path.lstat()
    require((stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode))
            and info.st_uid == os.geteuid() and stat.S_IMODE(info.st_mode) & 0o077 == 0,
            'unsafe_private_permissions')


def file_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def archive_members(archive: tarfile.TarFile) -> dict[str, tarfile.TarInfo]:
    out: dict[str, tarfile.TarInfo] = {}
    for member in archive:
        name = member.name.removeprefix('./').rstrip('/')
        if member.isdir() and name in {'', '.'}:
            continue
        path = PurePosixPath(name)
        require(name and not path.is_absolute() and '..' not in path.parts and '\\' not in name,
                'unsafe_archive_path')
        require(name not in out and len(out) < 100_000, 'duplicate_or_excess_archive_members')
        out[name] = member
    return out


def blob_read(archive: tarfile.TarFile, members: dict[str, tarfile.TarInfo], name: str,
              limit: int = MAX_JSON) -> bytes:
    member = members.get(name)
    require(member is not None and member.isfile() and 0 <= member.size <= limit, 'archive_member_invalid')
    stream = archive.extractfile(member)
    require(stream is not None, 'archive_member_invalid')
    with stream:
        raw = stream.read(limit + 1)
    require(len(raw) == member.size and len(raw) <= limit, 'archive_member_truncated')
    return raw


def verify_image_archive(target: Path, expected: str) -> dict[str, Any]:
    """Structural integrity proof only: no extraction, docker load or boot."""
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', expected), 'invalid_expected_image_id')
    with tarfile.open(target, 'r:') as archive:
        members = archive_members(archive)
        if 'index.json' in members and 'oci-layout' in members:
            require(unique_json(blob_read(archive, members, 'oci-layout')).get('imageLayoutVersion') == '1.0.0', 'unsupported_oci_layout')
            raw_index = blob_read(archive, members, 'index.json')
            root = unique_json(raw_index)
            verified: set[str] = set()
            active: set[str] = set()
            identities: dict[str, str] = {}
            manifests, layers = 0, 0

            def descriptor(desc: Any, metadata: bool) -> bytes:
                require(isinstance(desc, dict), 'invalid_oci_descriptor')
                digest, size = desc.get('digest'), desc.get('size')
                require(isinstance(digest, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', digest)
                        and type(size) is int and size >= 0, 'invalid_oci_descriptor')
                member = members.get('blobs/sha256/' + digest[7:])
                require(member is not None and member.isfile() and member.size == size, 'oci_blob_missing_or_wrong_size')
                require(not metadata or size <= MAX_JSON, 'oci_metadata_too_large')
                h = hashlib.sha256()
                content: list[bytes] = []
                stream = archive.extractfile(member)
                require(stream is not None, 'oci_blob_unreadable')
                with stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        h.update(chunk)
                        if metadata:
                            content.append(chunk)
                require('sha256:' + h.hexdigest() == digest, 'oci_blob_digest_mismatch')
                return b''.join(content)

            def walk(desc: Any, depth: int = 0) -> None:
                nonlocal manifests, layers
                require(isinstance(desc, dict) and depth <= 8 and len(verified) < 4096, 'oci_graph_limit')
                kind, digest = desc.get('mediaType'), desc.get('digest')
                require(isinstance(digest, str) and digest not in active, 'invalid_oci_graph')
                if digest in verified:
                    return
                active.add(digest)
                value = unique_json(descriptor(desc, True))
                require(isinstance(value, dict) and value.get('schemaVersion') == 2, 'invalid_oci_manifest')
                if kind in INDEX_TYPES:
                    identities[digest] = 'index'
                    children = value.get('manifests')
                    require(isinstance(children, list) and 0 < len(children) <= 64, 'invalid_oci_index')
                    for child in children:
                        walk(child, depth + 1)
                elif kind in MANIFEST_TYPES:
                    identities[digest] = 'manifest'
                    config = value.get('config')
                    require(isinstance(config, dict) and config.get('mediaType') in CONFIG_TYPES, 'invalid_oci_config')
                    config_value = unique_json(descriptor(config, True))
                    require(isinstance(config_value, dict), 'invalid_oci_config')
                    identities[config['digest']] = 'config'
                    items = value.get('layers')
                    require(isinstance(items, list) and 0 < len(items) <= 1000, 'invalid_oci_layers')
                    for layer in items:
                        descriptor(layer, False)
                        layers += 1
                    manifests += 1
                else:
                    raise Blocked('unsupported_oci_descriptor_type')
                active.remove(digest)
                verified.add(digest)

            require(isinstance(root, dict) and root.get('schemaVersion') == 2, 'invalid_oci_index')
            children = root.get('manifests')
            require(isinstance(children, list) and 0 < len(children) <= 64, 'invalid_oci_index')
            identities[sha(raw_index)] = 'index'
            for child in children:
                walk(child)
            require(expected in identities and manifests > 0, 'saved_image_identity_mismatch')
            return {'format': 'oci', 'identity_kind': identities[expected], 'linked_manifests_verified': manifests,
                    'layer_descriptor_hashes_verified': layers, 'application_boot_tested': False}

        entries = unique_json(blob_read(archive, members, 'manifest.json'))
        require(isinstance(entries, list) and 0 < len(entries) <= 16, 'image_manifest_invalid')
        for entry in entries:
            require(isinstance(entry, dict) and isinstance(entry.get('Config'), str), 'image_manifest_invalid')
            config = blob_read(archive, members, entry['Config'])
            if sha(config) != expected:
                continue
            layers = entry.get('Layers')
            require(isinstance(layers, list) and 0 < len(layers) <= 1000, 'image_layers_invalid')
            for name in layers:
                require(isinstance(name, str), 'image_layers_invalid')
                member = members.get(name)
                require(member is not None and member.isfile() and member.size > 0, 'image_layer_missing')
            return {'format': 'docker_legacy', 'identity_kind': 'config', 'linked_manifests_verified': 1,
                    'layer_descriptor_hashes_verified': 0, 'application_boot_tested': False}
        raise Blocked('saved_image_identity_mismatch')


def read_runtime() -> dict[str, Any]:
    binary = shutil.which('docker')
    require(binary, 'docker_missing')
    env = {k: v for k, v in os.environ.items() if k not in {'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH'}}
    rows: dict[str, Any] = {}
    for name, image in EXPECTED.items():
        result = subprocess.run([binary, '--host', 'unix:///var/run/docker.sock', 'container', 'inspect', '--format', INSPECT, name],
                                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, timeout=20, check=False)
        require(result.returncode == 0 and len(result.stdout) <= MAX_JSON, 'docker_inspect_failed')
        row = unique_json(result.stdout)
        require(isinstance(row, dict) and row.get('name') == '/' + name and row.get('image') == image
                and row.get('running') is True, 'runtime_changed_or_not_running')
        rows[name] = row
    return rows


def configuration_snapshot(rows: dict[str, Any]) -> dict[str, bytes]:
    paths: set[Path] = set()
    workdirs, projects = set(), set()
    for row in rows.values():
        labels = row['config'].get('Labels') or {}
        work = Path(labels.get('com.docker.compose.project.working_dir', ''))
        project = labels.get('com.docker.compose.project')
        files = labels.get('com.docker.compose.project.config_files')
        require(work.is_absolute() and work.resolve() == work and project and isinstance(files, str), 'invalid_compose_labels')
        workdirs.add(work)
        projects.add(project)
        for name in files.split(','):
            path = Path(name.strip())
            path = path if path.is_absolute() else work / path
            require(path.parent == work, 'configuration_outside_workdir')
            paths.add(path)
    require(len(workdirs) == len(projects) == 1, 'mixed_compose_projects')
    work = next(iter(workdirs))
    paths.add(work / '.env')
    mounts = [m for m in rows['firbo-caddy']['mounts'] if m.get('Type') == 'bind' and m.get('Destination') == '/etc/caddy/Caddyfile']
    require(len(mounts) == 1, 'caddy_mount_missing')
    caddy = Path(mounts[0]['Source'])
    require(caddy.parent == work, 'configuration_outside_workdir')
    paths.add(caddy)
    require(len(paths) <= 12, 'configuration_count_invalid')
    values: dict[str, bytes] = {}
    for i, path in enumerate(sorted(paths)):
        require(path.resolve() == path, 'symlinked_configuration')
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            require(stat.S_ISREG(before.st_mode) and before.st_uid == os.geteuid() and before.st_size <= MAX_JSON, 'invalid_configuration_file')
            raw = stream.read(MAX_JSON + 1)
            after = os.fstat(stream.fileno())
            require(len(raw) == before.st_size and (before.st_mtime_ns, before.st_ctime_ns) == (after.st_mtime_ns, after.st_ctime_ns), 'configuration_changed')
        values[f'config-{i}.bin'] = raw
    values['runtime.private.json'] = json.dumps(rows, sort_keys=True, indent=2).encode()
    values['paths.private.json'] = json.dumps({f'config-{i}.bin': str(p) for i, p in enumerate(sorted(paths))}, indent=2).encode()
    return values


def environment_checks(rows: dict[str, Any]) -> dict[str, bool]:
    env = dict(item.split('=', 1) for item in rows['firbo-api']['config'].get('Env', []) if isinstance(item, str) and '=' in item)
    return {'firbo_origin_allowed': 'https://firboai.app' in [s.strip() for s in env.get('OPENJARVIS_CORS_ORIGINS', '').split(',')],
            'supabase_project_matches': env.get('SUPABASE_URL', '').rstrip('/') == 'https://bfeinnsorgjycivozcau.supabase.co',
            'supabase_public_key_present': bool(env.get('SUPABASE_PUBLISHABLE_KEY')),
            'inference_key_present': bool(env.get('OMNIROUTE_API_KEY')), 'management_key_present': bool(env.get('OMNIROUTE_MANAGEMENT_KEY')),
            'keys_distinct': bool(env.get('OMNIROUTE_API_KEY') and env.get('OMNIROUTE_MANAGEMENT_KEY') and env['OMNIROUTE_API_KEY'] != env['OMNIROUTE_MANAGEMENT_KEY'])}


def continue_checkpoint(directory: Path) -> tuple[dict[str, Any], int]:
    report: dict[str, Any] = {'contract': 'firbo-recovery-resume/v1', 'status': 'blocked', 'checked_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                              'report_contains_secrets': False, 'backup_files_contain_secrets': True, 'backup_encrypted': False,
                              'scope': 'configuration_and_api_image_only', 'off_host_copy_verified': False,
                              'database_backup_performed': False, 'application_restore_test_passed': False, 'deployment_performed': False,
                              'image_reexported': False}
    try:
        require(directory.parent == ROOT and re.fullmatch(r'\d{8}T\d{6}Z-[a-z0-9_]+', directory.name), 'invalid_checkpoint_directory')
        private_path(ROOT, True)
        private_path(directory, True)
        config_file, image_file = directory / 'configuration.private.tar', directory / 'firbo-api-image.private.tar'
        private_path(config_file)
        private_path(image_file)
        require(config_file.stat().st_size <= 32 * MAX_JSON and image_file.stat().st_size <= 32 * 1024**3, 'archive_size_limit')
        before_stats = [(p.stat().st_size, p.stat().st_mtime_ns, p.stat().st_ctime_ns) for p in (config_file, image_file)]
        before = read_runtime()
        report['api_environment_checks'] = environment_checks(before)
        snapshot = configuration_snapshot(before)
        with tarfile.open(config_file, 'r:') as archive:
            members = archive_members(archive)
            require(set(members) == set(snapshot), 'configuration_archive_shape_mismatch')
            require(all(blob_read(archive, members, key) == value for key, value in snapshot.items()), 'configuration_or_runtime_changed_since_capture')
        report['configuration_matches_live'] = True
        report['image_verification'] = verify_image_archive(image_file, EXPECTED['firbo-api'])
        hashes = {p.name: file_hash(p) for p in (config_file, image_file)}
        require(before_stats == [(p.stat().st_size, p.stat().st_mtime_ns, p.stat().st_ctime_ns) for p in (config_file, image_file)], 'archive_changed_during_verification')
        require(before == read_runtime() and snapshot == configuration_snapshot(before), 'runtime_or_configuration_changed_during_verification')
        report.update(status='verified_existing_checkpoint', backup_directory=str(directory), files_sha256=hashes, runtime_unchanged=True)
        # Exclusive output: never rewrite the old archives or a prior report.
        stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        for name, content in [('report-resumed-' + stamp + '.safe.json', json.dumps(report, indent=2) + '\n'),
                              ('SHA256SUMS-resumed-' + stamp, ''.join(f'{h}  {name}\n' for name, h in hashes.items()))]:
            fd = os.open(directory / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as out:
                out.write(content)
                out.flush()
                os.fsync(out.fileno())
        return report, 0
    except Blocked as exc:
        report['error'] = str(exc)
    except Exception:
        report['error'] = 'resume_failed_no_runtime_changes'
    return report, 1


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True, type=Path)
    args = parser.parse_args()
    require(os.geteuid() == 0, 'use_existing_root_console')
    print_report, code = continue_checkpoint(args.directory)
    print(json.dumps(print_report, indent=2))
    raise SystemExit(code)


if __name__ == '__main__':
    main()
