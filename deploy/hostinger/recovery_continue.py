#!/usr/bin/env python3
"""Revalidate an EXISTING private Firbo checkpoint; never export/restart/deploy.

Accepts classic Docker config IDs and hash-linked OCI manifest/index IDs.
Verifies OCI artifacts/attestations separately from runnable images (v2).
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
    diagnostics: dict[str, Any] | None = None


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
    """Verify stored bytes and a linked image identity, not application recovery.

    OCI image indexes can include non-runnable artifacts (including BuildKit
    attestations with an empty config). Those bytes are checked, but artifacts
    and their configs can never satisfy the requested runnable image identity.
    """
    diagnostics: dict[str, Any] = {
        'verifier_version': 'oci-artifacts-v2', 'stage': 'archive_open',
        'oci_layout_detected': False, 'indexes_verified': 0,
        'image_manifests_verified': 0, 'artifact_manifests_verified': 0,
        'empty_configs_verified': 0, 'opaque_configs_verified': 0,
        'payload_descriptors_verified': 0, 'last_config_kind': 'not_read',
    }
    try:
        return _verify_image_archive(target, expected, diagnostics)
    except Blocked as exc:
        # Only fixed labels, booleans and counters; no config fields/annotations.
        exc.diagnostics = dict(diagnostics)
        raise


def _verify_image_archive(target: Path, expected: str, diagnostics: dict[str, Any]) -> dict[str, Any]:
    require(re.fullmatch(r'sha256:[0-9a-f]{64}', expected), 'invalid_expected_image_id')
    with tarfile.open(target, 'r:') as archive:
        members = archive_members(archive)
        if 'index.json' in members and 'oci-layout' in members:
            diagnostics['oci_layout_detected'] = True
            layout = unique_json(blob_read(archive, members, 'oci-layout'))
            require(isinstance(layout, dict) and layout.get('imageLayoutVersion') == '1.0.0', 'unsupported_oci_layout')
            raw_index = blob_read(archive, members, 'index.json')
            root = unique_json(raw_index)
            # A node's eligibility is computed only from its own descendants.
            # A sibling image cannot turn an artifact-only index into an image.
            nodes: dict[str, tuple[str, bool]] = {}
            active: set[str] = set()
            eligible_identities: dict[str, str] = {}
            reference_count = 0
            empty_type = 'application/vnd.oci.empty.v1+json'
            empty_digest = sha(b'{}')
            image_layer_types = {
                'application/vnd.oci.image.layer.v1.tar',
                'application/vnd.oci.image.layer.v1.tar+gzip',
                'application/vnd.oci.image.layer.v1.tar+zstd',
                'application/vnd.oci.image.layer.nondistributable.v1.tar',
                'application/vnd.oci.image.layer.nondistributable.v1.tar+gzip',
                'application/vnd.oci.image.layer.nondistributable.v1.tar+zstd',
                'application/vnd.docker.image.rootfs.diff.tar',
                'application/vnd.docker.image.rootfs.diff.tar.gzip',
                'application/vnd.docker.image.rootfs.foreign.diff.tar.gzip',
            }

            def descriptor(desc: Any, metadata: bool) -> bytes:
                nonlocal reference_count
                reference_count += 1
                require(reference_count <= 8192, 'oci_graph_limit')
                require(isinstance(desc, dict), 'invalid_oci_descriptor')
                digest, size = desc.get('digest'), desc.get('size')
                require(isinstance(digest, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', digest)
                        and type(size) is int and size >= 0, 'invalid_oci_descriptor')
                require(not metadata or size <= MAX_JSON, 'oci_metadata_too_large')
                member = members.get('blobs/sha256/' + digest[7:])
                # OCI permits embedded content. Only the canonical two-byte
                # empty JSON descriptor may be supplied inline in this verifier.
                # Do not use a network URL or conceal a present corrupt blob.
                inline_empty = (desc.get('mediaType') == empty_type and digest == empty_digest
                                and size == 2 and desc.get('data') == 'e30=')
                if member is None and inline_empty:
                    return b'{}' if metadata else b''
                require(member is not None and member.isfile() and member.size == size, 'oci_blob_missing_or_wrong_size')
                h = hashlib.sha256()
                content: list[bytes] = []
                read_bytes = 0
                stream = archive.extractfile(member)
                require(stream is not None, 'oci_blob_unreadable')
                with stream:
                    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                        h.update(chunk)
                        read_bytes += len(chunk)
                        if metadata:
                            content.append(chunk)
                require(read_bytes == size and 'sha256:' + h.hexdigest() == digest, 'oci_blob_digest_mismatch')
                return b''.join(content)

            def walk(desc: Any, depth: int = 0) -> bool:
                require(isinstance(desc, dict) and depth <= 8 and len(nodes) < 4096, 'oci_graph_limit')
                kind, digest = desc.get('mediaType'), desc.get('digest')
                require(isinstance(kind, str) and kind in INDEX_TYPES | MANIFEST_TYPES, 'unsupported_oci_descriptor_type')
                require(isinstance(digest, str) and digest not in active, 'invalid_oci_graph')
                # Validate each descriptor's own size/hash even when its target
                # was seen before; a malformed alias must not bypass validation.
                diagnostics['stage'] = 'manifest_descriptor'
                value = unique_json(descriptor(desc, True))
                require(isinstance(value, dict) and value.get('schemaVersion') == 2, 'invalid_oci_manifest')
                require(value.get('mediaType', kind) == kind, 'oci_media_type_mismatch')
                if digest in nodes:
                    require(nodes[digest][0] == kind, 'oci_media_type_mismatch')
                    return nodes[digest][1]
                active.add(digest)
                has_image = False
                if kind in INDEX_TYPES:
                    children = value.get('manifests')
                    require(isinstance(children, list) and 0 < len(children) <= 64, 'invalid_oci_index')
                    for child in children:
                        child_has_image = walk(child, depth + 1)
                        has_image = has_image or child_has_image
                    diagnostics['indexes_verified'] += 1
                    if has_image:
                        eligible_identities[digest] = 'index'
                else:
                    diagnostics['stage'] = 'config_descriptor'
                    config = value.get('config')
                    require(isinstance(config, dict), 'missing_oci_config_descriptor')
                    config_kind = config.get('mediaType')
                    # Unknown media types are kept opaque, never parsed as JSON.
                    require(isinstance(config_kind, str) and
                            re.fullmatch(r'[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+', config_kind),
                            'invalid_oci_config_media_type')
                    diagnostics['last_config_kind'] = ('image' if config_kind in CONFIG_TYPES
                                                       else 'empty' if config_kind == empty_type else 'opaque')
                    artifact_type = value.get('artifactType')
                    if artifact_type is not None:
                        require(isinstance(artifact_type, str) and
                                re.fullmatch(r'[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+', artifact_type),
                                'invalid_oci_artifact_type')
                    annotations = desc.get('annotations', {})
                    require(isinstance(annotations, dict), 'invalid_oci_annotations')
                    attestation = (artifact_type == 'application/vnd.docker.attestation.manifest.v1+json'
                                   or annotations.get('vnd.docker.reference.type') == 'attestation-manifest')
                    artifact = artifact_type is not None or attestation or config_kind not in CONFIG_TYPES
                    diagnostics['stage'] = 'config_blob'
                    if config_kind == empty_type:
                        # Merely adding EMPTY to CONFIG_TYPES would falsely count
                        # an attestation as a runnable image. Keep them distinct.
                        require(artifact_type is not None, 'empty_config_requires_artifact_type')
                        require(config.get('digest') == empty_digest and config.get('size') == 2,
                                'invalid_empty_oci_config')
                        require(descriptor(config, True) == b'{}', 'invalid_empty_oci_config')
                        if 'data' in config:
                            require(config['data'] == 'e30=', 'invalid_empty_oci_inline_data')
                        config_value = None
                        diagnostics['empty_configs_verified'] += 1
                    elif config_kind in CONFIG_TYPES:
                        config_value = unique_json(descriptor(config, True))
                        require(isinstance(config_value, dict), 'invalid_oci_image_config_json')
                    else:
                        descriptor(config, False)
                        config_value = None
                        diagnostics['opaque_configs_verified'] += 1
                    diagnostics['stage'] = 'layer_descriptors'
                    items = value.get('layers')
                    require(isinstance(items, list) and len(items) <= 1000, 'invalid_oci_layers')
                    for layer in items:
                        require(isinstance(layer, dict), 'invalid_oci_descriptor')
                        if not artifact:
                            require(isinstance(layer.get('mediaType'), str) and layer['mediaType'] in image_layer_types,
                                    'unsupported_runnable_layer_type')
                        descriptor(layer, False)
                        diagnostics['payload_descriptors_verified'] += 1
                    if artifact:
                        diagnostics['artifact_manifests_verified'] += 1
                    else:
                        diagnostics['stage'] = 'runnable_image_config'
                        require(isinstance(config_value, dict), 'invalid_oci_image_config_json')
                        os_name, architecture = config_value.get('os'), config_value.get('architecture')
                        require(isinstance(os_name, str) and os_name and os_name != 'unknown'
                                and isinstance(architecture, str) and architecture and architecture != 'unknown',
                                'runnable_platform_missing')
                        rootfs = config_value.get('rootfs')
                        require(isinstance(rootfs, dict) and rootfs.get('type') == 'layers'
                                and isinstance(rootfs.get('diff_ids'), list)
                                and len(rootfs['diff_ids']) == len(items)
                                and all(isinstance(d, str) and re.fullmatch(r'sha256:[0-9a-f]{64}', d)
                                        for d in rootfs['diff_ids']), 'runnable_rootfs_invalid')
                        platform = desc.get('platform')
                        if platform is not None:
                            require(isinstance(platform, dict) and platform.get('os') == os_name
                                    and platform.get('architecture') == architecture, 'runnable_platform_mismatch')
                        has_image = True
                        eligible_identities[digest] = 'manifest'
                        eligible_identities[config['digest']] = 'config'
                        diagnostics['image_manifests_verified'] += 1
                active.remove(digest)
                nodes[digest] = (kind, has_image)
                return has_image

            diagnostics['stage'] = 'root_index'
            require(isinstance(root, dict) and root.get('schemaVersion') == 2, 'invalid_oci_index')
            children = root.get('manifests')
            require(isinstance(children, list) and 0 < len(children) <= 64, 'invalid_oci_index')
            root_has_image = False
            for child in children:
                child_has_image = walk(child)
                root_has_image = root_has_image or child_has_image
            if root_has_image:
                eligible_identities[sha(raw_index)] = 'index'
            diagnostics['stage'] = 'expected_image_identity'
            require(expected in eligible_identities and diagnostics['image_manifests_verified'] > 0,
                    'saved_image_identity_mismatch')
            diagnostics['stage'] = 'complete'
            return {'format': 'oci', 'verifier_version': 'oci-artifacts-v2',
                    'identity_kind': eligible_identities[expected],
                    'linked_manifests_verified': diagnostics['image_manifests_verified'],
                    'artifact_manifests_verified': diagnostics['artifact_manifests_verified'],
                    'empty_configs_verified': diagnostics['empty_configs_verified'],
                    'opaque_configs_verified': diagnostics['opaque_configs_verified'],
                    'layer_descriptor_hashes_verified': diagnostics['payload_descriptors_verified'],
                    'artifact_semantics_verified': False, 'uncompressed_layer_diff_ids_verified': False,
                    'application_boot_tested': False}

        # Classic Docker export compatibility is retained; no stronger layer
        # verification is claimed for this format than the previous release.
        diagnostics['stage'] = 'legacy_manifest'
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
            return {'format': 'docker_legacy', 'verifier_version': 'oci-artifacts-v2',
                    'identity_kind': 'config', 'linked_manifests_verified': 1,
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
        if exc.diagnostics is not None:
            report['image_diagnostics'] = exc.diagnostics
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
