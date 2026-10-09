import { createClient } from 'npm:@supabase/supabase-js@2';
import { APP_NAME, browserTaskParams, cleanPolicy, withinHours } from '../_shared/computer-policy.ts';
import { advancedComputerKind, desktopEntitled } from '../_shared/desktop-planner.ts';
import { canonicalDispatch, dispatchRequestRecord, DISPATCH_CONTRACT, DISPATCH_KINDS, selectWorkerOnVps, validateWorkerDecision } from '../_shared/worker-dispatch.ts';

const cors={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,x-client-info,apikey,content-type','access-control-allow-methods':'POST,OPTIONS'};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'content-type':'application/json','cache-control':'no-store'}});
const UUID=/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const text=(v:any,max:number)=>typeof v==='string'&&v.length<=max&&!v.includes('\0')?v:null;

export function normalizeDispatchParams(kind:string,p:any):Record<string,unknown>{
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('dispatch_bad_request');
  if(kind==='desktop_task'){const goal=text(p.goal,4000)?.trim();if(!goal)throw new Error('dispatch_bad_request');return{goal};}
  if(kind==='open_app'||kind==='shortcut'){const name=text(kind==='open_app'?p.app:p.name,60)?.trim();if(!name||!APP_NAME.test(name))throw new Error('dispatch_bad_request');return kind==='open_app'?{app:name}:{name};}
  if(kind==='browser_task'){const plan=browserTaskParams(p);if(!plan)throw new Error('dispatch_bad_request');return plan;}
  if(kind==='browser_open'){
    const raw=text(p.url,2048);if(!raw||/[\r\n]/.test(raw))throw new Error('dispatch_bad_request');
    const url=new URL(raw);if(url.protocol!=='https:'||url.username||url.password||!url.hostname||url.hostname==='localhost'||/^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname)||url.hostname.includes(':'))throw new Error('dispatch_bad_request');
    return{url:url.href};
  }
  if(kind==='exec'){const command=text(p.command,4000),cwd=text(p.cwd??'',500);if(!command||cwd===null)throw new Error('dispatch_bad_request');return{command,cwd};}
  const path=text(p.path??'',500);if(path===null||kind!=='list'&&!path)throw new Error('dispatch_bad_request');
  if(kind==='write'){const content=text(p.content??'',100000);if(content===null)throw new Error('dispatch_bad_request');return{path,content,overwrite:p.overwrite===true};}
  if(kind==='read'||kind==='list')return{path};throw new Error('dispatch_bad_request');
}

