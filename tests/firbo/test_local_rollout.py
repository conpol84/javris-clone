"""Local rollout pure validation contracts; full Docker lifecycle is a separate job."""
import importlib.util,json,hashlib
from pathlib import Path
import pytest
ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('local_rollout',ROOT/'deploy/hostinger/local_model_rollout.py')
l=importlib.util.module_from_spec(spec);spec.loader.exec_module(l)

def test_exact_runtime_hashes():
    assert set(l.SOURCE_HASHES)=={'firbo_free_app.py','free_inference.py','local_tts.py'}
    for n,h in l.SOURCE_HASHES.items():assert l.sha((ROOT/'src/openjarvis/server'/n).read_bytes())==h

def test_native_source_library_stays_pinned():
    assert l.sha((ROOT/'deploy/hostinger/native_control_rollout.py').read_bytes())==l.NATIVE_SHA

def test_admin_pilot_never_enables_customers_or_cloud():
    values=l.env_values('/ledger')
    assert values['FIRBO_FREE_ADMIN_PILOT']=='true'
    assert values['FIRBO_FREE_ORGANIZATIONS']==values['FIRBO_FREE_CLOUD_ORGANIZATIONS']==values['FIRBO_FREE_OPENROUTER_MODELS']==''
    assert values['FIRBO_CONTROL_WRITES_ENABLED']=='false'
    assert values['FIRBO_FREE_LOCAL_MODELS']=='qwen3:1.7b'
    assert values['FIRBO_FREE_MODEL_DIGEST']==l.MODEL_SHA

class Commands:
    def __init__(self):self.args=[]
    def docker(self,*args,**kw):self.args.append(args)

@pytest.mark.parametrize('downloader',[True,False])
def test_model_has_no_public_port_and_hard_resource_limits(tmp_path,downloader):
    n=Commands();l.ollama_run(n,'test',l.IMAGE,'testnet',tmp_path/'models',tmp_path,downloader=downloader)
    args=n.args[0]
    assert '--publish' not in args and '-p' not in args and '--privileged' not in args
    assert args[args.index('--memory')+1]==args[args.index('--memory-swap')+1]=='3g'
    assert args[args.index('--cpus')+1]=='1.25'
    assert 'OLLAMA_NO_CLOUD=1' in args and 'OLLAMA_NUM_PARALLEL=1' in args
    assert 'readonly' in args[args.index('--mount')+1] if not downloader else True

def test_unexpected_host_rejected_before_docker(monkeypatch):
    monkeypatch.setattr(l.platform,'node',lambda:'another-server')
    with pytest.raises(l.Blocked,match='wrong_host'):l.check_resources()

def test_non_pinned_source_ref_rejected():
    with pytest.raises(l.Blocked,match='invalid_source_ref'):l.download('main','a','x')

def test_corrupt_model_fails_before_reading_untrusted_descriptors(tmp_path):
    p=tmp_path/'manifests/registry.ollama.ai/library/qwen3/1.7b';p.parent.mkdir(parents=True);p.write_text('{}')
    with pytest.raises(l.Blocked,match='model_manifest_changed'):l.verify_model(tmp_path)

def test_wrong_model_manifest_is_not_a_success(tmp_path):
    with pytest.raises(l.Blocked,match='model_manifest_missing'):l.verify_model(tmp_path)

def test_compose_changes_are_fenced(tmp_path):
    old={'services':{'firbo-api':{'image':'old','build':{'context':'.'},'command':['original'],'environment':{'SECRET':'not-real'},'volumes':[{'target':'/home/openjarvis','source':'old','type':'bind'}],'networks':{'default':None}}},'networks':{'default':{'name':'oldnet'}}}
    s={'effective':old}
    import copy
    merged=copy.deepcopy(old);v=merged['services']['firbo-api']
    v.update(image='new',command=['openjarvis.server.firbo_free_app:app'],pull_policy='never');v.pop('build')
    v['environment'].update(l.env_values('/var/lib/firbo-free/admission.sqlite3'))
    v['volumes'].append({'target':'/var/lib/firbo-free','source':str(tmp_path),'type':'bind'});v['networks']['firbo_local']=None
    merged['networks']['firbo_local']={'name':'privatenet','external':True}
    l.validate_overlay(s,merged,'new','privatenet',tmp_path)
    merged['services']['injected']={'privileged':True}
    with pytest.raises(l.Blocked,match='unexpected_compose_change'):l.validate_overlay(s,merged,'new','privatenet',tmp_path)
