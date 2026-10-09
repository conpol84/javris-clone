#!/usr/bin/env python3
"""Install the reviewed native control API, READ-ONLY, into the existing Firbo API.

No git pull, dependency upgrade, new public port, volume export, provider write,
Supabase DDL/function deploy or inference request. A private canary boots first.
The original local image and private configuration are retained for rollback.
This is NOT a full data backup or a complete OpenJarvis agent-engine rollout.

Usage on the existing Firbo VPS: python3 native_control_rollout.py --apply
Without --apply this only inspects/probes; it never builds or recreates anything.
"""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

SOURCE_REF = 'b494df70d7b46a20af510964af72fe6e24e3b125'
SOURCE_BASE = 'https://raw.githubusercontent.com/conpol84/javris-clone/' + SOURCE_REF + '/src/openjarvis/server/'
SOURCE_HASHES = {'firbo_app.py': 'd4882b0b2c13bac843ea849d7ba0688f4f562313db3ef436aeccae8279576f07', 'firbo_control.py': '46607e5009c6ba87069b1c6a327a65bff24e34de79a0b1277da89c00a0b72099'}  # Exact candidate source; prior release manifests remain immutable.
EXPECTED_DB = 'https://bfeinnsorgjycivozcau.supabase.co'
NAMES = ('firbo-api', 'firbo-omniroute', 'firbo-caddy', 'firbo-redis')
ROOT = Path('/root/firbo-native-releases')
PUBLIC_API = 'https://api.firboai.app'
PUBLIC_FRONTEND = 'https://firboai.app'
SAFE_PATH = re.compile(r'^/[a-zA-Z0-9_./-]+$')
IMAGE = re.compile(r'^sha256:[0-9a-f]{64}$')

class Blocked(Exception):
    """Only a fixed diagnostic label may escape to the public report."""

def require(condition, code):
    if not condition:
        raise Blocked(code)

def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()

def run(args, *, cwd=None, timeout=30):
    try:
        completed = subprocess.run(args, cwd=cwd, capture_output=True, timeout=timeout, check=False)
        require(completed.returncode == 0, 'command_failed_' + re.sub('[^a-z0-9_]', '_', str(args[1])[:30]))
        require(len(completed.stdout) <= 4_000_000, 'command_output_too_large')
        return completed.stdout.decode('utf-8')
    except (OSError, UnicodeError, subprocess.TimeoutExpired):
        raise Blocked('command_unavailable_or_timed_out') from None

def docker(*args, **kw):
    return run(['docker', *args], **kw)

def inspect(name):
    try:
        rows = json.loads(docker('container', 'inspect', name))
        require(len(rows) == 1 and rows[0]['Name'] == '/' + name, 'container_identity_mismatch')
        return rows[0]
    except (ValueError, KeyError, TypeError):
        raise Blocked('container_inspection_invalid') from None

def identity(c):
    return {k: c.get(k) for k in ('Id', 'Image', 'RestartCount')} | {'started': c.get('State', {}).get('StartedAt')}

def env_map(rows):
    require(isinstance(rows, list), 'invalid_environment')
    values = {}
    for row in rows:
        require(isinstance(row, str) and '=' in row and not any(c in row for c in '\r\n\x00'), 'unsafe_environment_value')
        key, value = row.split('=', 1)
        require(re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key) and key not in values, 'duplicate_environment_key')
        values[key] = value
    return values

def real_file(path):
    p = Path(path)
    require(p.is_absolute() and SAFE_PATH.fullmatch(str(p)) and p.resolve() == p, 'unsafe_configuration_path')
    info = p.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and not info.st_mode & 0o022, 'unsafe_configuration_file')
    require(info.st_size <= 1_000_000, 'configuration_too_large')
    return p

def private_write(path, raw):
    data = raw.encode() if isinstance(raw, str) else raw
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(data); f.flush(); os.fsync(f.fileno())

