"""Real ASGI app + auth dependency and actual SQLite/HTTP engine. All remote data synthetic."""
# Use the established isolated module loader without initializing legacy OpenJarvis.
from test_control_plane import load, control, USER, ORG, AsyncClient
from fastapi.testclient import TestClient
from uuid import uuid4
import json
import httpx
import pytest
f=load('free_inference');a=load('firbo_free_app')

@pytest.fixture
def app_env(monkeypatch,tmp_path):
    for name,value in {'SUPABASE_URL':'https://identity.test','SUPABASE_PUBLISHABLE_KEY':'test-public','FIRBO_FREE_ENABLED':'true','FIRBO_FREE_ORGANIZATIONS':ORG}.items():monkeypatch.setenv(name,value)
    state={'requests':[],'role':'member','identity':USER,'org':ORG}
    def handler(req):
        state['requests'].append(req)
        if req.url.host=='identity.test':
            if req.headers.get('authorization')!='Bearer synthetic-user':return httpx.Response(401,json={})
            if req.url.path=='/auth/v1/user':return httpx.Response(200,json={'id':USER})
            assert req.url.params.get('user_id')=='eq.'+USER
            assert req.url.params.get('organization_id')=='eq.'+ORG
            return httpx.Response(200,json=[{'user_id':state['identity'],'organization_id':state['org'],'role':state['role']}])
        assert req.url.host=='firbo-ollama'
        return httpx.Response(200,json={'model':'qwen3:1.7b','done':True,'message':{'content':'Local result'},'prompt_eval_count':4,'eval_count':3})
    transport=httpx.MockTransport(handler)
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kw:AsyncClient(transport=kw.pop('transport',None) or transport,**kw))
    tmp_path.chmod(0o700)
    engine=f.FreeEngine([f.Route('ollama','qwen3:1.7b')],f.Ledger(str(tmp_path/'db')))
    monkeypatch.setattr(a,'engine',lambda:engine)
    with TestClient(a.create_free_app()) as client:yield client,state

def payload():return {'organization_id':ORG,'request_id':str(uuid4()),'messages':[{'role':'user','content':'Hello'}]}
AUTH={'authorization':'Bearer synthetic-user'}

def test_free_endpoint_requires_real_auth_dependency(app_env):
    client,state=app_env
    assert client.post('/v1/firbo/free/chat/completions',json=payload()).status_code==401
    assert state['requests']==[]

def test_success_is_user_org_bound_and_no_store(app_env):
    client,state=app_env;p=payload();r=client.post('/v1/firbo/free/chat/completions',json=p,headers=AUTH)
    assert r.status_code==200 and r.json()['firbo']['request_id']==p['request_id']
    assert r.headers['cache-control']=='no-store'
    assert client.post('/v1/firbo/free/chat/completions',json=p,headers=AUTH).status_code==409
    assert len([req for req in state['requests'] if req.url.host=='firbo-ollama'])==1

@pytest.mark.parametrize('change',[{'role':'viewer'},{'identity':'99999999-9999-4999-8999-999999999999'},{'org':'99999999-9999-4999-8999-999999999999'}])
def test_wrong_membership_cannot_use_local_compute(app_env,change):
    client,state=app_env;state.update(change)
    assert client.post('/v1/firbo/free/chat/completions',json=payload(),headers=AUTH).status_code==403
    assert all(req.url.host=='identity.test' for req in state['requests'])

@pytest.mark.parametrize('extra',[{'model':'paid/model'},{'cloud_allowed':True},{'url':'http://evil'},{'tools':[{}]}])
def test_client_cannot_choose_provider_or_external_transfer(app_env,extra):
    client,state=app_env
    assert client.post('/v1/firbo/free/chat/completions',json={**payload(),**extra},headers=AUTH).status_code==422
    assert all(req.url.host=='identity.test' for req in state['requests'])

def test_disabled_feature_does_not_open_route(app_env,monkeypatch):
    client,state=app_env;monkeypatch.delenv('FIRBO_FREE_ENABLED')
    assert client.post('/v1/firbo/free/chat/completions',json=payload(),headers=AUTH).status_code==503
    assert all(req.url.host=='identity.test' for req in state['requests'])

def test_unenabled_company_is_denied(app_env,monkeypatch):
    client,state=app_env;monkeypatch.delenv('FIRBO_FREE_ORGANIZATIONS')
    assert client.post('/v1/firbo/free/chat/completions',json=payload(),headers=AUTH).status_code==403
    assert all(req.url.host=='identity.test' for req in state['requests'])
