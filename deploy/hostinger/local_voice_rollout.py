#!/usr/bin/env python3
"""Install Firbo multilingual local voice beside the already-live local Qwen pilot.

Real changes with --apply: builds a pinned Piper runtime, downloads/verifies seven
approved voice models, starts one private sidecar and recreates ONLY firbo-api
with the matching /v1/firbo/free/speech route. No Supabase/provider/customer-plan
change, no public Piper port and no paid TTS call.

Usage:
  python3 local_voice_rollout.py --source-ref EXACT_COMMIT --apply
  python3 local_voice_rollout.py --rollback /root/firbo-voice-releases/RELEASE
"""
from __future__ import annotations
import argparse,datetime as dt,fcntl,hashlib,importlib.util,json,os
from pathlib import Path
import platform,re,shutil,stat,subprocess,sys,tempfile,time,urllib.request

ROOT=Path('/root/firbo-voice-releases')
RAW='https://raw.githubusercontent.com/conpol84/javris-clone/'
NATIVE_REF='705b94b9921bf85733a64d9b5704ba7dbfafb0ce'
NATIVE_SHA='c97c13436eecc4019061a261d15640b629629fdcde0d7e3f2a2353f6d573eb77'
BASE_IMAGE='python:3.12.14-slim-bookworm@sha256:1aaa65a85fda306ffb8b910824d4e93bdce61e212c7e87168123ea3073b41a1a'
PIPER_VERSION='1.8.0'
PIPER='firbo-piper'
SOURCE_HASHES={
 'free_inference.py':'450a4d7ae83e7e665b293fac245125221bbcbb225e904ccde23cfa091efa14a6',
 'firbo_free_app.py':'c9e4a914d95b5408b41f671f87da8ed00f98855f4797a91ed3a595650fbb6396',
 'local_tts.py':'8ef57ce61873be951f99f1b9d8128726091caee3fa021d015e50c74d84ab3885',
 'firbo_piper_server.py':'1439d5fabf7300fd2a2861c60512eecb9cb6d919ea8b011c856512f2f8114d9b',
}
VOICE_NAMES=['en_US-joe-medium','el_GR-rapunzelina-low','es_ES-davefx-medium','pt_BR-cadu-medium','fr_FR-gilles-low','de_DE-thorsten-medium','zh_CN-chaowen-medium']
VOICE_HASHES={
 'de_DE-thorsten-medium.onnx':'7e64762d8e5118bb578f2eea6207e1a35a8e0c30595010b666f983fc87bb7819',
 'de_DE-thorsten-medium.onnx.json':'974adee790533adb273a1ac88f49027d2a1b8f0f2cf4905954a4791e79264e85',
 'el_GR-rapunzelina-low.onnx':'eebb335946c5d868743ff35fbb66b6f00e431b5b9b2e18caf47d3f609a2bf2e1',
 'el_GR-rapunzelina-low.onnx.json':'24ccc31c1306df4364fd85b56aeb09aba8c185a1fdf7db1367a72d4affe478e4',
 'en_US-joe-medium.onnx':'58afce0321b8d9c46d7cdf9c16500cc55a793b4220212dba6b70fb788b3baf06',
 'en_US-joe-medium.onnx.json':'3d6d5410b3795cb1950595247ef8f06190719e6fdbfa3a2356d8ec368e1aad33',
 'es_ES-davefx-medium.onnx':'6658b03b1a6c316ee4c265a9896abc1393353c2d9e1bca7d66c2c442e222a917',
 'es_ES-davefx-medium.onnx.json':'0e0dda87c732f6f38771ff274a6380d9252f327dca77aa2963d5fbdf9ec54842',
 'fr_FR-gilles-low.onnx':'5cd711846720e261c2a176f6924c198a7424d0a75dd4b0a5357a5fb9cb739285',
 'fr_FR-gilles-low.onnx.json':'5a47cc0789e91267d17666bbec842dd92950669271a09023eb6970ee364cf88a',
 'pt_BR-cadu-medium.onnx':'765f0809a6ea9035d4a6d0d008dbf8876e68b2dd32029312672fa8f405bdb535',
 'pt_BR-cadu-medium.onnx.json':'5fe03aa3d4901880554905b12075713cd552598c8a350455a1ec73f8b4e6be19',
 'zh_CN-chaowen-medium.onnx':'820d64ac16048fbcf38dd0823d37fab5f5e0c2bd71b01ca5a50f553fac19e746',
 'zh_CN-chaowen-medium.onnx.json':'a6bb2caafa0645642f13cbf7e2f6fbbb16fded66e51109fc26d622f6472fa16f',
 'g2pW/MONOPHONIC_CHARS.txt':'e46c9190330e95757573159eef921a577849426728e72c0e6a427f9e4c00b31e',
 'g2pW/POLYPHONIC_CHARS.txt':'b63cd02d842dbaea32ca55b3fbbdef986a617854967cc2fb9ec1f2126715b747',
 'g2pW/config.py':'b6154e494355d14a8d2c8a38d07720f77b34479e26aab21a5f63495ae904da76',
 'g2pW/g2pw.onnx':'367b87bfb59826590d1d85bd19a21d46aad3332fb364eca0c61d93cabe1d0323',
 'g2pW/version':'517036ffbc4858eba27a01b85badcfd5e5c2a59a3d35d1898ab34567f818e799',
}
GiB=1024**3
class Blocked(Exception):pass
def require(ok,code):
    if not ok:raise Blocked(code)
