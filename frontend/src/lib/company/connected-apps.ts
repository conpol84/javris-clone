import {FunctionsHttpError} from '@supabase/supabase-js';
import {requireClient} from './client';
export const CONNECTED_APPS=['youtube','tiktok','salesforce','quickbooks','homeassistant_devices','traccar'] as const;
export type ConnectedApp=typeof CONNECTED_APPS[number];
export const isConnectedApp=(v:string):v is ConnectedApp=>(CONNECTED_APPS as readonly string[]).includes(v);
export interface ConnectionManifest {contract:'firbo-connections/v1';enabled:boolean;redirect_uri:string;server_error:string|null;providers:{kind:string;configured:boolean;enabled:boolean;read_only:boolean;environment:string;scope?:string;secret_names:string[];broad_provider_scope?:boolean}[];bridges:{kind:string;configured:boolean;enabled:boolean;read_only:boolean}[]}
export interface ConnectionSnapshot {account:string;rows:{id:string;label:string;detail?:string;state?:string;unit?:string;observed_at?:string;available?:boolean}[];sampled?:boolean;observed_at:string;read_only:true}
export class ConnectedAppError extends Error{constructor(public code:string){super(code);}}
const CODES=new Set(['forbidden','not_found','bad_state','state_conflict','refresh_busy','backend_setup_required','not_configured','invalid_fields','invalid_origin','origin_not_allowed','save_failed','reauth_required','reconnect_required','missing_scope','rate_limited','provider_failed','response_too_large','invalid_response','no_channel','connection_failed']);
async function call<T>(body:Record<string,unknown>):Promise<T>{
 const {data,error}=await requireClient().functions.invoke('integrations',{body});
 if(error){let code='connection_failed';if(error instanceof FunctionsHttpError)try{const j=await error.context.json();if(CODES.has(j.error))code=j.error;}catch{/* no raw provider error display */}throw new ConnectedAppError(code);}
 if(!data||typeof data!=='object')throw new ConnectedAppError('invalid_response');return data as T;
}
export async function connectionManifest(org:string){const data=await call<ConnectionManifest>({action:'connection_manifest',organization_id:org});if(data.contract!=='firbo-connections/v1'||!Array.isArray(data.providers)||!Array.isArray(data.bridges))throw new ConnectedAppError('backend_setup_required');return data;}
export async function beginConnection(org:string,kind:ConnectedApp,name:string){
 const r=await call<{url:string}>({action:'connection_start',organization_id:org,kind,name});
 const u=new URL(r.url);const hosts=['accounts.google.com','www.tiktok.com','test.salesforce.com','login.salesforce.com','appcenter.intuit.com'];
 if(u.protocol!=='https:'||u.username||u.password||u.port||!hosts.includes(u.hostname))throw new ConnectedAppError('invalid_response');return r;
}
export const finishConnection=(state:string,code:string,realm_id?:string)=>call<{ok:true;id:string}>({action:'connection_complete',state,code,realm_id});
export const connectBridge=(organization_id:string,kind:ConnectedApp,name:string,fields:Record<string,string>)=>call<{ok:true;id:string}>({action:'connection_connect',organization_id,kind,name,fields});
export async function readConnection(id:string){const r=await call<{snapshot:ConnectionSnapshot}>({action:'connection_snapshot',id});if(!r.snapshot||!Array.isArray(r.snapshot.rows)||r.snapshot.read_only!==true)throw new ConnectedAppError('invalid_response');return r.snapshot;}
export const disconnectConnection=(id:string)=>call<{ok:true;provider_revocation:'confirmed'|'manual'}>({action:'connection_disconnect',id});
