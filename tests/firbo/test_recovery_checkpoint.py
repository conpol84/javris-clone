"""No live Docker or credentials: test private local capture with synthetic data."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('recovery', ROOT / 'deploy/hostinger/recovery_checkpoint.py')
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)


def image_tar(target, config=b'{"test":true}', missing_layer=False):
    with tarfile.open(target, 'w') as tar:
        def add(name, data):
            entry = tarfile.TarInfo(name)
            entry.size = len(data)
            tar.addfile(entry, io.BytesIO(data))
        add('manifest.json', json.dumps([{'Config':'image.json','Layers':['layer.tar']}]).encode())
        add('image.json', config)
        if not missing_layer:
            add('layer.tar', b'synthetic layer')
    return 'sha256:' + hashlib.sha256(config).hexdigest()


class RecoveryTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_sensitive_file_is_private_and_exclusive(self):
        f = self.dir / 'private'
        p.private_write(f, b'fake-secret')
        self.assertEqual(stat.S_IMODE(f.stat().st_mode), 0o600)
        with self.assertRaises(FileExistsError):
            p.private_write(f, b'other')
        self.assertEqual(f.read_bytes(), b'fake-secret')

    def test_private_write_rejects_symlink(self):
        a, b = self.dir / 'a', self.dir / 'b'
        a.write_bytes(b'original')
        b.symlink_to(a)
        with self.assertRaises(FileExistsError):
            p.private_write(b, b'changed')
        self.assertEqual(a.read_bytes(), b'original')

    def test_secure_directory_rejects_broad_permissions(self):
        d = self.dir / 'public'
        d.mkdir(mode=0o755)
        with self.assertRaisesRegex(p.Blocked, 'unsafe_backup_permissions'):
            p.secure_directory(d)
        self.assertEqual(stat.S_IMODE(d.stat().st_mode), 0o755)

    def test_secure_directory_rejects_symlink(self):
        d = self.dir / 'link'
        d.symlink_to(self.dir, target_is_directory=True)
        with self.assertRaises(p.Blocked):
            p.secure_directory(d)

    def test_stable_read_rejects_symlink(self):
        (self.dir / 'value').write_text('secret')
        (self.dir / 'link').symlink_to(self.dir / 'value')
        with self.assertRaises(p.Blocked):
            p.stable_read(self.dir / 'link')

    def test_stable_read_rejects_fifo_without_blocking(self):
        path = self.dir / 'pipe'
        os.mkfifo(path)
        with self.assertRaisesRegex(p.Blocked, 'configuration_not_root_owned_regular_file'):
            p.stable_read(path)

    def test_stable_read_bounds_file_size(self):
        path = self.dir / 'large'
        path.write_bytes(b'x' * (p.MAX_CONFIG + 1))
        with self.assertRaisesRegex(p.Blocked, 'configuration_too_large'):
            p.stable_read(path)

    def test_sensitive_config_roundtrip_does_not_modify_source(self):
        source = self.dir / 'source'
        source.write_bytes(b'API_KEY=synthetic-private')
        content = {'config-0.bin': p.stable_read(source), 'runtime.private.json': b'{"Env":["SECRET=synthetic"]}'}
        tar = self.dir / 'private.tar'
        p.configuration_archive(tar, content)
        self.assertTrue(p.verify_configuration(tar, content))
        self.assertEqual(source.read_bytes(), content['config-0.bin'])
        self.assertEqual(stat.S_IMODE(tar.stat().st_mode), 0o600)
        self.assertEqual(list(self.dir.glob('verify-*')), [])

    def test_archive_paths_cannot_escape(self):
        with self.assertRaisesRegex(p.Blocked, 'invalid_archive_name'):
            p.configuration_archive(self.dir / 'bad.tar', {'../escape':b'secret'})
        self.assertFalse((self.dir.parent / 'escape').exists())

    def test_configuration_roundtrip_rejects_wrong_content(self):
        tar = self.dir / 'bad.tar'
        p.configuration_archive(tar, {'a':b'wrong'})
        with self.assertRaises(p.Blocked):
            p.verify_configuration(tar, {'a':b'right'})

    def test_image_identity_and_layers_verified(self):
        target = self.dir / 'image.tar'
        expected = image_tar(target)
        self.assertTrue(p.verify_image(target, expected))

    def test_wrong_saved_image_rejected(self):
        target = self.dir / 'image.tar'
        image_tar(target)
        with self.assertRaisesRegex(p.Blocked, 'saved_image_identity_mismatch'):
            p.verify_image(target, 'sha256:'+'0'*64)

    def test_missing_image_layer_rejected(self):
        target = self.dir / 'image.tar'
        expected = image_tar(target, missing_layer=True)
        with self.assertRaises((p.Blocked, KeyError)):
            p.verify_image(target, expected)

    def runtime(self):
        work = self.dir / 'deploy'
        work.mkdir(exist_ok=True)
        for file in ['compose.yml','.env','Caddyfile']:
            (work / file).write_text('FAKE_SECRET=private\n')
        config = {'Labels': {'com.docker.compose.project.working_dir':str(work),
                            'com.docker.compose.project':'firbo',
                            'com.docker.compose.project.config_files':str(work/'compose.yml')},
                  'Env':['OMNIROUTE_API_KEY=synthetic-inference','OMNIROUTE_MANAGEMENT_KEY=synthetic-manage',
                         'SUPABASE_URL=https://bfeinnsorgjycivozcau.supabase.co',
                         'SUPABASE_PUBLISHABLE_KEY=synthetic-public',
                         'OPENJARVIS_CORS_ORIGINS=https://firboai.app']}
        return {name:{'name':'/'+name,'image':image,'id':name+'-id','running':True,'restarts':0,
                      'config':copy.deepcopy(config),'mounts':[{'Source':str(work/'Caddyfile'),
                          'Destination':'/etc/caddy/Caddyfile','Type':'bind'}] if name == 'firbo-caddy' else []}
                for name,image in p.EXPECTED.items()}

    def test_config_paths_discovered_not_assumed(self):
        rows = self.runtime()
        self.assertEqual(len(p.config_paths(rows)), 3)

    def test_mixed_projects_blocked(self):
        rows = self.runtime()
        rows['firbo-api']['config']['Labels']['com.docker.compose.project']='other'
        with self.assertRaisesRegex(p.Blocked,'mixed_compose_projects'):
            p.config_paths(rows)

    def test_outside_config_path_blocked(self):
        rows = self.runtime()
        rows['firbo-api']['config']['Labels']['com.docker.compose.project.config_files']='/etc/passwd'
        with self.assertRaisesRegex(p.Blocked, 'compose_file_outside_working_directory'):
            p.config_paths(rows)

    def test_missing_env_file_blocked(self):
        rows = self.runtime()
        (self.dir / 'deploy/.env').unlink()
        with self.assertRaisesRegex(p.Blocked, 'configuration_file_missing'):
            p.config_paths(rows)

    def test_environment_only_emits_booleans(self):
        summary = p.environment_summary(self.runtime()['firbo-api'])
        self.assertTrue(all(type(v) is bool for v in summary.values()))
        self.assertTrue(summary['keys_distinct'])
        self.assertNotIn('synthetic', json.dumps(summary))

    def test_shared_management_inference_key_is_not_hidden(self):
        row = self.runtime()['firbo-api']
        row['config']['Env']=['OMNIROUTE_API_KEY=identical','OMNIROUTE_MANAGEMENT_KEY=identical']
        summary = p.environment_summary(row)
        self.assertFalse(summary['keys_distinct'])
        self.assertTrue(summary['management_key_present'])

    def test_runtime_image_drift_blocks(self):
        rows = self.runtime()
        rows['firbo-api']['image']='sha256:'+'0'*64
        with patch.object(p, 'docker', return_value=json.dumps(rows['firbo-api'])):
            with self.assertRaisesRegex(p.Blocked, 'runtime_image_changed_repeat_preflight'):
                p.read_runtime()

    def test_runtime_recreation_detected(self):
        before = self.runtime()
        after = copy.deepcopy(before)
        after['firbo-api']['id'] = 'new-id'
        self.assertFalse(p.same_runtime(before, after))

    def test_nonroot_has_no_docker_effect(self):
        with patch.object(p.os, 'geteuid', return_value=1000), patch.object(p, 'docker') as command:
            report, code = p.capture()
        self.assertEqual(code, 1)
        command.assert_not_called()
        self.assertFalse(report['deployment_performed'])

    def test_raw_errors_never_echoed(self):
        with patch.object(p.os, 'geteuid', return_value=0), patch.object(p, 'read_runtime', side_effect=OSError('SECRET=leak')):
            report, code = p.capture()
        self.assertEqual(code, 1)
        self.assertNotIn('SECRET',json.dumps(report))

    def test_local_docker_context_enforced_and_stderr_suppressed(self):
        done = types.SimpleNamespace(returncode=0,stdout=b'{}')
        with patch.object(p.shutil,'which',return_value='/usr/bin/docker'), patch.object(p.subprocess,'run',return_value=done) as run:
            p.docker(['container','inspect','firbo-api'])
        args, kw = run.call_args
        self.assertEqual(args[0][:3], ['/usr/bin/docker','--host','unix:///var/run/docker.sock'])
        self.assertEqual(kw['stderr'],p.subprocess.DEVNULL)
        self.assertNotIn('DOCKER_HOST',kw['env'])

    def test_full_capture_synthetic_does_not_deploy_or_read_database(self):
        rows = self.runtime()
        fake_config = b'{"test":true}'
        expected = 'sha256:'+hashlib.sha256(fake_config).hexdigest()
        calls=[]
        def command(args, **kwargs):
            calls.append(args)
            if args[:2] == ['image','inspect']:
                return json.dumps({'Id':expected, 'Size':1048576})
            if args[:2] == ['image','save']:
                image_tar(Path(args[args.index('--output')+1]), fake_config)
                return ''
            raise AssertionError('Unexpected command')
        # capture runs as root on the VPS; helper file checks tested above as actual uid.
        actual_read=p.stable_read
        actual_euid=os.geteuid()
        def read_local(path):
            with patch.object(p.os,'geteuid',return_value=actual_euid): return actual_read(path)
        secure=p.secure_directory
        def directory_local(path):
            with patch.object(p.os,'geteuid',return_value=actual_euid): return secure(path)
        with patch.object(p,'ROOT',self.dir/'recovery'), patch.dict(p.EXPECTED,{'firbo-api':expected}), \
             patch.object(p.os,'geteuid',return_value=0), patch.object(p,'read_runtime',return_value=rows), \
             patch.object(p,'docker',side_effect=command), patch.object(p,'stable_read',side_effect=read_local), \
             patch.object(p,'secure_directory',side_effect=directory_local):
            report, code=p.capture()
        self.assertEqual(code,0,report)
        self.assertEqual(report['status'],'captured')
        self.assertTrue(report['configuration_roundtrip_verified'])
        self.assertTrue(report['api_image_archive_verified'])
        self.assertFalse(report['database_backup_performed'])
        self.assertFalse(report['application_restore_test_passed'])
        self.assertFalse(report['off_host_copy_verified'])
        self.assertFalse(report['backup_encrypted'])
        self.assertTrue(report['backup_files_contain_secrets'])
        self.assertNotIn('synthetic-manage',json.dumps(report))
        self.assertNotIn('FAKE_SECRET',json.dumps(report))
        self.assertTrue(all(cmd[:2] in [['image','inspect'],['image','save']] for cmd in calls))
        backup=Path(report['backup_directory'])
        self.assertEqual(stat.S_IMODE(backup.stat().st_mode),0o700)
        for file in backup.iterdir(): self.assertEqual(stat.S_IMODE(file.stat().st_mode),0o600)

    def test_insufficient_space_stops_before_image_save(self):
        rows = self.runtime()
        with patch.object(p.os,'geteuid',return_value=0), patch.object(p,'read_runtime',return_value=rows), \
             patch.object(p,'stable_read',return_value=b'config'), patch.object(p,'secure_directory'), \
             patch.object(p,'docker',return_value=json.dumps({'Id':p.EXPECTED['firbo-api'],'Size':p.GIB})) as cmd, \
             patch.object(p.shutil,'disk_usage',return_value=types.SimpleNamespace(free=1)):
            report, code=p.capture()
        self.assertEqual(code,1)
        self.assertEqual(report['error'],'insufficient_space_no_archive_written')
        self.assertNotIn('backup_directory', report)
        self.assertEqual(cmd.call_count,1)


if __name__=='__main__': unittest.main()