def digest(b):return hashlib.sha256(b).hexdigest()
def private_write(path,data):
    raw=data.encode() if isinstance(data,str) else data
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
def safe_dir(path):
    path.mkdir(mode=0o700,parents=True,exist_ok=True);s=path.lstat()
    require(path.resolve()==path and s.st_uid==0 and stat.S_ISDIR(s.st_mode) and not s.st_mode&0o077,'unsafe_release_directory')
def download(ref,path,expected):
    require(re.fullmatch('[a-f0-9]{40}',ref),'invalid_source_ref')
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*a,**k):return None
    with urllib.request.build_opener(NoRedirect()).open(RAW+ref+'/'+path,timeout=25) as r:
        require(r.status==200,'source_download_failed');raw=r.read(250001)
    require(len(raw)<=250000 and digest(raw)==expected,'source_checksum_mismatch')
    return raw
def native():
    raw=download(NATIVE_REF,'deploy/hostinger/native_control_rollout.py',NATIVE_SHA)
    with tempfile.TemporaryDirectory() as d:
        p=Path(d)/'n.py';p.write_bytes(raw);spec=importlib.util.spec_from_file_location('firbo_native',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
    return m


LOCAL_ROOT=Path('/root/firbo-local-releases')
LOCAL_MODEL_IMAGE='ollama/ollama@sha256:292ee7945dfc3d5840a181f3ab86fedb1e66703e02c8af98b50f4da56b7e278c'
LOCAL_API_HASHES={
 'free_inference.py':'450a4d7ae83e7e665b293fac245125221bbcbb225e904ccde23cfa091efa14a6',
 'firbo_free_app.py':'792b06de39528842e1ef119692a809aa2bde70dd03ecc9af7024494e0f0f1518',
}
LOCAL_ENV={
 'FIRBO_FREE_ENABLED':'true',
 'FIRBO_FREE_ADMIN_PILOT':'true',
 'FIRBO_FREE_ORGANIZATIONS':'',
 'FIRBO_FREE_CLOUD_ORGANIZATIONS':'',
 'FIRBO_FREE_OPENROUTER_MODELS':'',
 'FIRBO_FREE_CLOUD_FIRST':'false',
 'FIRBO_FREE_LOCAL_MODELS':'qwen3:1.7b',
 'FIRBO_FREE_MODEL_DIGEST':'8f68893c685c3ddff2aa3fffce2aa60a30bb2da65ca488b61fff134a4d1730e7',
 'FIRBO_FREE_LEDGER':'/var/lib/firbo-free/admission.sqlite3',
 'FIRBO_CONTROL_WRITES_ENABLED':'false',
}


def local_base_hash_probe(n):
    code=r'''import hashlib,importlib.util,json
names=['free_inference.py','firbo_free_app.py']
print(json.dumps({x:hashlib.sha256(open(importlib.util.find_spec('openjarvis.server.'+x[:-3]).origin,'rb').read()).hexdigest() for x in names}))'''
    try:
        return json.loads(n.docker('exec','firbo-api','python','-c',code,timeout=10))
    except Exception:
        raise Blocked('active_local_source_probe_failed') from None

def local_model_state(n):
    """Validate only the exact successful local-model release that is active now."""
    active=n.real_file(LOCAL_ROOT/'active.json')
    meta=json.loads(active.read_text())
    release=Path(meta.get('release',''))
    require(release.is_absolute() and release.parent==LOCAL_ROOT and release.resolve()==release,'invalid_local_model_release')
    journal=json.loads(n.real_file(release/'release.json').read_text())
    require(journal.get('contract')=='firbo-local-release/v1','invalid_local_model_journal')
    require(journal.get('network') and re.fullmatch(r'firbo-local-[a-z0-9_-]{8,100}',journal['network']),'invalid_local_model_network')
    dotenv=n.real_file(journal['dotenv']); overlay=n.real_file(journal['overlay'])
    require(digest(dotenv.read_bytes())==journal['new_env_sha'],'active_local_env_drift')
    require(digest(overlay.read_bytes())==journal['overlay_sha'],'active_local_overlay_drift')

    states={name:n.inspect(name) for name in ('firbo-api','firbo-omniroute','firbo-caddy','firbo-redis')}
    require(all(v.get('State',{}).get('Running') is True for v in states.values()),'existing_stack_not_running')
    api=states['firbo-api'];cfg=api['Config'];host=api['HostConfig'];labels=cfg.get('Labels') or {}
    require(api.get('Image')==journal.get('new_image'),'active_local_api_image_drift')
    require(labels.get('com.docker.compose.service')=='firbo-api','wrong_compose_service')
    require(cfg.get('Entrypoint')==['python','-m','uvicorn'],'unexpected_api_entrypoint')
    require(cfg.get('Cmd')==['openjarvis.server.firbo_free_app:app','--host','0.0.0.0','--port','8000'],'unexpected_local_api_command')
    require(cfg.get('User') not in ('', 'root','0','0:0',None),'api_must_remain_unprivileged')
    require(not host.get('Privileged') and not host.get('PortBindings') and host.get('NetworkMode')!='host','unexpected_api_privilege_or_ports')

    project=labels.get('com.docker.compose.project','')
    require(project==journal.get('project') and re.fullmatch('[a-zA-Z0-9_-]{1,100}',project),'local_project_drift')
    workdir=Path(labels.get('com.docker.compose.project.working_dir',''))
    require(str(workdir)==journal.get('workdir') and workdir.is_absolute() and workdir.resolve()==workdir and workdir.is_dir(),'local_workdir_drift')
    file_names=[x for x in labels.get('com.docker.compose.project.config_files','').split(',') if x]
    require(2<=len(file_names)<=5,'unexpected_local_compose_files')
    files=[n.real_file(x) for x in file_names]
    require(all(p.parent==workdir for p in files),'unexpected_compose_layout')
    require(str(overlay) in [str(p) for p in files],'local_overlay_not_active')

    env=n.env_map(cfg.get('Env'))
    require(env.get('SUPABASE_URL','').rstrip('/')==n.EXPECTED_DB,'wrong_supabase_project')
    require(env.get('OMNIROUTE_HOST')=='http://omniroute:20128','wrong_gateway_target')
    require(n.PUBLIC_FRONTEND in [x.strip() for x in env.get('OPENJARVIS_CORS_ORIGINS','').split(',')],'frontend_origin_missing')
    require(all(env.get(k) for k in ('SUPABASE_PUBLISHABLE_KEY','OMNIROUTE_MANAGEMENT_KEY','OMNIROUTE_API_KEY')),'missing_existing_credentials')
    require(all(env.get(k)==v for k,v in LOCAL_ENV.items()),'local_runtime_env_drift')

    networks=set(api['NetworkSettings']['Networks'])
    require(journal['network'] in networks and len(networks)==2,'unexpected_local_api_networks')
    net_info=json.loads(n.docker('network','inspect',journal['network']))[0]
    require(net_info.get('Internal') is True,'local_network_not_internal')

    mounts=api.get('Mounts',[])
    targets={m.get('Destination'):m for m in mounts}
    require('/var/lib/firbo-free' in targets and targets['/var/lib/firbo-free'].get('RW') is True,'local_ledger_mount_missing')
    require(set(targets).issubset({'/home/openjarvis','/var/lib/firbo-free'}),'unexpected_local_api_mount')

    source=json.loads(n.docker('exec','firbo-api','python','-c',
      "import importlib.util,json;print(json.dumps(importlib.util.find_spec('openjarvis.server.firbo_free_app').origin))").strip())
    module=Path(source)
    require(re.fullmatch(r'/(usr/local/lib/python3\.\d+/site-packages|app/src)/openjarvis/server/firbo_free_app\.py',str(module)),'unexpected_local_module_location')
    hashes=local_base_hash_probe(n)
    require(all(hashes.get(k)==v for k,v in LOCAL_API_HASHES.items()),'active_local_source_drift')

    oll=n.inspect('firbo-ollama');oh=oll['HostConfig']
    require(oll.get('State',{}).get('Running') is True,'local_model_not_running')
    require(set(oll['NetworkSettings']['Networks'])=={journal['network']},'local_model_network_drift')
    require(not oh.get('PortBindings') and oh.get('ReadonlyRootfs') and not oh.get('Privileged'),'local_model_isolation_drift')
    require(oh.get('Memory')==3*GiB and oh.get('MemorySwap')==3*GiB and oh.get('NanoCpus')==1250000000,'local_model_resource_drift')
    require(oll['Config'].get('User')=='10001:10001','local_model_user_drift')
    require(oll['Config'].get('Labels',{}).get('app.firbo.local.release')==str(release),'local_model_release_label_drift')
    expected_image=n.docker('image','inspect','--format','{{.Id}}',LOCAL_MODEL_IMAGE).strip()
    require(oll.get('Image')==expected_image,'local_model_image_drift')

    effective=n.compose_config(project,files,workdir)
    service=effective['services']['firbo-api']
    require(service.get('image')==api['Image'] and service.get('entrypoint')==cfg['Entrypoint'] and service.get('command')==cfg['Cmd'],'local_compose_api_drift')
    require(not service.get('ports') and not service.get('privileged'),'compose_unsafe_runtime')
    return dict(states=states,api=api,env=env,project=project,workdir=workdir,files=files,dotenv=dotenv,
                effective=effective,module=module.parent,network=journal['network'],local_release=release,local_journal=journal)
def check_host():
    require(platform.node()=='srv2027143','wrong_host');require(platform.machine()=='x86_64' and (os.cpu_count() or 0)>=2,'unsupported_cpu')
    vals={}
    for line in Path('/proc/meminfo').read_text().splitlines():
        k,_,v=line.partition(':')
        if k in {'MemTotal','MemAvailable'}:vals[k]=int(v.strip().split()[0])*1024
    require(vals.get('MemTotal',0)>=7*GiB and vals.get('MemAvailable',0)>=2.25*GiB,'insufficient_current_memory')
    require(shutil.disk_usage('/root').free>=4*GiB,'insufficient_disk_headroom')
    return {'logical_cpus':os.cpu_count(),'ram_gib':round(vals['MemTotal']/GiB,2),'available_gib':round(vals['MemAvailable']/GiB,2)}
def run(args,timeout=60):
    p=subprocess.run(args,capture_output=True,text=True,timeout=timeout,check=False)
    require(p.returncode==0,'voice_subprocess_failed');return p.stdout.strip()
def verify_files(root):
    for rel,want in VOICE_HASHES.items():
        p=root/rel;require(p.is_file() and not p.is_symlink(),'voice_file_missing')
        h=hashlib.sha256()
        with p.open('rb') as f:
            for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
        require(h.hexdigest()==want,'voice_checksum_mismatch')
    return True
def common_network(n):
    api=set(n.inspect('firbo-api')['NetworkSettings']['Networks']);oll=set(n.inspect('firbo-ollama')['NetworkSettings']['Networks'])
    common=api&oll;require(len(common)==1,'local_network_not_unique');name=next(iter(common))
    require(json.loads(n.docker('network','inspect',name))[0].get('Internal') is True,'local_network_not_internal');return name
def owned_piper(n,release):
    info=n.inspect(PIPER);require(info.get('Config',{}).get('Labels',{}).get('app.firbo.voice.release')==str(release),'piper_not_owned');return info
def stop_piper(n,release):
    if n.docker('ps','-aq','--filter','name=^/'+PIPER+'$').strip():owned_piper(n,release);n.docker('rm','-f',PIPER)
def public_voice(n):
    try:
        if not n.public_probe(native=True):return False
        for base in [n.PUBLIC_API,n.PUBLIC_FRONTEND]:
            code,j=n.get_json(base+'/v1/firbo/free/speech')
            if code not in (401,405) or (code==401 and j.get('detail')!='sign_in_required'):return False
        return True
    except Exception:return False
def piper_probe(n,container='firbo-api'):
    code=r'''import json,urllib.request
for path in ['/health']:
 r=urllib.request.urlopen('http://firbo-piper:5000'+path,timeout=5);j=json.load(r)
 assert j.get('contract')=='firbo-piper/v1' and j.get('ready') is True and len(j.get('voices',[]))==7
req=urllib.request.Request('http://firbo-piper:5000/synthesize',data=json.dumps({'text':'Γεια σου. Είμαι ο Firbo.','voice':'el_GR-rapunzelina-low','length_scale':1.04},ensure_ascii=False).encode(),headers={'content-type':'application/json'})
with urllib.request.urlopen(req,timeout=30) as r:
 raw=r.read(1000000); assert r.headers.get_content_type()=='audio/wav' and raw[:4]==b'RIFF' and raw[8:12]==b'WAVE'
print(json.dumps({'ready':True,'greek_wav_bytes':len(raw)}))'''
    return json.loads(n.docker('exec',container,'python','-c',code,timeout=45))
def api_hash_probe(n,name):
    code=r'''import hashlib,importlib.util,json
names=['free_inference.py','firbo_free_app.py','local_tts.py']
print(json.dumps({x:hashlib.sha256(open(importlib.util.find_spec('openjarvis.server.'+x[:-3]).origin,'rb').read()).hexdigest() for x in names}))'''
    return json.loads(n.docker('exec',name,'python','-c',code,timeout=10))
def restore(n,release,report):
    j=json.loads(n.real_file(release/'release.json').read_text());require(j['contract']=='firbo-local-voice-release/v1','bad_release')
    env=n.real_file(j['dotenv']);overlay=n.real_file(j['overlay'])
    require(digest(env.read_bytes())==j['new_env_sha'] and digest(overlay.read_bytes())==j['overlay_sha'],'rollback_configuration_changed')
    n.atomic_replace(env,(release/'original.env').read_bytes())
    n.docker(*n.compose_args(j['project'],[Path(p) for p in j['files']]),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=j['workdir'],timeout=90)
    require(n.inspect('firbo-api')['Image']==j['old_api_image'],'rollback_api_mismatch')
    stop_piper(n,release);overlay.unlink();report.update(status='local_voice_removed_previous_api_restored',rollback_verified=True)
def apply(n,ref,report):
    report['resources']=check_host();s=local_model_state(n);require(n.public_probe(native=True),'native_api_not_ready')
    require(n.docker('ps','-q','--filter','name=^/firbo-ollama$').strip(),'local_model_not_running');network=common_network(n)
    require(not n.docker('ps','-aq','--filter','name=^/firbo-piper$').strip(),'existing_piper_requires_review')
    release=Path(tempfile.mkdtemp(prefix=dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ-'),dir=ROOT));release.chmod(0o700)
    source=release/'source';source.mkdir(mode=0o700);voices=release/'voices';voices.mkdir(mode=0o700);os.chown(voices,10001,10001)
    report.update(release_directory=str(release),private_backups_contain_secrets=True,old_api_image=s['api']['Image'])
    originals={p:p.read_bytes() for p in [*s['files'],s['dotenv']]};private_write(release/'original.env',originals[s['dotenv']])
    for name,h in SOURCE_HASHES.items():private_write(source,name,download(ref,'src/openjarvis/server/'+name,h))
    # Build the private Piper runtime from a pinned amd64 Python base.
    dockerfile=f'''FROM {BASE_IMAGE}
RUN pip install --no-cache-dir "piper-tts[zh]=={PIPER_VERSION}"
COPY --chmod=0644 firbo_piper_server.py /app/server.py
ENV HOME=/tmp FIRBO_PIPER_DATA=/voices
USER 10001:10001
ENTRYPOINT ["python","/app/server.py"]
'''
    private_write(source/'Dockerfile.piper',dockerfile)
    tag='firbo-piper:'+release.name.lower()
    n.docker('build','--pull=false','-f',str(source/'Dockerfile.piper'),'-t',tag,str(source),timeout=600)
    piper_id=n.docker('image','inspect','--format','{{.Id}}',tag).strip();require(n.IMAGE.fullmatch(piper_id),'invalid_piper_image')
    pkg=json.loads(n.docker('run','--rm','--entrypoint','python',piper_id,'-c',"import importlib.metadata,json;print(json.dumps({'piper':importlib.metadata.version('piper-tts')}))"))
    require(pkg.get('piper')==PIPER_VERSION,'piper_version_mismatch')
    print('FIRBO_VOICE_STAGE download_and_verify_voices',file=sys.stderr,flush=True)
    n.docker('run','--rm','--user','10001:10001','--mount',f'type=bind,src={voices},dst=/voices','--entrypoint','python',piper_id,
        '-m','piper.download_voices','--data-dir','/voices',*VOICE_NAMES,timeout=900)
    verify_files(voices)
    print('FIRBO_VOICE_STAGE private_piper',file=sys.stderr,flush=True)
    n.docker('run','-d','--name',PIPER,'--label','app.firbo.voice.release='+str(release),'--user','10001:10001',
        '--cpus','0.60','--memory','1250m','--memory-swap','1250m','--pids-limit','128','--read-only','--cap-drop','ALL',
        '--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,nosuid,nodev,size=128m,uid=10001,gid=10001',
        '--mount',f'type=bind,src={voices},dst=/voices,readonly','--network',network,'--network-alias','firbo-piper',
        '--restart','unless-stopped',piper_id,timeout=30)
    # Existing API proves DNS/private networking and actual Greek synthesis before cutover.
    for _ in range(15):
        try:smoke=piper_probe(n);break
        except Exception:time.sleep(1)
    else:raise Blocked('piper_smoke_failed')
    report['voice_smoke']=smoke
    companions={name:n.identity(n.inspect(name)) for name in ['firbo-omniroute','firbo-caddy','firbo-redis','firbo-ollama']}
    # Derive only the API, preserving all current deps/config/data.
    base='firbo-voice-base:'+s['api']['Image'][7:23];n.docker('image','tag',s['api']['Image'],base)
    api_source={k:v for k,v in SOURCE_HASHES.items() if k!='firbo_piper_server.py'}
    df='FROM '+base+'\n'+''.join(f'COPY --chmod=0644 {name} {s["module"]}/{name}\n' for name in api_source)
    df+='LABEL app.firbo.voice.source="'+ref+'"\n';private_write(source/'Dockerfile.api',df)
    api_tag='firbo-local-voice-api:'+release.name.lower();n.docker('build','--pull=false','--network=none','-f',str(source/'Dockerfile.api'),'-t',api_tag,str(source),timeout=180)
    new_id=n.docker('image','inspect','--format','{{.Id}}',api_tag).strip();require(n.IMAGE.fullmatch(new_id),'invalid_api_image')
    # Private canary joins only local network; auth routes must remain closed anonymously.
    canary='firbo-voice-canary-'+release.name.lower();envfile=release/'canary.env'
    env={**s['env'],'FIRBO_LOCAL_VOICE_ENABLED':'true'};private_write(envfile,''.join(k+'='+v+'\n' for k,v in env.items()))
    n.docker('run','-d','--name',canary,'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true',
        '--tmpfs','/tmp:rw,nosuid,nodev,size=16m','--env-file',str(envfile),'--entrypoint','python',new_id,
        '-m','uvicorn','openjarvis.server.firbo_free_app:app','--host','127.0.0.1','--port','8000')
    for _ in range(15):
        try:
            require(api_hash_probe(n,canary)==api_source,'api_source_mismatch')
            piper_probe(n,canary);break
        except Exception:time.sleep(1)
    else:raise Blocked('voice_api_canary_failed')
    n.docker('rm','-f',canary);envfile.unlink(missing_ok=True)
    overlay=s['workdir']/'compose.firbo-local-voice.yaml';require(not overlay.exists(),'existing_voice_overlay_requires_review')
    obj={'services':{'firbo-api':{'image':new_id,'pull_policy':'never','environment':{'FIRBO_LOCAL_VOICE_ENABLED':'true'}}}}
    raw=json.dumps(obj,indent=2).replace('"pull_policy": "never",','"pull_policy": "never",\n      "build": !reset null,').encode();private_write(overlay,raw)
    merged=n.compose_config(s['project'],[*s['files'],overlay],s['workdir']);v=merged['services']['firbo-api']
    require(v['image']==new_id and not v.get('build') and v['environment'].get('FIRBO_LOCAL_VOICE_ENABLED')=='true','voice_overlay_invalid')
    new_env=n.changed_compose_env(originals[s['dotenv']],[*s['files'],overlay])
    journal={'contract':'firbo-local-voice-release/v1','project':s['project'],'workdir':str(s['workdir']),'files':[str(p) for p in s['files']],
      'dotenv':str(s['dotenv']),'overlay':str(overlay),'overlay_sha':digest(raw),'new_env_sha':digest(new_env),'old_api_image':s['api']['Image'],
      'new_api_image':new_id,'piper_image':piper_id,'network':network}
    private_write(release/'release.json',json.dumps(journal,indent=2));n.atomic_replace(s['dotenv'],new_env)
    try:
        print('FIRBO_VOICE_STAGE replace_api_only',file=sys.stderr,flush=True)
        n.docker(*n.compose_args(s['project'],[*s['files'],overlay]),'up','-d','--no-deps','--no-build','--pull','never','--force-recreate','firbo-api',cwd=s['workdir'],timeout=90)
        require(n.inspect('firbo-api')['Image']==new_id,'api_cutover_mismatch');require(api_hash_probe(n,'firbo-api')==api_source,'api_source_mismatch')
        piper_probe(n,'firbo-api');require(all(n.identity(n.inspect(k))==val for k,val in companions.items()),'companion_changed')
        for _ in range(15):
            if public_voice(n):break
            time.sleep(2)
        else:raise Blocked('public_voice_route_failed')
    except BaseException:
        report['rollback_attempted']=True
        try:restore(n,release,report)
        except BaseException:report['rollback_verified']=False;report['manual_recovery_required']=True
        raise
    private_write(ROOT/'active.json',json.dumps({'release':str(release)}))
    report.update(status='local_voice_deployed_admin_pilot',piper_installed=True,api_deployment_performed=True,
      server_locales=['en','el','es','pt-BR','fr','de','zh-CN'],device_fallback_locales=['ar'],paid_api_calls=0,
      customer_routing_changed=False,companions_unchanged=True,public_voice_route_verified=True,rollback_available=True,
      signed_in_acceptance='pending_browser_test')

def main():
    p=argparse.ArgumentParser();p.add_argument('--source-ref');g=p.add_mutually_exclusive_group();g.add_argument('--apply',action='store_true');g.add_argument('--rollback');a=p.parse_args()
    report={'contract':'firbo-local-voice-rollout/v1','checked_at':dt.datetime.now(dt.timezone.utc).isoformat(),'status':'blocked',
      'report_contains_secrets':False,'piper_installed':False,'api_deployment_performed':False,'paid_api_calls':0,'supabase_changes':False,
      'customer_routing_changed':False,'scope':'existing_platform_admin_multilingual_local_voice_pilot'}
    code=1
    try:
        require(os.geteuid()==0,'use_hostinger_root_console');require(shutil.which('docker'),'docker_missing');safe_dir(ROOT)
        fd=os.open(ROOT/'release.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,'w') as lock:
            try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
            except BlockingIOError:raise Blocked('another_voice_release_running') from None
            n=native()
            if a.rollback:
                restore(n,Path(a.rollback),report);(ROOT/'active.json').unlink(missing_ok=True)
            elif (ROOT/'active.json').exists():
                release=Path(json.loads(n.real_file(ROOT/'active.json').read_text())['release']);owned_piper(n,release);piper_probe(n)
                require(public_voice(n),'active_voice_route_failed');report.update(status='local_voice_already_installed',release_directory=str(release))
            else:
                require(a.apply and a.source_ref and re.fullmatch('[a-f0-9]{40}',a.source_ref),'source_ref_required');apply(n,a.source_ref,report)
            code=0
    except BaseException as e:
        label=str(e);report['error']=label if re.fullmatch('[a-z0-9_]{1,100}',label) else 'voice_install_failed_no_private_details'
    print(json.dumps(report,ensure_ascii=False,indent=2));return code
if __name__=='__main__':raise SystemExit(main())
