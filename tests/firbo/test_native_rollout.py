"""Installer control-flow checks. Docker/network are mocked here; separate CI boots Docker."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import pytest

ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('native_rollout',ROOT/'deploy/hostinger/native_control_rollout.py')
r=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(r)
OLD='sha256:'+'a'*64
NEW='sha256:'+'b'*64

@pytest.mark.parametrize('rows', [['A=a\nB=b'],['A=x','A=y'],['bad-key=x'],['novalue'],['A=x\r'],['A=x\x00']])
def test_unsafe_environment_rejected(rows):
    with pytest.raises(r.Blocked):r.env_map(rows)

def test_environment_preserves_equals_in_token():
    assert r.env_map(['TOKEN=abc=def'])=={'TOKEN':'abc=def'}

def test_compose_setting_preserves_all_other_bytes():
    before=b'KEY="fake secret"\nCOMPOSE_FILE=old\nANOTHER=value\n'
    result=r.changed_compose_env(before,[Path('/root/app/base.yml'),Path('/root/app/native.yml')])
    assert result==b'KEY="fake secret"\nCOMPOSE_FILE=/root/app/base.yml:/root/app/native.yml\nANOTHER=value\n'

def test_setting_handles_missing_final_newline():
    assert r.changed_compose_env(b'KEY=a',[Path('/root/a.yml')]).startswith(b'KEY=a\n')

def test_duplicate_compose_setting_fails():
    with pytest.raises(r.Blocked):r.changed_compose_env(b'COMPOSE_FILE=a\nexport COMPOSE_FILE=b\n',[Path('/root/a')])

@pytest.mark.parametrize('path',['relative','/root/a:b','/root/space x','/root/a\nB=x'])
def test_unsafe_compose_path_fails(path):
    with pytest.raises(r.Blocked):r.changed_compose_env(b'',[Path(path)])

def test_subprocess_errors_do_not_include_raw_output(monkeypatch):
    monkeypatch.setattr(r.subprocess,'run',lambda *a,**kw:subprocess.CompletedProcess(a[0],1,b'private token',b'other secret'))
    with pytest.raises(r.Blocked) as error:r.docker('exec','name')
    assert str(error.value)=='command_failed_exec'

def test_source_hashes_are_exact():
    for n,h in r.SOURCE_HASHES.items():assert r.digest((ROOT/'src/openjarvis/server'/n).read_bytes())==h

def test_atomic_replacement_is_private(tmp_path):
    p=tmp_path/'env';p.write_bytes(b'old')
    r.atomic_replace(p,b'new');assert p.read_bytes()==b'new';assert p.stat().st_mode&0o777==0o600

@pytest.fixture
def system(tmp_path,monkeypatch):
    root=tmp_path/'releases';root.mkdir();work=tmp_path/'stack';work.mkdir()
    dotenv=work/'.env';dotenv.write_bytes(b'SECRET=synthetic-not-real\n')
    compose=work/'compose.yml';compose.write_text('services: {}\n')
    cfg={'services':{'firbo-api':{'image':'old','build':{'context':str(work)},'container_name':'firbo-api','environment':{'X':'test'}}}}
    states={name:{'Id':name+'-old','Image':OLD,'RestartCount':0,'State':{'StartedAt':'fixed'}} for name in r.NAMES}
    s={'states':copy.deepcopy(states),'api':copy.deepcopy(states['firbo-api']),'files':[compose],'dotenv':dotenv,'workdir':work,
       'project':'firbo_test','effective':cfg,'env':{'X':'test'},'network':'test_network','module':Path('/app/src/openjarvis/server')}
    history=[]
    def inspect(name):
        if name.startswith('firbo-native-canary-'):return {'HostConfig':{'PortBindings':{}},'Mounts':[]}
        return copy.deepcopy(states[name])
    def config(project,files,cwd):
        result=copy.deepcopy(cfg)
        if len(files)>1:
            result['services']['firbo-api'].update(image=NEW,pull_policy='never')
            result['services']['firbo-api'].pop('build');result['services']['firbo-api']['environment']['FIRBO_CONTROL_WRITES_ENABLED']='false'
        return result
    def docker(*args,**kw):
        history.append(args)
        if args[:2]==('image','inspect'):return NEW
        if args and args[0]=='exec':return json.dumps({'verified':True,'providers':3,'models':7,'combos':2,'inference_requests':0})
        if args and args[0]=='compose' and 'up' in args:
            native=any(str(v).endswith('compose.firbo-native-readonly.yaml') for v in args)
            states['firbo-api']['Image']=NEW if native else OLD
            states['firbo-api']['Id']='new' if native else 'restored'
        return ''
    def sources(dest):
        for name in r.SOURCE_HASHES:r.private_write(dest/name,(ROOT/'src/openjarvis/server'/name).read_bytes())
    monkeypatch.setattr(r,'ROOT',root);monkeypatch.setattr(r,'inspect',inspect);monkeypatch.setattr(r,'compose_config',config)
    monkeypatch.setattr(r,'docker',docker);monkeypatch.setattr(r,'download_sources',sources)
    monkeypatch.setattr(r,'probe_container',lambda name:{'passed':True});monkeypatch.setattr(r,'public_probe',lambda native=False:True)
    monkeypatch.setattr(r.time,'sleep',lambda _:None)
    return s,history,states

def test_install_changes_only_api_and_persists_readonly_overlay(system):
    s,hist,states=system;report={'status':'blocked'};r.apply_release(s,report)
    assert report['status']=='native_api_deployed_read_only'
    assert report['authenticated_user_acceptance']=='pending_browser_check'
    assert states['firbo-api']['Image']==NEW
    assert b'COMPOSE_FILE=' in s['dotenv'].read_bytes()
    ups=[c for c in hist if c[0]=='compose' and 'up' in c]
    assert len(ups)==1 and ups[0][-1]=='firbo-api'
    assert all(v in ups[0] for v in ('--no-deps','--no-build','--pull','never'))
    assert not any('down' in c or 'prune' in c for c in hist)
    assert all(states[n]['Id'].endswith('-old') for n in r.NAMES[1:])
    assert not list(r.ROOT.glob('*/canary.env'))

def test_canary_failure_never_recreates_live(system,monkeypatch):
    s,hist,states=system
    def broken(_):raise r.Blocked('synthetic_canary_failed')
    monkeypatch.setattr(r,'probe_container',broken)
    with pytest.raises(r.Blocked):r.apply_release(s,{'status':'blocked'})
    assert states['firbo-api']['Image']==OLD
    assert not any(c[0]=='compose' and 'up' in c for c in hist)
    assert s['dotenv'].read_bytes()==b'SECRET=synthetic-not-real\n'

def test_failed_public_check_restores_old_api_and_configuration(system,monkeypatch):
    s,hist,states=system;report={'status':'blocked'}
    monkeypatch.setattr(r,'public_probe',lambda native=False:not native)
    with pytest.raises(r.Blocked,match='public_native_verification_failed'):r.apply_release(s,report)
    assert report['rollback_verified'] is True
    assert states['firbo-api']['Image']==OLD
    assert s['dotenv'].read_bytes()==b'SECRET=synthetic-not-real\n'
    assert not (s['workdir']/'compose.firbo-native-readonly.yaml').exists()

def test_manual_rollback_restores_verified_original(system):
    s,hist,states=system;report={'status':'blocked'};r.apply_release(s,report)
    result={};r.rollback_release(report['release_directory'],result)
    assert result['status']=='original_api_restored'
    assert result['rollback_verified'] is True and states['firbo-api']['Image']==OLD

def test_manual_rollback_will_not_overwrite_new_operator_edits(system):
    s,hist,states=system;report={'status':'blocked'};r.apply_release(s,report)
    s['dotenv'].write_bytes(s['dotenv'].read_bytes()+b'NEW_USER_SETTING=yes\n')
    with pytest.raises(r.Blocked,match='rollback_configuration_changed'):r.rollback_release(report['release_directory'],{})
    assert states['firbo-api']['Image']==NEW

def test_success_report_contains_no_environment_secret(system):
    s,hist,states=system;report={'status':'blocked'};r.apply_release(s,report)
    assert 'synthetic-not-real' not in json.dumps(report)
    assert 'canary.env' not in json.dumps(report)

def test_unrelated_config_override_blocks_before_deployment(system,monkeypatch):
    s,hist,states=system;original=r.compose_config
    def bad(*args):
        cfg=original(*args)
        if len(args[1])>1:cfg['services']['unrelated']={'image':'evil'}
        return cfg
    monkeypatch.setattr(r,'compose_config',bad)
    with pytest.raises(r.Blocked,match='overlay_changes_other_configuration'):r.apply_release(s,{'status':'blocked'})
    assert states['firbo-api']['Image']==OLD
    assert b'COMPOSE_FILE' not in s['dotenv'].read_bytes()