Deno.serve(async(req:Request)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
  const env=(name:string)=>Deno.env.get(name),base=env('SUPABASE_URL')!,anon=env('SUPABASE_ANON_KEY')!;
  const auth=req.headers.get('authorization')??'';
  const userClient=createClient(base,anon,{global:{headers:{Authorization:auth}}}),admin=createClient(base,env('SUPABASE_SERVICE_ROLE_KEY')!);
  const {data:who,error:authError}=await userClient.auth.getUser();const user=who?.user;
  if(authError||!user)return json(401,{error:'unauthorized'});
  let b:any;
  try{
    // Bound streamed input even when Content-Length is absent.
    const reader=req.body?.getReader();if(!reader)throw new Error();let size=0;const parts:Uint8Array[]=[];
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>220000)throw new Error();parts.push(part.value);}}finally{await reader.cancel().catch(()=>{});}
    const bytes=new Uint8Array(size);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}b=JSON.parse(new TextDecoder().decode(bytes));
  }catch{return json(400,{error:'dispatch_bad_request'});}
  if(!b||!['preview','dispatch'].includes(b.action)||!UUID.test(b.organization_id)||!UUID.test(b.request_id)||!DISPATCH_KINDS.has(b.kind)||b.kind==='server_task'
    ||b.device_id!==undefined&&!UUID.test(b.device_id)||b.target!==undefined&&!text(b.target,120)||b.goal!==undefined&&!text(b.goal,4000))return json(400,{error:'dispatch_bad_request'});
  let params:Record<string,unknown>;try{params=normalizeDispatchParams(b.kind,b.params);}catch{return json(400,{error:'dispatch_bad_request'});}
  const role=async()=>{
    const {data,error}=await admin.from('organization_members').select('role').eq('organization_id',b.organization_id).eq('user_id',user.id).maybeSingle();
    if(error)throw new Error('dispatch_unavailable');return ['owner','admin'].includes(data?.role);
  };
  const entitlement=async(kind:string)=>{
    if(!advancedComputerKind(kind))return true;const{data,error}=await admin.from('organizations').select('plan,plan_status,status').eq('id',b.organization_id).maybeSingle();
    if(error)throw new Error('dispatch_unavailable');return desktopEntitled(data);
  };
  const inventory=async()=>{
    const[{data:devices,error:de},{data:jobs,error:je}]=await Promise.all([
      admin.from('connector_devices').select('id,name,platform,organization_id,paired,revoked_at,last_seen_at,capabilities,agent_policy').eq('organization_id',b.organization_id).eq('paired',true).is('revoked_at',null).limit(20),
      admin.from('connector_jobs').select('device_id').eq('organization_id',b.organization_id).in('status',['queued','running']).limit(200),
    ]);if(de||je)throw new Error('dispatch_unavailable');
    return(devices??[]).map((d:any)=>({...d,load:(jobs??[]).filter((j:any)=>j.device_id===d.id).length}));
  };
  try{
    if(!await role())return json(403,{error:'forbidden'});if(!await entitlement(b.kind))return json(403,{error:'business_plan_required'});
    const devices=await inventory();
    const input={requestId:b.request_id,organizationId:b.organization_id,kind:b.kind,params,devices,
      ...(b.target?{target:b.target}:{}),...(b.device_id?{deviceId:b.device_id}:{}),...(b.goal?{goal:b.goal}:{})};
    // A retry of an uncertain enqueue always refers to its first executor.
    const{data:prior,error:pe}=await admin.from('connector_jobs').select('id,organization_id,device_id,created_by,kind,params,origin,dispatch_request').eq('id',b.request_id).eq('organization_id',b.organization_id).maybeSingle();
    if(pe)throw new Error('dispatch_unavailable');
    if(prior){
      const dev=devices.find((d:any)=>d.id===prior.device_id);
      if(prior.created_by!==user.id||prior.origin==='agent'||!dev||canonicalDispatch(prior.dispatch_request)!==canonicalDispatch(dispatchRequestRecord(input))) return json(409,{error:'request_conflict'});
      const recorded={contract:DISPATCH_CONTRACT,request_id:b.request_id,organization_id:b.organization_id,worker:{kind:'computer',id:dev.id,name:dev.name,platform:dev.platform},job:{kind:prior.kind,params:prior.params},reason:'existing_execution'};
      try{validateWorkerDecision(recorded,input);}catch{return json(409,{error:'request_conflict'});}
      return json(200,{...recorded,...(b.action==='dispatch'?{job_id:prior.id,duplicate:true}:{})});
    }
    const choice=await selectWorkerOnVps(input,env);
    if(b.action==='preview')return json(200,choice);
    if(b.confirm!==true)return json(400,{error:'confirm_required'});
    // Fresh checks after the network wait. The Connector and transactional claim
    // repeat execution authorization; this Edge cannot bypass them.
    const{data:freshWho,error:fe}=await userClient.auth.getUser();
    if(fe||freshWho?.user?.id!==user.id||!await role())return json(403,{error:'forbidden'});
    if(!await entitlement(choice.job.kind))return json(403,{error:'business_plan_required'});
    const freshDevices=await inventory();const fresh=freshDevices.find((d:any)=>d.id===choice.worker.id);
    if(!fresh||!fresh.last_seen_at||Date.now()-Date.parse(fresh.last_seen_at)>60000||!Number.isFinite(Date.parse(fresh.last_seen_at))
      ||fresh.agent_policy?.enabled!==true||!withinHours(cleanPolicy(fresh.agent_policy))||!fresh.capabilities?.job_kinds?.includes(choice.job.kind)
      ||choice.job.kind==='desktop_task'&&(fresh.agent_policy?.control!=='full'||fresh.capabilities?.full_control!==true))return json(409,{error:'target_unavailable'});
    validateWorkerDecision(choice,{...input,devices:freshDevices});
    // Forward the original user's token, never a service-role queue bypass.
    if(req.signal.aborted)return json(409,{error:'dispatch_cancelled'});
    const response=await fetch(`${base}/functions/v1/connector`,{method:'POST',headers:{authorization:auth,apikey:anon,'content-type':'application/json'},redirect:'error',signal:AbortSignal.any([req.signal,AbortSignal.timeout(15000)]),
      body:JSON.stringify({action:'create_job',request_id:b.request_id,dispatch_request:dispatchRequestRecord(input),device_id:choice.worker.id,kind:choice.job.kind,params:choice.job.params,confirm:true})});
    const result=await response.json();if(!response.ok)return json(response.status,{error:result?.error??'dispatch_enqueue_uncertain'});
    if(result.job_id!==b.request_id)throw new Error('dispatch_enqueue_uncertain');
    const{data:receipt,error:re}=await admin.from('connector_jobs').select('id,organization_id,device_id,created_by,kind,params').eq('id',b.request_id).eq('organization_id',b.organization_id).maybeSingle();
    if(re||!receipt||receipt.created_by!==user.id||receipt.device_id!==choice.worker.id||receipt.kind!==choice.job.kind||canonicalDispatch(receipt.params)!==canonicalDispatch(choice.job.params))throw new Error('dispatch_enqueue_uncertain');
    return json(200,{...choice,job_id:receipt.id});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    return json(['no_eligible_worker','target_unavailable','target_ambiguous','request_conflict'].includes(message)?409:503,
      {error:/^(dispatch_[a-z_]+|no_eligible_worker|target_unavailable|target_ambiguous)$/.test(message)?message:'dispatch_unavailable'});
  }
});
