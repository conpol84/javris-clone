import {CONNECTED_KINDS,isConnectedKind,providerSettings,publicSettings,authorizeUrl,exchangeToken,providerSnapshot,revokeToken,originOnly,text,ConnectionFailure,type Env,type Token} from './connected-providers.ts';
import {BRIDGE_KINDS,isBridgeKind,parseBridge,readBridge} from './device-bridges.ts';
// The caller is the existing authenticated integrations entrypoint. Database client
// is structural here so handler tests can run without real secrets or Supabase.
type DB=any;
const MANAGERS=['owner','admin','manager'];
const random=()=>{const b=crypto.getRandomValues(new Uint8Array(32));return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');};
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('');
const pkce=async(s:string)=>btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const publicConfig=(env:Env)=>{
  const primary=originOnly(env('APP_URL')??'https://firboai.app');
  const origins=[primary,...(env('FIRBO_APP_ORIGINS')??'').split(',').map(s=>s.trim()).filter(Boolean).map(originOnly)];
  const redirect=originOnly(env('SUPABASE_URL')??'')+'/functions/v1/integrations';
  return{primary,origins,redirect};
};
export const isConnectionAction=(a:unknown)=>typeof a==='string'&&['connection_manifest','connection_start','connection_complete','connection_connect','connection_snapshot','connection_disconnect'].includes(a);
export function isConnectionCallback(req:Request):boolean{return req.method==='GET'&&(new URL(req.url).searchParams.get('state')??'').startsWith('fc2_');}
/** The callback NEVER connects an account by itself. The original signed-in user
 * must finalize using their Firbo session. This prevents account-linking CSRF.
 */
export async function forwardConnectionCallback(req:Request,db:DB,env:Env):Promise<Response>{
  const cfg=publicConfig(env);const q=new URL(req.url).searchParams;const raw=q.get('state')??'';
  const headers={'cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff'};
  if(!/^fc2_[a-f0-9]{64}$/.test(raw))return new Response('Invalid connection state',{status:400,headers});
  const {data:s,error}=await db.from('firbo_connection_states').select('return_origin,expires_at,status').eq('state_hash',await hash(raw)).maybeSingle();
  if(error||!s||s.status!=='pending'||(!Number.isFinite(Date.parse(s.expires_at))||Date.parse(s.expires_at)<=Date.now())||!cfg.origins.includes(s.return_origin))return new Response('This connection request expired. Return to Firbo and start again.',{status:400,headers});
  const fragment=new URLSearchParams({firbo_connection:'1',state:raw});
  if(q.get('error'))fragment.set('error','authorization_denied');
  else {const code=text(q.get('code'),4096);if(!code)return new Response('Missing authorization code',{status:400,headers});fragment.set('code',code);const realm=q.get('realmId');if(realm&&/^\d{1,30}$/.test(realm))fragment.set('realm_id',realm);}
  return new Response(null,{status:303,headers:{...headers,location:s.return_origin+'/integrations#'+fragment}});
}
async function manager(db:DB,org:string,user:string){
  const {data,error}=await db.from('organization_members').select('role').eq('organization_id',org).eq('user_id',user).maybeSingle();
  if(error||!data||!MANAGERS.includes(data.role))throw new ConnectionFailure('forbidden');
}
const ensureRuntime=(env:Env)=>{if(env('FIRBO_CONNECTIONS_ENABLED')!=='true')throw new ConnectionFailure('backend_setup_required');};
async function getConnection(db:DB,id:string,user:string){
  const {data,error}=await db.from('integrations').select('id,organization_id,kind,name,config,status').eq('id',id).maybeSingle();
  if(error||!data)throw new ConnectionFailure('not_found');await manager(db,data.organization_id,user);
  if(!isConnectedKind(data.kind)&&!isBridgeKind(data.kind))throw new ConnectionFailure('bad_request');
  return data;
}
async function getSecret(db:DB,id:string){
  const {data,error}=await db.from('integration_secrets').select('secret').eq('integration_id',id).maybeSingle();
  if(error||!data)throw new ConnectionFailure('reauth_required');
  try{return JSON.parse(data.secret);}catch{throw new ConnectionFailure('reauth_required');}
}
async function refreshed(db:DB,connection:any,secret:any,env:Env,http:typeof fetch){
  if(!isConnectedKind(connection.kind))return secret;
  if(['salesforce','quickbooks'].includes(connection.kind)&&connection.config?.environment!==providerSettings(connection.kind,env).environment)throw new ConnectionFailure('reconnect_required');
  if(Number(secret.expires_at)-Date.now()>60_000)return secret;
  if(!secret.refresh_token)throw new ConnectionFailure('reauth_required');
  const lease=crypto.randomUUID();
  const {data:locked,error}=await db.rpc('firbo_acquire_connection_refresh',{p_id:connection.id,p_lease:lease});
  if(error||!locked)throw new ConnectionFailure('refresh_busy');
  try{
    // Re-read after acquiring: another request may have just refreshed the token.
    secret=await getSecret(db,connection.id);
    if(Number(secret.expires_at)-Date.now()>60_000)return secret;
    const t=await exchangeToken(connection.kind,{grant_type:'refresh_token',refresh_token:secret.refresh_token},env,http);
    const next={...secret,...t,refresh_token:t.refresh_token??secret.refresh_token,instance_url:t.instance_url??secret.instance_url};
    const {data:row,error:saveError}=await db.from('integration_secrets').update({secret:JSON.stringify(next)}).eq('integration_id',connection.id).eq('refresh_lease_id',lease).select('integration_id').maybeSingle();
    if(saveError||!row)throw new ConnectionFailure('save_failed');return next;
  }finally{await db.from('integration_secrets').update({refresh_lease_id:null,refresh_lease_until:null}).eq('integration_id',connection.id).eq('refresh_lease_id',lease);}
}
export async function connectionAction(body:Record<string,any>,req:Request,user:{id:string},db:DB,env:Env,http:typeof fetch=fetch):Promise<Record<string,unknown>>{
  const action=body.action;const config=publicConfig(env);
  if(action==='connection_manifest'){
    await manager(db,text(body.organization_id,80),user.id);
    const {error}=await db.from('firbo_connection_states').select('id').limit(0);
    const enabled=env('FIRBO_CONNECTIONS_ENABLED')==='true'&&!error;
    return{contract:'firbo-connections/v1',enabled,redirect_uri:config.redirect,
      providers:CONNECTED_KINDS.map(kind=>{try{return {...publicSettings(kind,env),enabled};}catch{return{kind,enabled:false,configured:false,read_only:true,environment:'unknown',secret_names:[]};}}),
      bridges:BRIDGE_KINDS.map(kind=>({kind,enabled,configured:!!env('FIRBO_DEVICE_ALLOWED_ORIGINS')?.trim(),read_only:true})),server_error:error?'schema_required':!enabled?'runtime_disabled':null};
  }
  ensureRuntime(env);
  if(action==='connection_start'){
    const org=text(body.organization_id,80);await manager(db,org,user.id);
    if(!isConnectedKind(body.kind))throw new ConnectionFailure('bad_request');
    const kind=body.kind,name=text(body.name,80);if(!name)throw new ConnectionFailure('invalid_fields');
    const incoming=req.headers.get('origin');if(!incoming||!config.origins.includes(incoming))throw new ConnectionFailure('origin_not_allowed');
    const state='fc2_'+random(),verifier=random();
    const url=authorizeUrl(kind,env,config.redirect,state,await pkce(verifier));
    const {error}=await db.from('firbo_connection_states').insert({state_hash:await hash(state),organization_id:org,user_id:user.id,kind,name,return_origin:incoming,verifier,status:'pending',expires_at:new Date(Date.now()+600_000).toISOString()});
    if(error)throw new ConnectionFailure('save_failed');return{url,expires_in:600};
  }
  if(action==='connection_complete'){
    const raw=text(body.state,80);if(!/^fc2_[a-f0-9]{64}$/.test(raw))throw new ConnectionFailure('bad_state');
    const stateHash=await hash(raw);
    const {data:s,error}=await db.from('firbo_connection_states').select('*').eq('state_hash',stateHash).eq('user_id',user.id).maybeSingle();
    if(error||!s||(!Number.isFinite(Date.parse(s.expires_at))||Date.parse(s.expires_at)<=Date.now())||!isConnectedKind(s.kind)||req.headers.get('origin')!==s.return_origin||!config.origins.includes(s.return_origin))throw new ConnectionFailure('bad_state');
    await manager(db,s.organization_id,user.id);
    if(s.status==='completed'&&s.integration_id)return{ok:true,id:s.integration_id};
    if(s.status!=='pending')throw new ConnectionFailure('state_conflict');
    const code=text(body.code,4096);if(!code)throw new ConnectionFailure('bad_request');
    const {data:claim,error:claimError}=await db.from('firbo_connection_states').update({status:'exchanging'}).eq('state_hash',stateHash).eq('user_id',user.id).eq('status','pending').select('id').maybeSingle();
    if(claimError||!claim)throw new ConnectionFailure('state_conflict');
    let token:Token|undefined;
    try{
      const cfg=providerSettings(s.kind,env);
      token=await exchangeToken(s.kind,{grant_type:'authorization_code',code,redirect_uri:config.redirect,...(cfg.pkce?{code_verifier:s.verifier}:{})},env,http);
      const c={environment:cfg.environment,read_only:true,...(token.instance_url?{instance_url:token.instance_url}:{}),...(s.kind==='quickbooks'?{realm_id:text(body.realm_id,30)}:{})};
      const snap=await providerSnapshot(s.kind,token,c,env,http);
      const {data:id,error:saveError}=await db.rpc('firbo_save_connection',{p_org:s.organization_id,p_user:user.id,p_kind:s.kind,p_name:s.name,p_config:{...c,account:snap.account,verified_at:snap.observed_at},p_secret:JSON.stringify(token),p_state_hash:stateHash});
      if(saveError||typeof id!=='string')throw new ConnectionFailure('save_failed');
      return{ok:true,id,account:snap.account};
    }catch(e){
      // Do not leave a newly minted token usable after a failed durable connection.
      if(token)try{await revokeToken(s.kind,token,env,http);}catch{/* provider retry/review needed; never claim remote revocation */}
      await db.from('firbo_connection_states').update({status:'failed',verifier:null}).eq('state_hash',stateHash).eq('status','exchanging');
      throw e;
    }
  }
  if(action==='connection_connect'){
    const org=text(body.organization_id,80);await manager(db,org,user.id);
    const kind=body.kind;if(!isBridgeKind(kind))throw new ConnectionFailure('bad_request');
    const name=text(body.name,80);if(!name)throw new ConnectionFailure('invalid_fields');
    const parsed=parseBridge(kind,body.fields??{},env);const snap=await readBridge(kind,parsed.secret,parsed.config,env,http);
    const {data:id,error}=await db.rpc('firbo_save_connection',{p_org:org,p_user:user.id,p_kind:kind,p_name:name,p_config:{...parsed.config,account:snap.account,verified_at:snap.observed_at},p_secret:JSON.stringify(parsed.secret),p_state_hash:null});
    if(error||typeof id!=='string')throw new ConnectionFailure('save_failed');return{ok:true,id};
  }
  const c=await getConnection(db,text(body.id,80),user.id);
  if(action==='connection_snapshot'){
    try{
      let secret=await getSecret(db,c.id);
      const snap=isConnectedKind(c.kind)?await providerSnapshot(c.kind,await refreshed(db,c,secret,env,http),c.config??{},env,http):await readBridge(c.kind,secret,c.config??{},env,http);
      const {data:saved,error}=await db.from('integrations').update({status:'active',last_error:null,last_used_at:snap.observed_at}).eq('id',c.id).select('id').maybeSingle();
      if(error||!saved)throw new ConnectionFailure('save_failed');return{snapshot:snap};
    }catch(e){
      const code=e instanceof ConnectionFailure?e.code:'provider_failed';
      await db.from('integrations').update({status:'error',last_error:code}).eq('id',c.id);throw e;
    }
  }
  if(action==='connection_disconnect'){
    const secret=await getSecret(db,c.id);let revocation='manual';
    // Local revocation is atomic and occurs even if the external provider is offline.
    const {data:deleted,error}=await db.from('integrations').delete().eq('id',c.id).eq('organization_id',c.organization_id).select('id').maybeSingle();
    if(error||!deleted)throw new ConnectionFailure('save_failed');
    if(isConnectedKind(c.kind))try{await revokeToken(c.kind,secret,env,http);revocation='confirmed';}catch{/* local access gone; explicitly report remote manual step */}
    return{ok:true,provider_revocation:revocation};
  }
  throw new ConnectionFailure('bad_request');
}
