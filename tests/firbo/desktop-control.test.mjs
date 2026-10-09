import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDesktopTask} from '../../frontend/public/firbo-desktop.mjs';
import {desktopEntitled, desktopAuthorization, validateDesktopAction, planDesktopStep} from '../../supabase/functions/_shared/desktop-planner.ts';
import {makeHandler,ORG,DEVICE,TOKEN} from './helpers/connector-handler.mjs';
const job={id:'44444444-4444-4444-8444-444444444444',params:{goal:'Play the requested artist and song'}};
const cfg={fullControl:true,allowDesktop:true,token:TOKEN};
const frame={image:'YQ==',width:100,height:80,screen_width:200,screen_height:160};
function rig(plans){const actions=[],calls=[];let i=0;return{actions,calls,options:{act:async(a)=>{actions.push(a);return a.action==='observe'?frame:{acted:true}},call:async(a,b)=>{calls.push({a,b});return a==='control'?{ok:true,job_id:job.id,stop:false,terminal:false}:{action:plans[i++]}}}}}
test('native loop observes each effect and leaves apps alive after verified completion',async()=>{const r=rig([{action:'click',x:10,y:20},{action:'wait',ms:2000},{action:'done',summary:'Artist and title match; clock advanced'}]);const out=await executeDesktopTask(job,cfg,r.options);assert.equal(out.completed,true);assert.equal(out.observations,3);assert.equal(out.actions,2);assert.equal(out.applications_remain_open,true);assert.equal(r.actions[1].screen_width,200);assert.equal(r.calls.filter(x=>x.a==='control').length,2);assert.equal(new Set(r.calls.filter(x=>x.a==='desktop_plan').map(x=>x.b.request_id)).size,3);});
test('remote stop after planning prevents even the first physical click',async()=>{const r=rig([{action:'click',x:1,y:1}]);const call=r.options.call;r.options.call=async(a,b)=>a==='control'?{ok:true,job_id:job.id,stop:true,terminal:false}:call(a,b);await assert.rejects(executeDesktopTask(job,cfg,r.options),/operation_stopped/);assert.deepEqual(r.actions.map(x=>x.action),['observe']);});
test('planner network uncertainty never retries or applies an action',async()=>{const r=rig([]);r.options.call=async()=>{throw new Error('network loss')};await assert.rejects(executeDesktopTask(job,cfg,r.options),/network loss/);assert.equal(r.actions.length,1);});
test('local shell permission cannot be granted by a model',async()=>{const r=rig([{action:'shell',command:'echo hi'}]);await assert.rejects(executeDesktopTask(job,cfg,r.options),/commands_disabled/);});
test('aborting during planning prevents input',async()=>{const c=new AbortController(),r=rig([]);r.options.call=async()=>{c.abort();return{action:{action:'click',x:1,y:1}}};await assert.rejects(executeDesktopTask(job,cfg,{...r.options,signal:c.signal}),/operation_stopped/);assert.equal(r.actions.length,1);});
test('blocked and checkpoint outcomes never claim completion',async()=>{const r=rig([{action:'blocked',summary:'Login needs owner'}]);assert.equal((await executeDesktopTask(job,cfg,r.options)).completed,false);assert.equal((await executeDesktopTask(job,cfg,{...r.options,maxSteps:0})).completed,false);});
test('local consent required even with forged queued work',async()=>{await assert.rejects(executeDesktopTask(job,{...cfg,allowDesktop:false},{}),/desktop_disabled/);});
test('only active Business and Enterprise are entitled',()=>{for(const plan of ['free','pro','business','enterprise'])for(const plan_status of ['active','trialing','past_due','canceled',null])assert.equal(desktopEntitled({plan,plan_status,status:'active'}),['business','enterprise'].includes(plan)&&['active','trialing'].includes(plan_status));assert.equal(desktopEntitled(null),false);});
test('planner rejects malformed terminal results',()=>{assert.throws(()=>validateDesktopAction({action:'done'}));assert.throws(()=>validateDesktopAction({action:'invented'}));});
async function owner(){const r=await makeHandler();r.state.user={id:'owner'};r.state.rows.organization_members.push({organization_id:ORG,user_id:'owner',role:'owner'});Object.assign(r.state.rows.connector_devices[0],{last_seen_at:new Date().toISOString(),agent_policy:{enabled:true,control:'full'},capabilities:{full_control:true,job_kinds:['desktop_task','browser_task']}});return r;}
test('actual handler queues exact natural-language goal for an entitled owner',async()=>{const r=await owner();const res=await r.invoke({action:'create_job',device_id:DEVICE,kind:'desktop_task',confirm:true,params:{goal:job.params.goal}});assert.equal(res.status,200);assert.deepEqual(r.state.rows.connector_jobs[0].params,job.params);});
test('actual handler denies Free, Pro and inactive plans with no job',async()=>{for(const p of [{plan:'free',plan_status:'active'},{plan:'pro',plan_status:'active'},{plan:'business',plan_status:'past_due'}]){const r=await owner();Object.assign(r.state.rows.organizations[0],p);const res=await r.invoke({action:'create_job',device_id:DEVICE,kind:'desktop_task',confirm:true,params:job.params});assert.equal(res.status,403);assert.equal(r.state.rows.connector_jobs.length,0);}});
test('another tenant and non-owner cannot enqueue desktop control',async()=>{for(const role of ['member','viewer']){const r=await owner();r.state.rows.organization_members[0].role=role;assert.equal((await r.invoke({action:'create_job',device_id:DEVICE,kind:'desktop_task',confirm:true,params:job.params})).status,403);}});
test('downgrade stops running desktop input while still accepting cancellation',async()=>{const r=await owner();r.state.rows.connector_jobs.push({...job,device_id:DEVICE,organization_id:ORG,created_by:'owner',kind:'desktop_task',status:'running',cancel_requested_at:null});r.state.rows.organizations[0].plan='pro';const res=await r.invoke({action:'control',token:TOKEN,job_id:job.id});assert.equal(res.status,200);assert.equal((await res.json()).stop,true);assert.equal((await r.invoke({action:'cancel_job',job_id:job.id})).status,200);});
test('device token cannot plan against another device job',async()=>{const r=await owner();r.state.rows.connector_jobs.push({...job,device_id:'other',organization_id:ORG,created_by:'owner',kind:'desktop_task',status:'running'});assert.equal((await r.invoke({action:'desktop_plan',token:TOKEN,job_id:job.id})).status,403);});

