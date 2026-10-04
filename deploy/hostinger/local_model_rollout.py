#!/usr/bin/env python3
"""Guarded, CPU-sized Ollama + existing-admin pilot installation on srv2027143.

No customer plan/model switch, paid API call, Supabase write or public Ollama port.
The current native API and all its old data/config are retained for rollback.
Usage: python3 local_model_rollout.py --source-ref EXACT_COMMIT --apply
       python3 local_model_rollout.py --rollback /root/firbo-local-releases/RELEASE
Without --apply this only prints the selected configuration (no Docker changes).
"""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path('/root/firbo-local-releases')
NATIVE_REF='705b94b9921bf85733a64d9b5704ba7dbfafb0ce'
NATIVE_SHA='c97c13436eecc4019061a261d15640b629629fdcde0d7e3f2a2353f6d573eb77'
IMAGE='ollama/ollama@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c'
MODEL='qwen3:1.7b'
MODEL_SHA='8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7'
SOURCE_HASHES={'free_inference.py': '450a4d7ae83e7e665b293fac245125221bbcbb225e904ccde23cfa091efa14a6', 'firbo_free_app.py': 'c9e4a914d95b5408b41f671f87da8ed00f98855f4797a91ed3a595650fbb6396', 'local_tts.py': '8ef57ce61873be951f99f1b9d8128726091caee3fa021d015e50c74d84ab3885'}
RAW='https://raw.githubusercontent.com/conpol84/javris-clone/'
NAME='firbo-ollama'
NAMES=('firbo-api','firbo-omniroute','firbo-caddy','firbo-redis')
GiB=1024**3

class Blocked(Exception):pass

def require(ok,code):
    if not ok:raise Blocked(code)

def sha(data):return hashlib.sha256(data).hexdigest()

def download(ref,path,expected):
    require(re.fullmatch('[a-f0-9]{40}',ref),'invalid_source_ref')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k):return None
    with urllib.request.build_opener(NoRedirect()).open(RAW+ref+'/'+path,timeout=25) as r:
        require(r.status==200,'source_download_failed');raw=r.read(150001)
    require(len(raw)<=150000 and sha(raw)==expected,'source_checksum_mismatch')
    return raw

def load_native():
    data=download(NATIVE_REF,'deploy/hostinger/native_control_rollout.py',NATIVE_SHA)
    # No execution of unverified downloaded code. Keep import separate from apply.
    with tempfile.TemporaryDirectory(prefix='firbo-native-lib-') as d:
        p=Path(d)/'native.py';p.write_bytes(data)
        spec=importlib.util.spec_from_file_location('firbo_native_library',p)
        m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m

def check_resources():
    require(platform.node()=='srv2027143','wrong_host')
    require(platform.machine()=='x86_64' and (os.cpu_count() or 0)>=2,'unsupported_cpu')
    values={}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key,_,value=line.partition(':')
        if key in {'MemAvailable','MemTotal'}:values[key]=int(value.strip().split()[0])*1024
    require(values.get('MemTotal',0)>=7*GiB and values.get('MemAvailable',0)>=4.25*GiB,'insufficient_current_memory')
    require(shutil.disk_usage('/root').free>=10*GiB,'insufficient_disk_headroom')
    require(os.getloadavg()[0]<2,'host_busy_try_when_idle')
    return {'logical_cpus':os.cpu_count(),'ram_gib':round(values['MemTotal']/GiB,2),'available_gib':round(values['MemAvailable']/GiB,2)}

def private_dir(p):
    p.mkdir(mode=0o700,parents=False,exist_ok=True)
    s=p.lstat();require(p.resolve()==p and s.st_uid==0 and stat.S_ISDIR(s.st_mode) and not s.st_mode&0o077,'unsafe_release_directory')

def owned_container(n,name,release):
    info=n.inspect(name)
    require(info.get('Config',{}).get('Labels',{}).get('app.firbo.local.release')==str(release),'container_not_owned_by_release')
    return info

