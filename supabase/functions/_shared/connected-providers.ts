/** Explicit read-only adapters. No arbitrary URLs, queries, uploads or vehicle commands.
 * OAuth tokens stay in the server-only secret store. All injected dependencies are
 * for tests/deployment configuration, never values supplied by a model/browser.
 */
export const CONNECTED_KINDS = ['youtube','tiktok','salesforce','quickbooks'] as const;
export type ConnectedKind = typeof CONNECTED_KINDS[number];
export type Env = (key:string) => string | undefined;
export class ConnectionFailure extends Error {
  constructor(public code:string){ super(code); }
}
export const isConnectedKind = (v:unknown):v is ConnectedKind => typeof v==='string' && (CONNECTED_KINDS as readonly string[]).includes(v);
export const text = (v:unknown,max=200):string => typeof v==='string'?v.trim().slice(0,max):'';
export function originOnly(raw:string):string {
  let u:URL;try{u=new URL(raw);}catch{throw new ConnectionFailure('invalid_origin');}
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)throw new ConnectionFailure('invalid_origin');
  return u.origin;
}
export function salesforceOrigin(raw:string):string {
  const origin=originOnly(raw);const h=new URL(origin).hostname;
  if(!/^[a-z0-9][a-z0-9.-]*\.(?:my\.)?salesforce\.com$/.test(h)||h.includes('..'))throw new ConnectionFailure('invalid_salesforce_host');
  return origin;
}
export interface ProviderSettings {group:string;auth:string;token:string;scope:string;pkce:boolean;environment:string;extra?:Record<string,string>}
export function providerSettings(kind:ConnectedKind,env:Env):ProviderSettings {
  switch(kind){
    case 'youtube':return{group:'GOOGLE',auth:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/youtube.readonly',pkce:true,environment:'production',extra:{access_type:'offline',prompt:'consent'}};
    case 'tiktok':return{group:'TIKTOK',auth:'https://www.tiktok.com/v2/auth/authorize/',token:'https://open.tiktokapis.com/v2/oauth/token/',scope:'user.info.basic,video.list',pkce:false,environment:'production'};
    case 'salesforce':{
      const mode=env('SALESFORCE_ENVIRONMENT')??'sandbox';
      if(!['sandbox','production'].includes(mode))throw new ConnectionFailure('not_configured');
      const host=mode==='sandbox'?'https://test.salesforce.com':'https://login.salesforce.com';
      return{group:'SALESFORCE',auth:host+'/services/oauth2/authorize',token:host+'/services/oauth2/token',scope:'api refresh_token',pkce:true,environment:mode};
    }
    case 'quickbooks':{
      const mode=env('QUICKBOOKS_ENVIRONMENT')??'sandbox';
      if(!['sandbox','production'].includes(mode))throw new ConnectionFailure('not_configured');
      return{group:'QUICKBOOKS',auth:'https://appcenter.intuit.com/connect/oauth2',token:'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',scope:'com.intuit.quickbooks.accounting',pkce:false,environment:mode};
    }
  }
}
export function publicSettings(kind:ConnectedKind,env:Env){
  const s=providerSettings(kind,env);
  return{kind,configured:!!env(s.group+'_CLIENT_ID')&&!!env(s.group+'_CLIENT_SECRET'),scope:s.scope,environment:s.environment,read_only:true,
    // Salesforce/Intuit scopes themselves are broader than the adapter's allowlist.
    broad_provider_scope:kind==='salesforce'||kind==='quickbooks',secret_names:[s.group+'_CLIENT_ID',s.group+'_CLIENT_SECRET']};
}
export type JsonMap=Record<string,any>;
export async function boundedJson(url:string,init:RequestInit={},http:typeof fetch=fetch):Promise<JsonMap> {
  const abort=new AbortController();const timer=setTimeout(()=>abort.abort(),12_000);
  let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  try{
    const r=await http(url,{...init,redirect:'error',signal:abort.signal});
    if(!r.ok){await r.body?.cancel();throw new ConnectionFailure([401,403].includes(r.status)?'reauth_required':r.status===429?'rate_limited':'provider_failed');}
    if(!r.headers.get('content-type')?.includes('json')){await r.body?.cancel();throw new ConnectionFailure('invalid_response');}
    if(Number(r.headers.get('content-length')??0)>1_000_000){await r.body?.cancel();throw new ConnectionFailure('response_too_large');}
    reader=r.body?.getReader();if(!reader)throw new ConnectionFailure('invalid_response');
    let size=0;const chunks:Uint8Array[]=[];
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1_000_000)throw new ConnectionFailure('response_too_large');chunks.push(value);}
    const out=new Uint8Array(size);let p=0;for(const c of chunks){out.set(c,p);p+=c.length;}
    const j=JSON.parse(new TextDecoder().decode(out));if(!j||typeof j!=='object')throw new ConnectionFailure('invalid_response');
    if(j.error && typeof j.error==='string')throw new ConnectionFailure('provider_failed');
    return j;
  }catch(e){if(e instanceof ConnectionFailure)throw e;throw new ConnectionFailure('provider_failed');}
  finally{clearTimeout(timer);try{await reader?.cancel();}catch{/* already closed */}}
}
const bearer=(token:string)=>({authorization:`Bearer ${token}`,accept:'application/json'});
export interface Token {access_token:string;refresh_token?:string;expires_at:number;instance_url?:string;scope?:string}
export async function exchangeToken(kind:ConnectedKind,params:Record<string,string>,env:Env,http:typeof fetch=fetch):Promise<Token>{
  const cfg=providerSettings(kind,env);const id=env(cfg.group+'_CLIENT_ID'),secret=env(cfg.group+'_CLIENT_SECRET');
  if(!id||!secret)throw new ConnectionFailure('not_configured');
  const data:Record<string,string>={...params};const headers:Record<string,string>={'content-type':'application/x-www-form-urlencoded',accept:'application/json'};
  if(kind==='quickbooks')headers.authorization='Basic '+btoa(id+':'+secret);
  else {data[kind==='tiktok'?'client_key':'client_id']=id;data.client_secret=secret;}
  const out=await boundedJson(cfg.token,{method:'POST',headers,body:new URLSearchParams(data)},http);
  const access=text(out.access_token,16_384);if(!access)throw new ConnectionFailure('invalid_token');
  const seconds=out.expires_in===undefined&&kind==='salesforce'?1800:Number(out.expires_in);
  if(!Number.isFinite(seconds)||seconds<=0||seconds>365*86400)throw new ConnectionFailure('invalid_token');
  if(out.scope && kind==='tiktok' && !['user.info.basic','video.list'].every(x=>String(out.scope).split(',').includes(x)))throw new ConnectionFailure('missing_scope');
  if(out.scope && kind==='youtube' && !String(out.scope).split(' ').includes(cfg.scope))throw new ConnectionFailure('missing_scope');
  return{access_token:access,refresh_token:text(out.refresh_token,16_384)||undefined,expires_at:Date.now()+seconds*1000,
    ...(kind==='salesforce'&&out.instance_url?{instance_url:salesforceOrigin(out.instance_url)}:{}),scope:text(out.scope,2000)||undefined};
}
export function authorizeUrl(kind:ConnectedKind,env:Env,redirect:string,state:string,challenge:string):string{
  const c=providerSettings(kind,env),id=env(c.group+'_CLIENT_ID');if(!id||!env(c.group+'_CLIENT_SECRET'))throw new ConnectionFailure('not_configured');
  const u=new URL(c.auth);const p={response_type:'code',redirect_uri:redirect,scope:c.scope,state,...c.extra,[kind==='tiktok'?'client_key':'client_id']:id};
  for(const[k,v]of Object.entries(p))u.searchParams.set(k,v);
  if(c.pkce){u.searchParams.set('code_challenge',challenge);u.searchParams.set('code_challenge_method','S256');}
  return u.toString();
}
export interface Snapshot { account:string;rows:{id:string;label:string;detail:string}[];sampled:boolean;observed_at:string;read_only:true }
const snapshot=(account:string,rows:Snapshot['rows'],sampled=false):Snapshot=>({account,rows,sampled,observed_at:new Date().toISOString(),read_only:true});
const items=(j:JsonMap,key:string):JsonMap[]=>{if(!Array.isArray(j[key]))throw new ConnectionFailure('invalid_response');return j[key];};
export async function providerSnapshot(kind:ConnectedKind,token:Token,config:JsonMap,env:Env,http:typeof fetch=fetch):Promise<Snapshot>{
  const headers=bearer(token.access_token);
  if(kind==='youtube'){
    const j=await boundedJson('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true&maxResults=10',{headers},http);
    const a=items(j,'items');if(!a.length)throw new ConnectionFailure('no_channel');
    return snapshot(text(a[0].snippet?.title),a.map(c=>({id:text(c.id),label:text(c.snippet?.title),detail:JSON.stringify({videos:c.statistics?.videoCount??null,views:c.statistics?.viewCount??null,subscribers:c.statistics?.hiddenSubscriberCount?null:c.statistics?.subscriberCount??null})})),!!j.nextPageToken);
  }
  if(kind==='tiktok'){
    const user=await boundedJson('https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',{headers},http);
    if(user.error?.code!=='ok'||!user.data?.user?.open_id)throw new ConnectionFailure('invalid_response');
    const j=await boundedJson('https://open.tiktokapis.com/v2/video/list/?fields=id,title,create_time,duration',{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({max_count:10})},http);
    if(j.error?.code!=='ok'||!Array.isArray(j.data?.videos))throw new ConnectionFailure('invalid_response');
    return snapshot(text(user.data.user.display_name),j.data.videos.map((v:JsonMap)=>({id:text(v.id),label:text(v.title),detail:JSON.stringify({duration:v.duration,created:v.create_time})})),j.data.has_more===true);
  }
  if(kind==='salesforce'){
    const origin=salesforceOrigin(token.instance_url??text(config.instance_url));
    const version=env('SALESFORCE_API_VERSION')??'v64.0';if(!/^v\d{2}\.0$/.test(version))throw new ConnectionFailure('not_configured');
    const q=encodeURIComponent('SELECT Id, Name, Industry FROM Account ORDER BY LastModifiedDate DESC LIMIT 10');
    const j=await boundedJson(`${origin}/services/data/${version}/query?q=${q}`,{headers},http);
    return snapshot(new URL(origin).hostname,items(j,'records').map(c=>({id:text(c.Id),label:text(c.Name),detail:text(c.Industry)})),true);
  }
  const realm=text(config.realm_id);if(!/^\d{1,30}$/.test(realm))throw new ConnectionFailure('invalid_realm');
  const mode=providerSettings(kind,env).environment;
  if(config.environment&&config.environment!==mode)throw new ConnectionFailure('reconnect_required');
  const origin=mode==='sandbox'?'https://sandbox-quickbooks.api.intuit.com':'https://quickbooks.api.intuit.com';
  const j=await boundedJson(`${origin}/v3/company/${realm}/companyinfo/${realm}`,{headers},http);
  if(!j.CompanyInfo?.CompanyName)throw new ConnectionFailure('invalid_response');
  // No amounts are invented or treated as zero; no payment/accounting write endpoint exists.
  return snapshot(text(j.CompanyInfo.CompanyName),[{id:realm,label:text(j.CompanyInfo.CompanyName),detail:text(j.CompanyInfo.Country)}]);
}
export async function revokeToken(kind:ConnectedKind,token:Token,env:Env,http:typeof fetch=fetch):Promise<void>{
  const c=providerSettings(kind,env),id=env(c.group+'_CLIENT_ID')??'',secret=env(c.group+'_CLIENT_SECRET')??'';
  const headers:Record<string,string>={'content-type':'application/x-www-form-urlencoded'};
  let url='',body:BodyInit;
  if(kind==='youtube'){url='https://oauth2.googleapis.com/revoke';body=new URLSearchParams({token:token.refresh_token??token.access_token});}
  else if(kind==='tiktok'){url='https://open.tiktokapis.com/v2/oauth/revoke/';body=new URLSearchParams({client_key:id,client_secret:secret,token:token.access_token});}
  else if(kind==='salesforce'){url=c.auth.replace('/authorize','/revoke');body=new URLSearchParams({token:token.refresh_token??token.access_token});}
  else{url='https://developer.api.intuit.com/v2/oauth2/tokens/revoke';headers['content-type']='application/json';headers.authorization='Basic '+btoa(id+':'+secret);body=JSON.stringify({token:token.refresh_token??token.access_token});}
  if(kind==='tiktok'){
    const out=await boundedJson(url,{method:'POST',headers,body},http);
    if(out.error || (out.data&&out.data.error_code))throw new ConnectionFailure('revoke_failed');
    return;
  }
  const res=await http(url,{method:'POST',headers,body,redirect:'error',signal:AbortSignal.timeout(12_000)});
  await res.body?.cancel();if(!res.ok)throw new ConnectionFailure('revoke_failed');
}
