import hashlib,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('voice_rollout',ROOT/'deploy/hostinger/local_voice_rollout.py')
v=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(v)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def test_runtime_hashes_match_exact_source():
    for name,want in v.SOURCE_HASHES.items(): assert sha(ROOT/'src/openjarvis/server'/name)==want
def test_voice_manifest_is_complete_and_no_arabic_server_voice():
    assert len(v.VOICE_NAMES)==7 and len(v.VOICE_HASHES)==19
    assert not any(x.startswith('ar_') for x in v.VOICE_NAMES)
    assert 'zh_CN-chaowen-medium' in v.VOICE_NAMES and 'g2pW/g2pw.onnx' in v.VOICE_HASHES
def test_runtime_is_pinned_and_private_by_construction():
    text=(ROOT/'deploy/hostinger/local_voice_rollout.py').read_text()
    assert '@sha256:' in v.BASE_IMAGE and v.PIPER_VERSION=='1.8.0'
    assert "'--network-alias','firbo-piper'" in text
    assert '--publish' not in text
    assert "'--read-only'" in text and "'--cap-drop','ALL'" in text
    assert "'--memory','1250m'" in text and "'--cpus','0.60'" in text
    assert "paid_api_calls=0" in text or "paid_api_calls':0" in text
class Fake:
    PUBLIC_API='https://api';PUBLIC_FRONTEND='https://front'
    def public_probe(self,native=False):return native
    def get_json(self,url):return 401,{'detail':'sign_in_required'}
def test_public_voice_requires_anonymous_denial():
    assert v.public_voice(Fake()) is True
    f=Fake();f.get_json=lambda url:(200,{'ok':True});assert v.public_voice(f) is False

def test_preflight_targets_the_already_live_local_model_api_not_pre_ollama_native():
    text=(ROOT/'deploy/hostinger/local_voice_rollout.py').read_text()
    assert "openjarvis.server.firbo_free_app:app" in text
    assert "s=local_model_state(n)" in text
    assert "s=n.parse_state()" not in text
    assert "names=['free_inference.py','firbo_free_app.py']" in text
    assert "names=['free_inference.py','firbo_free_app.py','local_tts.py']" in text

def test_current_base_and_post_install_hash_sets_are_distinct():
    assert set(v.LOCAL_API_HASHES)=={'free_inference.py','firbo_free_app.py'}
    assert set(v.SOURCE_HASHES)=={'free_inference.py','firbo_free_app.py','local_tts.py','firbo_piper_server.py'}

def test_source_staging_uses_file_paths_not_directory_and_name_args():
    text=(ROOT/'deploy/hostinger/local_voice_rollout.py').read_text()
    assert "private_write(source/name,download(ref,'src/openjarvis/server/'+name,h))" in text
    assert "private_write(source,name,download" not in text