def stop_owned(n,name,release):
    ids=n.docker('ps','-aq','--filter','name=^/'+name+'$').strip()
    if ids:
        owned_container(n,name,release);n.docker('rm','-f',name)

def ollama_run(n,name,image,network,data,release,*,downloader=False):
    # Even model acquisition has no host port, privileges, or existing app mounts.
    args=['run','-d','--name',name,'--label','app.firbo.local.release='+str(release),
        '--user','10001:10001','--cpus','1.25','--memory','3g','--memory-swap','3g','--pids-limit','256',
        '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--tmpfs','/tmp:rw,nosuid,nodev,size=256m','--tmpfs','/home/ollama:rw,nosuid,nodev,size=16m,uid=10001,gid=10001',
        '-e','HOME=/home/ollama','-e','OLLAMA_HOST=0.0.0.0:11434','-e','OLLAMA_MODELS=/models',
        '-e','OLLAMA_NO_CLOUD=1','-e','OLLAMA_CONTEXT_LENGTH=2048','-e','OLLAMA_NUM_PARALLEL=1',
        '-e','OLLAMA_MAX_LOADED_MODELS=1','-e','OLLAMA_MAX_QUEUE=1','-e','OLLAMA_KEEP_ALIVE=2m',
        '--mount',f'type=bind,src={data},dst=/models'+('' if downloader else ',readonly'),
        '--network',network]
    if not downloader:args+=['--restart','unless-stopped','--network-alias','firbo-ollama']
    args.append(image)
    n.docker(*args,timeout=30)

def verify_model(data):
    manifest=data/'manifests/registry.ollama.ai/library/qwen3/1.7b'
    require(manifest.is_file() and not manifest.is_symlink(),'model_manifest_missing')
    raw=manifest.read_bytes();require(sha(raw)==MODEL_SHA,'model_manifest_changed')
    m=json.loads(raw);require(m.get('schemaVersion')==2 and len(m.get('layers',[]))<=10,'model_manifest_invalid')
    for part in [m['config'],*m['layers']]:
        dg=part.get('digest','');size=part.get('size')
        require(re.fullmatch(r'sha256:[a-f0-9]{64}',dg) and type(size) is int and 0<size<2*GiB,'model_descriptor_invalid')
        p=data/'blobs'/dg.replace(':','-')
        require(not p.is_symlink() and p.is_file() and p.stat().st_size==size,'model_blob_missing')
        h=hashlib.sha256()
        with p.open('rb') as f:
            for chunk in iter(lambda:f.read(1024*1024),b''):h.update(chunk)
        require(h.hexdigest()==dg[7:],'model_blob_checksum_mismatch')
    licenses=[p for p in m['layers'] if p['mediaType']=='application/vnd.ollama.image.license']
    require(len(licenses)==1,'license_missing')
    license_data=(data/'blobs'/licenses[0]['digest'].replace(':','-')).read_text()
    require('Apache License' in license_data and 'Version 2.0' in license_data,'license_unexpected')
    return {'manifest_sha256':MODEL_SHA,'all_blobs_verified':True,'license':'Apache-2.0'}