def atomic_replace(path, raw):
    fd, name = tempfile.mkstemp(prefix='.firbo-native-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as f:
            f.write(raw); f.flush(); os.fsync(f.fileno())
        os.chmod(name, 0o600)
        os.replace(name, path)
        d = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try: os.fsync(d)
        finally: os.close(d)
    finally:
        if os.path.exists(name): os.unlink(name)

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

def get_json(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Firbo-Native-ReadOnly-Rollout/1'})
    try:
        response = urllib.request.build_opener(NoRedirect()).open(req, timeout=5)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        require('json' in response.headers.get('content-type', '').lower(), 'public_endpoint_not_json')
        raw = response.read(32_769)
        require(len(raw) <= 32_768, 'public_endpoint_too_large')
        return response.code, json.loads(raw)

def public_probe(native=False):
    try:
        code, health = get_json(PUBLIC_API + '/health')
        if code != 200 or health.get('status') != 'ok': return False
        if not native: return True
        if health.get('contract') != 'firbo-control/v1': return False
        for base in (PUBLIC_API, PUBLIC_FRONTEND):
            code, body = get_json(base + '/v1/firbo/session')
            if code != 401 or body.get('detail') != 'sign_in_required': return False
        return True
    except (Blocked, OSError, ValueError, urllib.error.URLError):
        return False

def compose_args(project, files):
    out = ['compose', '-p', project]
    for file in files: out += ['-f', str(file)]
    return out

def compose_config(project, files, workdir):
    return json.loads(docker(*compose_args(project, files), 'config', '--format', 'json', cwd=workdir))

def parse_state():
    states = {name: inspect(name) for name in NAMES}
    require(all(v.get('State', {}).get('Running') is True for v in states.values()), 'existing_stack_not_running')
    api = states['firbo-api']; cfg = api['Config']; host = api['HostConfig']; labels = cfg.get('Labels') or {}
    require(labels.get('com.docker.compose.service') == 'firbo-api', 'wrong_compose_service')
    project = labels.get('com.docker.compose.project', '')
    require(re.fullmatch('[a-zA-Z0-9_-]{1,100}', project), 'missing_compose_project')
    workdir = Path(labels.get('com.docker.compose.project.working_dir', ''))
    require(workdir.is_absolute() and workdir.resolve() == workdir and workdir.is_dir(), 'missing_compose_directory')
    file_names = labels.get('com.docker.compose.project.config_files', '').split(',')
    require(1 <= len(file_names) <= 4 and all(file_names), 'missing_compose_files')
    files = [real_file(s) for s in file_names]
    require(all(p.parent == workdir for p in files), 'unexpected_compose_layout')
    dotenv = real_file(workdir / '.env')
    require(IMAGE.fullmatch(api['Image']), 'invalid_image_identity')
    require(not host.get('Privileged') and not host.get('PortBindings') and host.get('NetworkMode') != 'host', 'unexpected_api_privilege_or_ports')
    require(cfg.get('User') not in ('', 'root', '0', '0:0', None), 'api_must_remain_unprivileged')
    require(cfg.get('Entrypoint') == ['python', '-m', 'uvicorn'], 'unexpected_api_entrypoint')
    require(cfg.get('Cmd') == ['openjarvis.server.firbo_app:app', '--host', '0.0.0.0', '--port', '8000'], 'unexpected_api_command')
    networks = list(api['NetworkSettings']['Networks'])
    require(len(networks) == 1, 'unexpected_api_networks')
    require(all(networks[0] in v['NetworkSettings']['Networks'] for v in states.values()), 'stack_network_mismatch')
    env = env_map(cfg['Env'])
    require(env.get('SUPABASE_URL', '').rstrip('/') == EXPECTED_DB, 'wrong_supabase_project')
    require(env.get('OMNIROUTE_HOST') == 'http://omniroute:20128', 'wrong_gateway_target')
    require(PUBLIC_FRONTEND in [x.strip() for x in env.get('OPENJARVIS_CORS_ORIGINS', '').split(',')], 'frontend_origin_missing')
    require(all(env.get(k) for k in ('SUPABASE_PUBLISHABLE_KEY', 'OMNIROUTE_MANAGEMENT_KEY', 'OMNIROUTE_API_KEY')), 'missing_existing_credentials')
    effective = compose_config(project, files, workdir)
    service = effective['services']['firbo-api']
    require(service.get('container_name') == 'firbo-api', 'compose_service_mismatch')
    require(service.get('entrypoint') == cfg['Entrypoint'] and service.get('command') == cfg['Cmd'], 'compose_command_drift')
    require(not service.get('ports') and not service.get('privileged'), 'compose_unsafe_runtime')
    for k, value in service.get('environment', {}).items():
        require(value is not None and str(value) == env.get(k), 'compose_environment_drift')
    declared=[]
    for m in service.get('volumes',[]):
        require(m.get('target') == '/home/openjarvis' and m.get('type') in ('bind','volume'), 'unexpected_api_mount')
        source_path=m.get('source')
        if m['type']=='volume':source_path=effective.get('volumes',{}).get(source_path,{}).get('name')
        declared.append((m['type'],m['target'],source_path,not m.get('read_only',False)))
    actual=[(m.get('Type'),m.get('Destination'),m.get('Name') if m.get('Type')=='volume' else m.get('Source'),m.get('RW')) for m in api.get('Mounts',[])]
    require(sorted(declared)==sorted(actual),'compose_mount_drift')
    if service.get('user'):require(str(service['user'])==cfg.get('User'),'compose_user_drift')
    source = docker('exec', 'firbo-api', 'python', '-c',
        "import importlib.util,json;print(json.dumps(importlib.util.find_spec('openjarvis.server.firbo_app').origin))").strip()
    module = Path(json.loads(source))
    require(re.fullmatch(r'/(usr/local/lib/python3\.\d+/site-packages|app/src)/openjarvis/server/firbo_app\.py', str(module)), 'unexpected_module_location')
    return dict(states=states, api=api, env=env, project=project, workdir=workdir, files=files, dotenv=dotenv,
                effective=effective, module=module.parent, network=networks[0])

def changed_compose_env(before: bytes, files: list[Path]):
    text = before.decode('utf-8')
    lines = text.splitlines(keepends=True)
    matches = [i for i, line in enumerate(lines) if re.match(r'^\s*(?:export\s+)?COMPOSE_FILE\s*=', line)]
    require(len(matches) <= 1, 'duplicate_compose_file_setting')
    value = ':'.join(str(p) for p in files)
    require(all(SAFE_PATH.fullmatch(str(p)) for p in files), 'unsafe_compose_file_setting')
    setting = 'COMPOSE_FILE=' + value + '\n'
    if matches: lines[matches[0]] = setting
    else:
        if lines and not lines[-1].endswith('\n'): lines[-1] += '\n'
        lines += ['\n# Firbo native read-only API release; rollback restores the prior setting.\n', setting]
    return ''.join(lines).encode()

def assert_other_containers(s):
    for name in NAMES[1:]:
        require(identity(inspect(name)) == identity(s['states'][name]), 'other_container_changed')

def assert_no_drift(s, originals):
    require(identity(inspect('firbo-api')) == identity(s['api']), 'api_changed_during_release')
    assert_other_containers(s)
    require(all(real_file(p).read_bytes() == raw for p, raw in originals.items()), 'configuration_changed_during_release')
    require(compose_config(s['project'], s['files'], s['workdir']) == s['effective'], 'compose_changed_during_release')

def download_sources(destination):
    for name, expected in SOURCE_HASHES.items():
        url = SOURCE_BASE + name
        with urllib.request.build_opener(NoRedirect()).open(url, timeout=20) as response:
            require(response.status == 200, 'source_download_failed')
            data = response.read(100_001)
        require(len(data) <= 100_000 and digest(data) == expected, 'source_checksum_mismatch')
        private_write(destination / name, data)

PROBE = r'''
import json,urllib.request,urllib.error,hashlib,importlib.util,os
out={}
for path in ('/health','/v1/firbo/session','/v1/firbo/control','/v1/gateway/overview'):
 try:r=urllib.request.urlopen('http://127.0.0.1:8000'+path,timeout=3)
 except urllib.error.HTTPError as e:r=e
 with r:body=json.loads(r.read(32768));out[path]={'code':r.code,'contract':body.get('contract'),'detail':body.get('detail'),'status':body.get('status')}
out['writes_disabled']=os.environ.get('FIRBO_CONTROL_WRITES_ENABLED')=='false'
out['source_hashes']={n:hashlib.sha256(open(importlib.util.find_spec('openjarvis.server.'+n[:-3]).origin,'rb').read()).hexdigest() for n in ('firbo_app.py','firbo_control.py')}
print(json.dumps(out))
'''
READ_GATEWAY = r'''
import asyncio,json
from openjarvis.server.firbo_control import _gateway,_rows
async def check():
 try:
  h=await _gateway('GET','/api/health')
  p=_rows(await _gateway('GET','/api/providers'),'connections')
  m=_rows(await _gateway('GET','/v1/models'),'data')
  c=_rows(await _gateway('GET','/api/combos'),'combos')
  return {'verified':isinstance(h,dict),'providers':len(p),'models':len(m),'combos':len(c),'inference_requests':0}
 except Exception:return {'verified':False,'error':'gateway_read_verification_failed','inference_requests':0}
print(json.dumps(asyncio.run(check())))
'''

def probe_container(name):
    for _ in range(12):
        try:
            result = json.loads(docker('exec', name, 'python', '-c', PROBE, timeout=8))
            require(result['/health'] == {'code':200,'contract':'firbo-control/v1','detail':None,'status':'ok'}, 'native_health_failed')
            require(all(result[p]['code'] == 401 and result[p]['detail'] == 'sign_in_required' for p in result if p.startswith('/v1/')), 'anonymous_control_not_denied')
            require(result['writes_disabled'] is True and result['source_hashes'] == SOURCE_HASHES, 'candidate_identity_or_guard_failed')
            return result
        except (Blocked, ValueError, KeyError): time.sleep(1)
    raise Blocked('native_boot_or_auth_boundary_failed')

def apply_release(s, report):
    release = Path(tempfile.mkdtemp(prefix=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-'), dir=ROOT))
    os.chmod(release, 0o700)
    report['release_directory'] = str(release)
    report['private_configuration_backup_contains_secrets'] = True
    originals = {p:p.read_bytes() for p in [*s['files'], s['dotenv']]}
    for i,(path, data) in enumerate(originals.items()): private_write(release / ('original-' + str(i)), data)
    private_write(release/'original-config.json', json.dumps(s['effective']))
    source = release/'source'; source.mkdir(mode=0o700); download_sources(source)
    old_tag = 'firbo-native-baseline:' + s['api']['Image'][7:23]
    docker('image','tag',s['api']['Image'],old_tag)
    new_tag = 'firbo-native-control:' + release.name.lower()
    dockerfile = f'FROM {old_tag}\n'
    for name in SOURCE_HASHES: dockerfile += f'COPY --chmod=0644 {name} {s["module"]}/{name}\n'
    dockerfile += f'LABEL app.firbo.native.source="{SOURCE_REF}"\n'
    private_write(source/'Dockerfile', dockerfile)
    print('FIRBO_NATIVE_STAGE build_candidate', file=sys.stderr, flush=True)
    docker('build','--pull=false','--network=none','-t',new_tag,str(source),timeout=180)
    new_id = docker('image','inspect','--format','{{.Id}}',new_tag).strip()
    require(IMAGE.fullmatch(new_id), 'invalid_candidate_image')
    report['candidate_image_id'] = new_id
    canary = 'firbo-native-canary-' + release.name.lower()
    canary_env = dict(s['env'], FIRBO_CONTROL_WRITES_ENABLED='false', FIRBO_CONTROL_AUDIT_DB='/tmp/disabled.sqlite3')
    env_path = release/'canary.env'
    private_write(env_path, ''.join(k+'='+v+'\n' for k,v in canary_env.items()))
    canary_created = False
    overlay = s['workdir']/'compose.firbo-native-readonly.yaml'
    touched = False
    new_env = None
    overlay_bytes = None
    try:
        print('FIRBO_NATIVE_STAGE isolated_canary', file=sys.stderr, flush=True)
        docker('run','-d','--name',canary,'--network',s['network'],'--read-only','--cap-drop','ALL',
               '--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=16m',
               '--env-file',str(env_path),'--entrypoint','python',new_id,'-m','uvicorn',
               'openjarvis.server.firbo_app:app','--host','127.0.0.1','--port','8000')
        canary_created = True
        probe_container(canary)
        info=inspect(canary)
        require(not info['HostConfig'].get('PortBindings') and all(m.get('Type') == 'tmpfs' and m.get('Destination') == '/tmp' for m in info.get('Mounts', [])), 'canary_not_isolated')
        gateway = json.loads(docker('exec',canary,'python','-c',READ_GATEWAY,timeout=55))
        require(gateway.get('verified') is True, 'gateway_read_verification_failed')
        report['canary'] = {'boot_verified':True, 'anonymous_denied':True, 'source_verified':True,
                            'no_public_port':True, 'no_persistent_mounts':True, 'gateway_read':gateway}
        assert_no_drift(s, originals)
        require(not overlay.exists(), 'prior_native_overlay_requires_review')
        overlay_bytes = ('# Firbo API only; generated after isolated boot/auth checks.\nservices:\n  firbo-api:\n'
             f'    image: "{new_id}"\n    build: !reset null\n    pull_policy: never\n'
             '    environment:\n      FIRBO_CONTROL_WRITES_ENABLED: "false"\n').encode()
        private_write(overlay, overlay_bytes)
        merged = compose_config(s['project'], [*s['files'],overlay], s['workdir'])
        normalized = json.loads(json.dumps(merged))
        new_service = normalized['services']['firbo-api']; old_service=s['effective']['services']['firbo-api']
        require(new_service.get('image') == new_id and not new_service.get('build') and new_service.get('environment',{}).get('FIRBO_CONTROL_WRITES_ENABLED') == 'false', 'overlay_not_applied')
        for key in ('image','build','pull_policy'):
            if key in old_service: new_service[key] = old_service[key]
            else: new_service.pop(key,None)
        if 'FIRBO_CONTROL_WRITES_ENABLED' in old_service.get('environment',{}):
            new_service['environment']['FIRBO_CONTROL_WRITES_ENABLED']=old_service['environment']['FIRBO_CONTROL_WRITES_ENABLED']
        else: new_service['environment'].pop('FIRBO_CONTROL_WRITES_ENABLED',None)
        require(normalized == s['effective'], 'overlay_changes_other_configuration')
        assert_no_drift(s, originals)
        new_env = changed_compose_env(originals[s['dotenv']], [*s['files'],overlay])
        private_write(release/'release.json', json.dumps({'contract':'firbo-native-release/v1','project':s['project'],
          'workdir':str(s['workdir']),'compose_files':[str(p) for p in s['files']], 'dotenv':str(s['dotenv']),
          'original_dotenv_index':list(originals).index(s['dotenv']), 'original_image':s['api']['Image'],
          'new_image':new_id,'new_env_hash':digest(new_env),'overlay':str(overlay),'overlay_hash':digest(overlay_bytes),
          'configuration_hashes':{str(p):digest(b) for p,b in originals.items() if p != s['dotenv']}}))
        atomic_replace(s['dotenv'], new_env); touched=True
        print('FIRBO_NATIVE_STAGE replace_api_only', file=sys.stderr, flush=True)
        docker(*compose_args(s['project'],[*s['files'],overlay]),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=s['workdir'],timeout=90)
        report['deployment_performed'] = True
        require(inspect('firbo-api')['Image'] == new_id, 'deployed_image_mismatch')
        probe_container('firbo-api')
        assert_other_containers(s)
        for _ in range(12):
            if public_probe(native=True): break
            time.sleep(2)
        else: raise Blocked('public_native_verification_failed')
        report.update(status='native_api_deployed_read_only',public_native_routes_verified=True,
                      authenticated_user_acceptance='pending_browser_check',other_containers_unchanged=True,
                      rollback_available=True)
    except BaseException as error:
        if touched:
            report['rollback_attempted']=True
            # Do not overwrite a concurrent operator's unrelated configuration edit.
            if s['dotenv'].read_bytes() != new_env:
                report['rollback_verified']=False
                raise Blocked('concurrent_configuration_change_manual_rollback_required') from None
            atomic_replace(s['dotenv'], originals[s['dotenv']])
            try:
                docker(*compose_args(s['project'],s['files']),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=s['workdir'],timeout=90)
                require(inspect('firbo-api')['Image'] == s['api']['Image'], 'rollback_image_mismatch')
                good=False
                for _ in range(12):
                    if public_probe(): good=True;break
                    time.sleep(2)
                require(good,'rollback_health_failed'); assert_other_containers(s)
                report['rollback_verified']=True
            except BaseException:
                report['rollback_verified']=False
                raise Blocked('rollback_not_verified_operator_action_required') from None
        if isinstance(error, Blocked): raise
        raise Blocked('release_interrupted_or_failed') from None
    finally:
        if canary_created:
            try: docker('rm','-f',canary)
            except Blocked: report['canary_cleanup_required']=True
        env_path.unlink(missing_ok=True)
        if (not touched or report.get('rollback_verified') is True) and overlay.exists() and overlay.read_bytes() == overlay_bytes:
            overlay.unlink()
        private_write(release/'report.json', json.dumps(report, indent=2))

def rollback_release(directory, report):
    release=Path(directory)
    require(release.is_absolute() and release.resolve()==release and release.parent==ROOT, 'invalid_rollback_directory')
    journal=json.loads(real_file(release/'release.json').read_text())
    require(journal.get('contract')=='firbo-native-release/v1', 'invalid_rollback_record')
    dotenv=real_file(journal['dotenv']); overlay=real_file(journal['overlay'])
    require(digest(dotenv.read_bytes())==journal['new_env_hash'] and digest(overlay.read_bytes())==journal['overlay_hash'], 'rollback_configuration_changed')
    require(inspect('firbo-api')['Image']==journal['new_image'], 'rollback_target_not_current')
    for name,expected in journal['configuration_hashes'].items():
        require(digest(real_file(name).read_bytes())==expected, 'rollback_original_config_changed')
    originals=[real_file(p) for p in journal['compose_files']]
    before=real_file(release/('original-'+str(journal['original_dotenv_index']))).read_bytes()
    other={name:identity(inspect(name)) for name in NAMES[1:]}
    atomic_replace(dotenv,before)
    report['rollback_attempted']=True
    docker(*compose_args(journal['project'],originals),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=journal['workdir'],timeout=90)
    require(inspect('firbo-api')['Image']==journal['original_image'],'rollback_image_mismatch')
    good=False
    for _ in range(12):
        if public_probe():good=True;break
        time.sleep(2)
    require(good,'rollback_health_failed')
    require(all(identity(inspect(n))==v for n,v in other.items()),'other_container_changed')
    overlay.unlink()
    report.update(status='original_api_restored',rollback_verified=True,release_directory=str(release))

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--apply',action='store_true');mode.add_argument('--rollback');args=parser.parse_args()
    report={'contract':'firbo-native-control-rollout/v1','checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),
       'status':'blocked','report_contains_secrets':False,'deployment_performed':False,'inference_requests':0,
       'gateway_mutations':0,'supabase_changes':False,'full_data_backup_performed':False,
       'scope':'native_control_api_read_only_not_full_agent_engine'}
    code=1
    try:
        require(os.geteuid()==0,'run_in_existing_hostinger_root_console')
        require(shutil.which('docker') is not None,'docker_not_available')
        if args.rollback:
            rollback_release(args.rollback,report)
            print(json.dumps(report,indent=2));return 0
        s=parse_state()
        report['keys_distinct']=s['env']['OMNIROUTE_API_KEY']!=s['env']['OMNIROUTE_MANAGEMENT_KEY']
        report['original_image_id']=s['api']['Image']
        require(public_probe(),'existing_public_api_unhealthy')
        if public_probe(native=True):
            report.update(status='native_api_already_present',authenticated_user_acceptance='pending_browser_check');code=0
        elif not args.apply:
            report.update(status='upgrade_required',apply_required=True);code=0
        else:
            require(shutil.disk_usage('/root').free>=512*1024*1024,'insufficient_free_disk')
            if not ROOT.exists(): ROOT.mkdir(mode=0o700)
            st=ROOT.lstat();require(ROOT.resolve()==ROOT and st.st_uid==0 and stat.S_ISDIR(st.st_mode) and not st.st_mode&0o077,'unsafe_release_directory')
            lockfd=os.open(ROOT/'release.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
            with os.fdopen(lockfd,'w') as lock:
                try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                except BlockingIOError: raise Blocked('another_native_release_is_running') from None
                apply_release(s,report)
            code=0
    except Blocked as error: report['error']=str(error)
    except BaseException: report['error']='unexpected_failure_no_private_details'
    print(json.dumps(report,indent=2))
    return code
if __name__=='__main__':raise SystemExit(main())