function plannerRig(){
 const calls=[];const db={from:()=>({select(){return this},eq(){return this},limit(){return this},maybeSingle:async()=>({data:{id:DEVICE},error:null})}),rpc:async(name,args)=>{calls.push({name,args});return {data:name==='plan_limit'?1000:name==='firbo_reserve_inference'?{ok:true,request_id:DEVICE,duplicate:false}:name==='firbo_settle_inference'?{ok:true,status:'settled'}:{ok:true,status:'reconcile_required'},error:null}}};
 const env=name=>({FIRBO_DESKTOP_VISION_MODEL:'synthetic-vision',FIRBO_DESKTOP_PRICE_IN_PER_M:'1',FIRBO_DESKTOP_PRICE_OUT_PER_M:'2',OMNIROUTE_BASE_URL:'https://gateway.firboai.app/v1',OMNIROUTE_API_KEY:'synthetic-key'})[name];
 const device={id:DEVICE,organization_id:ORG};const stored={...job,created_by:DEVICE};const body={frame,history:[],request_id:job.id,allow_exec:false};
 return{calls,db,env,device,stored,body};
}
test('vision provider admission and settlement precede returning an action',async()=>{const r=plannerRig();let transports=0;const out=await planDesktopStep(r.db,r.device,r.stored,r.body,new AbortController().signal,r.env,async(url,options)=>{transports++;assert.equal(r.calls.at(-1).name,'firbo_reserve_inference');const payload=JSON.parse(options.body);assert.equal(payload.messages[1].content[1].type,'image_url');assert.equal(JSON.parse(payload.messages[1].content[0].text).goal,job.params.goal);return Response.json({choices:[{message:{content:JSON.stringify({action:'done',summary:'Observed result'})}}],usage:{prompt_tokens:100,completion_tokens:20}})});assert.equal(transports,1);assert.equal(out.action.action,'done');assert.equal(r.calls.at(-1).name,'firbo_settle_inference');assert.equal(r.calls.at(-1).args.p_cost_usd,0.00014);});
test('failed/ambiguous vision request is charged for reconciliation and never retried',async()=>{const r=plannerRig();let transports=0;await assert.rejects(planDesktopStep(r.db,r.device,r.stored,r.body,new AbortController().signal,r.env,async()=>{transports++;throw Error('network loss')}));assert.equal(transports,1);assert.equal(r.calls.at(-1).name,'firbo_mark_inference_ambiguous');});
test('vision provider 429 is not retried and carries a safe accounting reason',async()=>{
 const r=plannerRig();let attempts=0;
 await assert.rejects(planDesktopStep(r.db,r.device,r.stored,r.body,new AbortController().signal,r.env,async()=>{
  attempts++;return new Response('provider private message must not reach user',{status:429});
 }), /desktop_model_rate_limited/);
 assert.equal(attempts,1);
 assert.equal(r.calls.at(-1).name,'firbo_mark_inference_ambiguous');
 assert.equal(r.calls.at(-1).args.p_reason,'desktop_model_rate_limited');
});
test('vision provider timeout/error classification keeps uncertain billing fail-closed',async()=>{
 for(const [status,code] of [[504,'desktop_model_timeout'],[503,'desktop_model_unavailable'],[401,'desktop_model_auth_failed']]){
  const r=plannerRig();
  await assert.rejects(planDesktopStep(r.db,r.device,r.stored,r.body,new AbortController().signal,r.env,
   async()=>new Response('do not surface this message',{status})),new RegExp(code));
  assert.equal(r.calls.at(-1).name,'firbo_mark_inference_ambiguous');
  assert.equal(r.calls.at(-1).args.p_reason,code);
 }
});
test('missing vision config makes zero provider or accounting calls',async()=>{const r=plannerRig();let transports=0;await assert.rejects(planDesktopStep(r.db,r.device,r.stored,r.body,new AbortController().signal,()=>undefined,async()=>{transports++;throw Error()}),/desktop_vision_not_configured/);assert.equal(transports,0);assert.equal(r.calls.length,0);});
test('malformed model action is settled for actual usage without returning an executable plan',async()=>{const r=plannerRig();await assert.rejects(planDesktopStep(r.db,r.device,r.stored,r.body,new AbortController().signal,r.env,async()=>Response.json({choices:[{message:{content:'not JSON'}}],usage:{prompt_tokens:100,completion_tokens:20}})));assert.equal(r.calls.at(-1).name,'firbo_settle_inference');assert.equal(r.calls.some(x=>x.name==='firbo_mark_inference_ambiguous'),false);});
test('Free/Pro cannot bypass advanced control through direct shell jobs',async()=>{for(const plan of ['free','pro']){const r=await owner();r.state.rows.organizations[0].plan=plan;const res=await r.invoke({action:'create_job',device_id:DEVICE,kind:'exec',confirm:true,params:{command:'xdotool click 1'}});assert.equal(res.status,403);assert.equal(r.state.rows.connector_jobs.length,0);}});