SMOKE=r'''
import json,time,urllib.request,unicodedata
base='http://firbo-ollama:11434'
def api(path,body=None):
 req=urllib.request.Request(base+path,data=None if body is None else json.dumps(body).encode(),headers={'content-type':'application/json'})
 with urllib.request.urlopen(req,timeout=100) as r:
  raw=r.read(128001)
  if len(raw)>128000:raise RuntimeError('response_too_large')
  return json.loads(raw)
for _ in range(30):
 try:version=api('/api/version');break
 except Exception:time.sleep(1)
else:raise RuntimeError('not_ready')
rows=[]
for question,want in [('Reply with exactly FIRBO_OK.','FIRBO_OK'),('Γράψε μόνο τη λέξη: έτοιμο','έτοιμο'),('Add 20 and 30. Reply only with the number.','50')]:
 start=time.monotonic()
 j=api('/api/chat',{'model':'qwen3:1.7b','messages':[{'role':'user','content':question}],'stream':False,'think':False,'keep_alive':'2m','options':{'num_ctx':2048,'num_predict':96,'num_thread':1,'temperature':0}})
 answer=j.get('message',{}).get('content','').strip()
 ok=j.get('done') is True and unicodedata.normalize('NFC',answer).strip(' .!"\n')==want
 rows.append({'answer':answer[:180],'expected':want,'matched':ok,'seconds':round(time.monotonic()-start,3),'eval_count':j.get('eval_count')})
print(json.dumps({'version':version,'samples':rows,'all_matched':all(r['matched'] for r in rows)},ensure_ascii=False))
'''
CANARY=r'''
import json,urllib.request,urllib.error,hashlib,importlib.util
out={}
for p in ['/health','/v1/firbo/free/status','/v1/firbo/free/chat/completions','/v1/firbo/session']:
 req=urllib.request.Request('http://127.0.0.1:8000'+p,data=b'{}' if p.endswith('/completions') else None,headers={'content-type':'application/json'})
 try:r=urllib.request.urlopen(req,timeout=3)
 except urllib.error.HTTPError as e:r=e
 with r:out[p]={'code':r.code,'body':json.loads(r.read(10000))}
out['hashes']={n:hashlib.sha256(open(importlib.util.find_spec('openjarvis.server.'+n[:-3]).origin,'rb').read()).hexdigest() for n in ['free_inference.py','firbo_free_app.py']}
print(json.dumps(out))
'''

def check_api(n,name):
    for _ in range(15):
        try:
            j=json.loads(n.docker('exec',name,'python','-c',CANARY,timeout=15))
            require(j['hashes']==SOURCE_HASHES,'runtime_source_mismatch')
            require(j['/health']=={'code':200,'body':{'status':'ok','contract':'firbo-control/v1'}},'native_health_failed')
            require(all(j[p]['code']==401 and j[p]['body'].get('detail')=='sign_in_required' for p in j if p.startswith('/v1/')),'anonymous_not_denied')
            return True
        except Exception:time.sleep(1)
    raise Blocked('local_api_boot_or_auth_check_failed')

def public_ready(n):
    try:
        if not n.public_probe(native=True):return False
        for base in [n.PUBLIC_API,n.PUBLIC_FRONTEND]:
            code,j=n.get_json(base+'/v1/firbo/free/status')
            if code!=401 or j.get('detail')!='sign_in_required':return False
        return True
    except Exception:return False

def env_values(ledger):
    return {'FIRBO_FREE_ENABLED':'true','FIRBO_FREE_ADMIN_PILOT':'true','FIRBO_FREE_ORGANIZATIONS':'',
            'FIRBO_FREE_CLOUD_ORGANIZATIONS':'','FIRBO_FREE_OPENROUTER_MODELS':'','FIRBO_FREE_CLOUD_FIRST':'false',
            'FIRBO_FREE_LOCAL_MODELS':MODEL,'FIRBO_FREE_MODEL_DIGEST':MODEL_SHA,
            'FIRBO_FREE_LEDGER':ledger,'FIRBO_CONTROL_WRITES_ENABLED':'false'}

def overlay_config(s,new_id,network,ledger):
    # JSON is YAML-compatible. Only this existing API service is changed.
    service={'image':new_id,'pull_policy':'never','command':['openjarvis.server.firbo_free_app:app','--host','0.0.0.0','--port','8000'],
             'environment':env_values('/var/lib/firbo-free/admission.sqlite3'),
             'volumes':[{'type':'bind','source':str(ledger),'target':'/var/lib/firbo-free'}],
             'networks':{'default':{},'firbo_local':{}}}
    # Respect existing compose service network keys rather than assuming default.
    old=s['effective']['services']['firbo-api'].get('networks') or {'default':{}}
    service['networks']={**(old if isinstance(old,dict) else {v:{} for v in old}),'firbo_local':{}}
    obj={'services':{'firbo-api':service},'networks':{'firbo_local':{'external':True,'name':network}}}
    # Compose's explicit build reset is the one non-JSON YAML tag needed.
    raw=json.dumps(obj,indent=2)
    return raw.replace('"pull_policy": "never",','"pull_policy": "never",\n      "build": !reset null,').encode()

