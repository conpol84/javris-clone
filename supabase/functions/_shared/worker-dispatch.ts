/** Authenticated Edge -> VPS selection. This never executes or reassigns work. */
export const DISPATCH_CONTRACT = 'firbo-worker-dispatch/v1';
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const DISPATCH_KINDS = new Set(['list','read','write','exec','browser_open','browser_task','open_app','shortcut','desktop_task','server_task']);
export type WorkerRequest = {
  requestId:string; organizationId:string; kind:string; params:Record<string,unknown>;
  devices:any[]; target?:string; deviceId?:string; goal?:string;
};
export type WorkerDecision = {
  contract:string; request_id:string; organization_id:string;
  worker:{kind:'computer'|'vps';id:string;name:string;platform:string};
  job:{kind:string;params:Record<string,unknown>}; reason:string;
};
export function canonicalDispatch(value:any):string {
  if (Array.isArray(value)) return '['+value.map(canonicalDispatch).join(',')+']';
  if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonicalDispatch(value[k])).join(',')+'}';
  const result=JSON.stringify(value);if(result===undefined)throw new Error('dispatch_bad_request');return result;
}
const folded=(value:string)=>value.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().trim().replace(/\s+/g,' ');
export function workerMatchesTarget(device:any,target:string):boolean{
  const value=folded(target),platform=String(device.platform??'').toLowerCase();
  if(['mac','mac mini','macbook'].includes(value))return /^(darwin|macos|mac)(\s|$)/.test(platform);
  if(['debian','linux'].includes(value))return /^linux(\s|$)/.test(platform);
  if(value==='windows')return /^(win32|windows)(\s|$)/.test(platform);
  return folded(String(device.name??''))===value;
}
export function validateWorkerDecision(value:any,input:WorkerRequest):WorkerDecision {
  if(value?.contract!==DISPATCH_CONTRACT||value.request_id!==input.requestId||value.organization_id!==input.organizationId
    ||!value.worker||!value.job||typeof value.reason!=='string'||value.reason.length>1000)throw new Error('dispatch_bad_response');
  if(typeof value.worker.name!=='string'||typeof value.worker.platform!=='string')throw new Error('dispatch_bad_response');
  if(input.kind==='server_task'){
    if(value.worker.kind!=='vps'||value.job.kind!==input.kind||canonicalDispatch(value.job.params)!==canonicalDispatch(input.params))throw new Error('dispatch_bad_response');
  }else{
    const dev=input.devices.find(d=>d.id===value.worker.id&&d.organization_id===input.organizationId);
    if(value.worker.kind!=='computer'||!dev||!UUID.test(value.worker.id)||input.deviceId&&input.deviceId!==value.worker.id
      ||value.worker.name!==dev.name||value.worker.platform!==dev.platform||input.target&&!workerMatchesTarget(dev,input.target))throw new Error('dispatch_bad_response');
    const exact=value.job.kind===input.kind&&canonicalDispatch(value.job.params)===canonicalDispatch(input.params);
    const goal=input.goal?.trim()||`Open ${String(input.params.app??'').trim()}`;
    const adapted=input.kind==='open_app'&&value.job.kind==='desktop_task'
      &&canonicalDispatch(value.job.params)===canonicalDispatch({goal})&&dev.capabilities?.full_control===true
      &&dev.capabilities?.job_kinds?.includes('desktop_task');
    if(!exact&&!adapted)throw new Error('dispatch_bad_response');
  }
  return value;
}
/** Persist the original approved proposal beside the job in the same insert. */
export function dispatchRequestRecord(input:WorkerRequest):Record<string,unknown>{
  return{contract:'firbo-dispatch-request/v1',request_id:input.requestId,organization_id:input.organizationId,kind:input.kind,params:input.params,
    ...(input.target?{target:input.target}:{}),...(input.deviceId?{device_id:input.deviceId}:{}),...(input.goal?{goal:input.goal}:{})};
}
export function validatedDispatchRecord(value:any,requestId:string,device:any,kind:string,params:Record<string,unknown>):Record<string,unknown>|null{
  if(value===undefined)return null;
  if(!value||value.contract!=='firbo-dispatch-request/v1'||value.request_id!==requestId||value.organization_id!==device.organization_id
    ||Object.keys(value).some(k=>!['contract','request_id','organization_id','kind','params','target','device_id','goal'].includes(k))
    ||new TextEncoder().encode(JSON.stringify(value)).length>160000)throw new Error('request_conflict');
  const input:WorkerRequest={requestId,organizationId:device.organization_id,kind:value.kind,params:value.params,devices:[device],
    ...(value.target?{target:value.target}:{}),...(value.device_id?{deviceId:value.device_id}:{}),...(value.goal?{goal:value.goal}:{})};
  validateWorkerDecision({contract:DISPATCH_CONTRACT,request_id:requestId,organization_id:device.organization_id,
    worker:{kind:'computer',id:device.id,name:device.name,platform:device.platform},job:{kind,params},reason:'enqueue'},input);
  return value;
}
export async function selectWorkerOnVps(input:WorkerRequest,env:(name:string)=>string|undefined,fetchImpl:typeof fetch=fetch):Promise<WorkerDecision>{
  input=structuredClone(input);
  if(!UUID.test(input.requestId)||!UUID.test(input.organizationId)||!DISPATCH_KINDS.has(input.kind)
    ||!input.params||typeof input.params!=='object'||Array.isArray(input.params)||!Array.isArray(input.devices)||input.devices.length>20
    ||input.deviceId&&!UUID.test(input.deviceId)||input.target&&input.target.length>120||input.goal&&input.goal.length>4000)throw new Error('dispatch_bad_request');
  const base=env('OPENJARVIS_URL'),key=env('OPENJARVIS_API_KEY');
  if(!base||!key)throw new Error('dispatch_unavailable');
  const endpoint=new URL(base);if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw new Error('dispatch_unavailable');
  endpoint.pathname=endpoint.pathname.replace(/\/$/,'').replace(/\/v1$/,'')+'/v1/firbo/dispatch';endpoint.search='';endpoint.hash='';
  const devices=input.devices.map(d=>({id:d.id,name:d.name,platform:d.platform,organization_id:d.organization_id,
    paired:d.paired,revoked_at:d.revoked_at,last_seen_at:d.last_seen_at,capabilities:d.capabilities,agent_policy:d.agent_policy,
    load:d.load??d.active_jobs??0}));
  if(devices.some(d=>d.organization_id!==input.organizationId))throw new Error('dispatch_bad_request');
  const payload={contract:DISPATCH_CONTRACT,request_id:input.requestId,organization_id:input.organizationId,
    kind:input.kind,params:input.params,devices,...(input.target?{target:input.target}:{}),...(input.deviceId?{device_id:input.deviceId}:{}),...(input.goal?{goal:input.goal}:{})};
  const encoded=JSON.stringify(payload);if(new TextEncoder().encode(encoded).length>220000)throw new Error('dispatch_bad_request');
  // No automatic fallback or retry: uncertainty must not run on another device.
  let response:Response;try{response=await fetchImpl(endpoint.href,{method:'POST',headers:{authorization:`Bearer ${key}`,'content-type':'application/json'},body:encoded,redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw new Error('dispatch_unavailable');}
  const reader=response.body?.getReader();if(!reader)throw new Error('dispatch_bad_response');
  let size=0;const parts:Uint8Array[]=[];
  try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>240000)throw new Error('dispatch_bad_response');parts.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  let result:any;try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('dispatch_bad_response');}
  if(!response.ok){const error=String(result?.error??result?.detail?.error??'');throw new Error(/^(no_eligible_worker|target_unavailable|target_ambiguous|dispatch_disabled)$/.test(error)?error:'dispatch_unavailable');}
  return validateWorkerDecision(result,input);
}
