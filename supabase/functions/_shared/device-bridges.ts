/** Reads only explicitly selected device resources, through operator-approved public
 * HTTPS origins. No cameras, security panels, door locks or vehicle command endpoints.
 * Private LAN discovery belongs in a separately paired local bridge, not cloud SSRF.
 */
import {boundedJson,ConnectionFailure,originOnly,text,type Env} from './connected-providers.ts';
export const BRIDGE_KINDS=['homeassistant_devices','traccar'] as const;
export const isBridgeKind=(v:unknown):v is typeof BRIDGE_KINDS[number]=>BRIDGE_KINDS.includes(v as never);
export function allowedBridgeOrigin(value:string,env:Env):string{
  const origin=originOnly(value);const host=new URL(origin).hostname;
  if(!/^[a-z][a-z0-9.-]*\.[a-z]{2,}$/.test(host)||/\.(local|internal|localhost|test)$/.test(host))throw new ConnectionFailure('invalid_origin');
  const allowed=(env('FIRBO_DEVICE_ALLOWED_ORIGINS')??'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!allowed.includes(origin))throw new ConnectionFailure('origin_not_allowed');
  return origin;
}
export function parseBridge(kind:string,fields:Record<string,unknown>,env:Env){
  if(!isBridgeKind(kind))throw new ConnectionFailure('bad_request');
  const host=allowedBridgeOrigin(text(fields.base_url,500),env);
  const token=text(fields.token,16_384);if(token.length<20)throw new ConnectionFailure('invalid_fields');
  const ids=[...new Set(text(fields.resource_ids,2000).split(',').map(x=>x.trim()).filter(Boolean))];
  if(!ids.length||ids.length>12)throw new ConnectionFailure('invalid_fields');
  if(!ids.every(id=>kind==='traccar'?/^[1-9]\d{0,12}$/.test(id):/^(sensor|binary_sensor|light|switch|climate)\.[a-z0-9_]{1,100}$/.test(id)))throw new ConnectionFailure('invalid_fields');
  return{secret:{token},config:{host,resource_ids:ids,read_only:true,environment:'production'}};
}
export async function readBridge(kind:string,secret:Record<string,string>,config:Record<string,unknown>,env:Env,http:typeof fetch=fetch){
  const parsed=parseBridge(kind,{base_url:config.host,token:secret.token,resource_ids:Array.isArray(config.resource_ids)?config.resource_ids.join(','):''},env);
  const rows=[];const headers={authorization:'Bearer '+secret.token,accept:'application/json'};
  for(const id of parsed.config.resource_ids){
    if(kind==='homeassistant_devices'){
      const j=await boundedJson(`${parsed.config.host}/api/states/${encodeURIComponent(id)}`,{headers},http);
      if(j.entity_id!==id||typeof j.state!=='string')throw new ConnectionFailure('invalid_response');
      rows.push({id,label:text(j.attributes?.friendly_name)||id,state:text(j.state),unit:text(j.attributes?.unit_of_measurement),observed_at:text(j.last_updated),available:!['unavailable','unknown'].includes(j.state)});
    }else{
      const j=await boundedJson(`${parsed.config.host}/api/devices?id=${id}`,{headers},http);
      if(!Array.isArray(j)||j.length!==1||String(j[0].id)!==id)throw new ConnectionFailure('invalid_response');
      // Deliberately omit GPS/driver routes, IMEI and commands from the initial scope.
      rows.push({id,label:text(j[0].name),state:text(j[0].status),unit:'',observed_at:text(j[0].lastUpdate),available:j[0].status==='online'});
    }
  }
  return{account:new URL(parsed.config.host).hostname,rows,observed_at:new Date().toISOString(),read_only:true};
}