def validate_overlay(s,merged,new_id,network,ledger):
    normal=json.loads(json.dumps(merged));old=s['effective']['services']['firbo-api'];v=normal['services']['firbo-api']
    require(v['image']==new_id and not v.get('build') and v['command'][0]=='openjarvis.server.firbo_free_app:app','overlay_not_applied')
    for k,val in env_values('/var/lib/firbo-free/admission.sqlite3').items():
        require(v['environment'].get(k)==val,'overlay_env_incorrect')
        if k in old.get('environment',{}):v['environment'][k]=old['environment'][k]
        else:v['environment'].pop(k,None)
    for k in ['image','build','command','pull_policy']:
        if k in old:v[k]=old[k]
        else:v.pop(k,None)
    added=[m for m in v.get('volumes',[]) if m.get('target')=='/var/lib/firbo-free']
    require(len(added)==1 and added[0].get('source')==str(ledger) and added[0].get('type')=='bind','ledger_mount_incorrect')
    v['volumes']=[m for m in v['volumes'] if m.get('target')!='/var/lib/firbo-free']
    require('firbo_local' in v.get('networks',{}),'local_network_missing');v['networks'].pop('firbo_local')
    require(normal.get('networks',{}).pop('firbo_local',{}).get('name')==network,'local_network_incorrect')
    require(normal==s['effective'],'unexpected_compose_change')

def verify_limits(n,release,network):
    info=owned_container(n,NAME,release);h=info['HostConfig'];nets=info['NetworkSettings']['Networks']
    require(h.get('Memory')==3*GiB and h.get('MemorySwap')==3*GiB and h.get('NanoCpus')==1250000000,'model_resource_limits_missing')
    require(h.get('ReadonlyRootfs') and not h.get('PortBindings') and not h.get('Privileged'),'model_isolation_failed')
    require(info['Config'].get('User')=='10001:10001' and set(nets)=={network},'model_network_or_user_wrong')
    require(info['Image']==n.docker('image','inspect','--format','{{.Id}}',IMAGE).strip(),'model_image_drift')
    mounts=info.get('Mounts',[])
    require(any(m.get('Destination')=='/models' and m.get('Source')==str(release/'models') and m.get('RW') is False for m in mounts),'model_mount_not_readonly')
    require(all(m.get('Destination') in {'/models','/tmp','/home/ollama'} for m in mounts),'model_unexpected_mount')
    require(json.loads(n.docker('network','inspect',network))[0].get('Internal') is True,'network_not_internal')
    return info

def restore(n,release,report):
    require(release.resolve()==release and release.parent==ROOT,'invalid_release_directory')
    j=json.loads(n.real_file(release/'release.json').read_text())
    require(j['contract']=='firbo-local-release/v1','invalid_release_record')
    env=n.real_file(j['dotenv']);overlay=n.real_file(j['overlay'])
    require(sha(env.read_bytes())==j['new_env_sha'] and sha(overlay.read_bytes())==j['overlay_sha'],'rollback_configuration_changed')
    api_ids=n.docker('ps','-aq','--filter','name=^/firbo-api$').strip()
    require(not api_ids or n.inspect('firbo-api')['Image'] in {j['new_image'],j['old_image']},'rollback_image_not_current')
    for p,h in j['original_hashes'].items():require(sha(n.real_file(p).read_bytes())==h,'rollback_original_config_changed')
    companions={name:n.identity(n.inspect(name)) for name in NAMES[1:]}
    old=(release/'original.env').read_bytes();n.atomic_replace(env,old)
    report['rollback_attempted']=True
    n.docker(*n.compose_args(j['project'],[Path(p) for p in j['files']]),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=j['workdir'],timeout=90)
    require(n.inspect('firbo-api')['Image']==j['old_image'],'rollback_image_mismatch')
    for _ in range(15):
        if n.public_probe(native=True):break
        time.sleep(2)
    else:raise Blocked('rollback_native_health_failed')
    require(all(n.identity(n.inspect(name))==x for name,x in companions.items()),'rollback_companion_changed')
    stop_owned(n,NAME,release);n.docker('network','rm',j['network'])
    overlay.unlink();report.update(status='native_api_restored_local_model_stopped',rollback_verified=True)
    # Model cache and old image are retained. Never prune unrelated resources.


def apply(n,source_ref,report):
    report['resources']=check_resources()
    s=n.parse_state();require(n.public_probe(native=True),'native_api_not_ready')
    require('firbo_local' not in s['effective'].get('networks',{}),'existing_local_network_key')
    require(not n.docker('ps','-aq','--filter','name=^/firbo-ollama$').strip(),'existing_ollama_requires_review')
    require(len(s['files'])<=3,'too_many_existing_compose_overrides')
    release=Path(tempfile.mkdtemp(prefix=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-'),dir=ROOT));release.chmod(0o700)
    network='firbo-local-'+release.name.lower();data=release/'models';data.mkdir(mode=0o700);os.chown(data,10001,10001)
    source=release/'source';source.mkdir(mode=0o700);ledger=release/'ledger';ledger.mkdir(mode=0o700)
    identity=json.loads(n.docker('exec','firbo-api','python','-c','import os,json;print(json.dumps([os.getuid(),os.getgid()]))'))
    require(identity[0]>0 and identity[1]>=0,'unexpected_api_user');os.chown(ledger,*identity)
    originals={p:p.read_bytes() for p in [*s['files'],s['dotenv']]}
    n.private_write(release/'original.env',originals[s['dotenv']])
    for i,p in enumerate(s['files']):n.private_write(release/('original-compose-'+str(i)),originals[p])
    report.update(release_directory=str(release),private_backups_contain_secrets=True,old_api_image=s['api']['Image'])
    overlay=s['workdir']/'compose.firbo-local-ai.yaml';require(not overlay.exists(),'existing_local_overlay_requires_review')
    downloader='firbo-model-download-'+release.name.lower();canary='firbo-local-canary-'+release.name.lower();probe='firbo-model-probe-'+release.name.lower()
    owns_net=False;touched=False;apistart=False;new_env=None;overlay_bytes=None
    try:
        for name,h in SOURCE_HASHES.items():n.private_write(source/name,download(source_ref,'src/openjarvis/server/'+name,h))
        print('FIRBO_LOCAL_STAGE pinned_image_and_model',file=sys.stderr,flush=True)
        n.docker('pull',IMAGE,timeout=600)
        image_id=n.docker('image','inspect','--format','{{.Id}}',IMAGE).strip();require(n.IMAGE.fullmatch(image_id),'invalid_ollama_image')
        ollama_run(n,downloader,image_id,'bridge',data,release,downloader=True)
        for _ in range(30):
            try:n.docker('exec',downloader,'ollama','list');break
            except Exception:time.sleep(1)
        else:raise Blocked('model_downloader_not_ready')
        n.docker('exec',downloader,'ollama','pull',MODEL,timeout=600)
        stop_owned(n,downloader,release);report['model_identity']=verify_model(data)
        n.docker('network','create','--internal','--label','app.firbo.local.release='+str(release),network);owns_net=True
        ollama_run(n,NAME,image_id,network,data,release)
        verify_limits(n,release,network)
        print('FIRBO_LOCAL_STAGE actual_model_smoke',file=sys.stderr,flush=True)
        n.docker('run','-d','--name',probe,'--label','app.firbo.local.release='+str(release),'--network',network,
                 '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--memory','128m','--cpus','0.25',
                 '--entrypoint','python',s['api']['Image'],'-c','import time;time.sleep(600)')
        smoke=json.loads(n.docker('exec',probe,'python','-c',SMOKE,timeout=350))
        report['model_smoke']=smoke;require(smoke.get('all_matched') is True,'model_smoke_answers_failed')
        report['model_stats']=json.loads(n.docker('stats','--no-stream','--format','{{json .}}',NAME))
        require(n.inspect(NAME)['State'].get('OOMKilled') is not True,'model_out_of_memory')
        stop_owned(n,probe,release)
        n.assert_no_drift(s,originals)
        print('FIRBO_LOCAL_STAGE api_canary',file=sys.stderr,flush=True)
        tag='firbo-local-api:'+release.name.lower();baseline='firbo-local-base:'+s['api']['Image'][7:23]
        n.docker('image','tag',s['api']['Image'],baseline)
        df=f'FROM {baseline}\n'+''.join(f'COPY --chmod=0644 {name} {s["module"]}/{name}\n' for name in SOURCE_HASHES)
        df+='LABEL app.firbo.local.source="'+source_ref+'"\n';n.private_write(source/'Dockerfile',df)
        n.docker('build','--pull=false','--network=none','-t',tag,str(source),timeout=180)
        new_id=n.docker('image','inspect','--format','{{.Id}}',tag).strip();require(n.IMAGE.fullmatch(new_id),'invalid_candidate_api_image')
        settings={**s['env'],**env_values('/tmp/admission.sqlite3')};envfile=release/'canary.env'
        n.private_write(envfile,''.join(k+'='+v+'\n' for k,v in settings.items()))
        n.docker('run','-d','--name',canary,'--label','app.firbo.local.release='+str(release),'--network',network,
                 '--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev,size=16m',
                 '--env-file',str(envfile),'--entrypoint','python',new_id,'-m','uvicorn','openjarvis.server.firbo_free_app:app','--host','127.0.0.1','--port','8000')
        check_api(n,canary);stop_owned(n,canary,release);envfile.unlink()
        n.assert_no_drift(s,originals)
        overlay_bytes=overlay_config(s,new_id,network,ledger);n.private_write(overlay,overlay_bytes)
        merged=n.compose_config(s['project'],[*s['files'],overlay],s['workdir']);validate_overlay(s,merged,new_id,network,ledger)
        n.assert_no_drift(s,originals)
        new_env=n.changed_compose_env(originals[s['dotenv']],[*s['files'],overlay])
        journal={'contract':'firbo-local-release/v1','old_image':s['api']['Image'],'new_image':new_id,'project':s['project'],'workdir':str(s['workdir']),
            'files':[str(p) for p in s['files']],'dotenv':str(s['dotenv']),'overlay':str(overlay),'overlay_sha':sha(overlay_bytes),'new_env_sha':sha(new_env),
            'network':network,'original_hashes':{str(p):sha(originals[p]) for p in s['files']}}
        n.private_write(release/'release.json',json.dumps(journal,indent=2))
        n.atomic_replace(s['dotenv'],new_env);touched=True
        print('FIRBO_LOCAL_STAGE replace_api_only',file=sys.stderr,flush=True)
        apistart=True;report['api_cutover_attempted']=True
        n.docker(*n.compose_args(s['project'],[*s['files'],overlay]),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=s['workdir'],timeout=90)
        require(n.inspect('firbo-api')['Image']==new_id,'new_api_image_mismatch')
        report['api_deployment_performed']=True
        check_api(n,'firbo-api');n.assert_other_containers(s)
        for _ in range(15):
            if public_ready(n):break
            time.sleep(2)
        else:raise Blocked('public_local_routes_failed')
        report.update(status='local_model_deployed_admin_pilot',api_deployment_performed=True,model_installed=True,
            public_local_routes_verified=True,companions_unchanged=True,signed_in_acceptance='pending_browser_test',rollback_available=True)
        n.private_write(ROOT/'active.json',json.dumps({'release':str(release)}))
    except BaseException:
        if touched:
            try:
                if not apistart:
                    require(s['dotenv'].read_bytes()==new_env,'concurrent_env_change');n.atomic_replace(s['dotenv'],originals[s['dotenv']])
                    report['rollback_verified']=n.public_probe(native=True)
                else:restore(n,release,report)
                report['status']='blocked'
            except BaseException:
                report['rollback_verified']=False;report['manual_recovery_required']=True
        raise
    finally:
        for name in [downloader,probe,canary]:
            try:stop_owned(n,name,release)
            except Exception:report['temporary_cleanup_required']=True
        (release/'canary.env').unlink(missing_ok=True)
        if report.get('status')!='local_model_deployed_admin_pilot' and not report.get('manual_recovery_required'):
            try:
                stop_owned(n,NAME,release)
                if owns_net and n.docker('network','ls','--filter','name=^'+network+'$','-q').strip():n.docker('network','rm',network)
                if overlay.exists() and overlay.read_bytes()==overlay_bytes:overlay.unlink()
            except Exception:report['cleanup_required']=True
        n.private_write(release/'report.json',json.dumps(report,ensure_ascii=False,indent=2))


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--source-ref');g=p.add_mutually_exclusive_group();g.add_argument('--apply',action='store_true');g.add_argument('--rollback');args=p.parse_args()
    report={'contract':'firbo-local-rollout/v1','checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'blocked','report_contains_secrets':False,
        'api_deployment_performed':False,'model_installed':False,'paid_api_calls':0,'supabase_changes':False,'customer_routing_changed':False,
        'model':MODEL,'cpu_limit':1.25,'memory_limit_gib':3,'scope':'existing_platform_admin_local_text_pilot_not_public_free_plan'}
    code=1
    try:
        require(os.geteuid()==0,'use_existing_hostinger_root_console');require(shutil.which('docker'),'docker_missing')
        if not(args.apply or args.rollback):report['status']='apply_required';print(json.dumps(report,indent=2));return 0
        private_dir(ROOT)
        fd=os.open(ROOT/'release.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise Blocked('another_local_release_running') from None
            n=load_native()
            if args.rollback:
                restore(n,Path(args.rollback),report)
                active=ROOT/'active.json'
                if active.exists() and json.loads(n.real_file(active).read_text()).get('release')==args.rollback:active.unlink()
            elif (ROOT/'active.json').exists():
                release=Path(json.loads(n.real_file(ROOT/'active.json').read_text())['release'])
                require(release.parent==ROOT and release.resolve()==release,'invalid_active_release')
                j=json.loads(n.real_file(release/'release.json').read_text())
                require(n.inspect('firbo-api')['Image']==j['new_image'],'active_api_drift')
                require(sha(n.real_file(j['dotenv']).read_bytes())==j['new_env_sha'],'active_env_drift')
                require(sha(n.real_file(j['overlay']).read_bytes())==j['overlay_sha'],'active_overlay_drift')
                verify_limits(n,release,j['network']);check_api(n,'firbo-api');require(public_ready(n),'active_route_failed')
                report.update(status='local_model_already_installed',release_directory=str(release),signed_in_acceptance='pending_browser_test')
            else:
                require(args.source_ref and re.fullmatch('[a-f0-9]{40}',args.source_ref),'source_ref_required')
                apply(n,args.source_ref,report)
            code=0
    except BaseException as exc:
        # Only fixed safe diagnostic labels may be returned. No subprocess stderr/env.
        label=str(exc)
        report['error']=label if re.fullmatch('[a-z0-9_]{1,100}',label) else 'local_install_failed_no_private_details'
    print(json.dumps(report,ensure_ascii=False,indent=2));return code
if __name__=='__main__':raise SystemExit(main())
