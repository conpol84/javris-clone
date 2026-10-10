// Execute the real dispatch helper and Edge handler. The adapter replaces only
// authentication, PostgREST and transport; SQL transactions have separate tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import * as dispatch from '../../supabase/functions/_shared/worker-dispatch.ts';
import * as policy from '../../supabase/functions/_shared/computer-policy.ts';
import * as desktop from '../../supabase/functions/_shared/desktop-planner.ts';

const ORG='11111111-1111-4111-8111-111111111111';
const REQUEST='22222222-2222-4222-8222-222222222222';
const DEBIAN='33333333-3333-4333-8333-333333333333';
const MAC='44444444-4444-4444-8444-444444444444';
const USER='55555555-5555-4555-8555-555555555555';
const FOREIGN='66666666-6666-4666-8666-666666666666';
const nativeGoal='Open YouTube and observe the requested playback clock advancing';
const env=name=>({OPENJARVIS_URL:'https://vps.example/v1/',OPENJARVIS_API_KEY:'synthetic-selector-key'})[name];
const device=(id=DEBIAN,changes={})=>({id,organization_id:ORG,created_by:USER,name:id===MAC?'Mac':'Debian',platform:id===MAC?'darwin x64':'linux x64',paired:true,revoked_at:null,
  last_seen_at:new Date().toISOString(),capabilities:{job_kinds:['desktop_task','browser_open'],full_control:true},agent_policy:{enabled:true,control:'full',hours:null},load:0,...changes});
const input=(changes={})=>({requestId:REQUEST,organizationId:ORG,kind:'desktop_task',params:{goal:nativeGoal},goal:nativeGoal,devices:[device()],...changes});
const choice=(request,dev=request.devices[0],job={kind:request.kind,params:request.params})=>({contract:dispatch.DISPATCH_CONTRACT,
  request_id:request.requestId??request.request_id,organization_id:request.organizationId??request.organization_id,
  worker:{kind:'computer',id:dev.id,name:dev.name,platform:dev.platform},job,reason:'selected_by_vps'});
const body=(changes={})=>({action:'dispatch',organization_id:ORG,request_id:REQUEST,kind:'desktop_task',params:{goal:nativeGoal},goal:nativeGoal,confirm:true,...changes});

async function edgeAdapter() {
  const state={user:{id:USER},calls:[],reads:[],authCalls:[],failures:[],rows:{
    organization_members:[{organization_id:ORG,user_id:USER,role:'owner'}],
    organizations:[{id:ORG,plan:'business',plan_status:'active',status:'active'}],
    connector_devices:[device(),device(MAC,{capabilities:{job_kinds:['browser_open']}})],connector_jobs:[],
  }};
  function from(table) {
    const filters=[];let maximum=Infinity,fields='';
    const b={select(value){fields=value;return b;},eq(k,v){filters.push(row=>row[k]===v);return b;},is(k,v){filters.push(row=>row[k]===v);return b;},
      in(k,v){filters.push(row=>v.includes(row[k]));return b;},limit(value){maximum=value;return b;},
      maybeSingle(){return Promise.resolve(run(true));},then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject);}};
    function run(single) {
      state.reads.push({table,fields});
      const fail=state.failures.indexOf(table);if(fail>=0){state.failures.splice(fail,1);return{data:null,error:{message:'synthetic database error'}};}
      const rows=(state.rows[table]??[]).filter(row=>filters.every(fn=>fn(row))).slice(0,maximum);
      return{data:structuredClone(single?rows[0]??null:rows),error:null};
    }
    return b;
  }
  const createClient=(_url,key,options)=>({from,auth:{getUser:async()=>{state.authCalls.push({key,authorization:options?.global?.headers?.Authorization});return{data:{user:state.user},error:null};}}});
  const fetch=async(url,options)=>{
    const request=JSON.parse(options.body);state.calls.push({url,headers:options.headers,body:structuredClone(request),redirect:options.redirect});
    if(new URL(url).hostname==='vps.example'){
      if(state.vpsHook)await state.vpsHook(request,state);
      if(state.vpsError)throw new Error('synthetic transport loss');
      if(state.vpsResponse)return state.vpsResponse(request);
      const selected=request.devices.find(d=>d.id===(request.device_id??state.selected??DEBIAN));
      const job=state.adapt?{kind:'desktop_task',params:{goal:request.goal}}:{kind:request.kind,params:request.params};
      return Response.json(choice(request,selected,job));
    }
    assert.equal(url,'https://edge.example/functions/v1/connector');
    const dev=state.rows.connector_devices.find(d=>d.id===request.device_id);
    const row={id:request.request_id,organization_id:dev.organization_id,device_id:dev.id,created_by:USER,
      kind:request.kind,params:structuredClone(request.params),dispatch_request:structuredClone(request.dispatch_request),origin:'owner',status:'queued'};
    if(state.connectorReceiptHook)state.connectorReceiptHook(row,state);
    state.rows.connector_jobs.push(row);
    if(state.lostEnqueueResponse)throw new Error('synthetic response loss after commit');
    return Response.json({job_id:state.wrongAck?MAC:request.request_id});
  };
  const source=await readFile(new URL('../../supabase/functions/computer-dispatch/index.ts',import.meta.url),'utf8');
  const imports=[
    "import { createClient } from 'npm:@supabase/supabase-js@2';",
    "import { APP_NAME, browserTaskParams, cleanPolicy, withinHours } from '../_shared/computer-policy.ts';",
    "import { advancedComputerKind, desktopEntitled } from '../_shared/desktop-planner.ts';",
    "import { canonicalDispatch, dispatchRequestRecord, DISPATCH_CONTRACT, DISPATCH_KINDS, selectWorkerOnVps, validateWorkerDecision } from '../_shared/worker-dispatch.ts';",
  ];
  let rewritten=source;for(const statement of imports){assert.ok(rewritten.includes(statement),'review test adapter when an Edge dependency changes');rewritten=rewritten.replace(statement,'');}
  const code=stripTypeScriptTypes(rewritten.replace(/\bexport\s+(?=(?:const|function)\s)/g,''));let handler;
  const deno={serve:fn=>handler=fn,env:{get:name=>({SUPABASE_URL:'https://edge.example',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',...{OPENJARVIS_URL:env('OPENJARVIS_URL'),OPENJARVIS_API_KEY:env('OPENJARVIS_API_KEY')}})[name]}};
  const argumentsMap={Deno:deno,createClient,fetch,...policy,advancedComputerKind:desktop.advancedComputerKind,desktopEntitled:desktop.desktopEntitled,
    ...dispatch,selectWorkerOnVps:(request,getEnv)=>dispatch.selectWorkerOnVps(request,getEnv,fetch)};
  new Function(...Object.keys(argumentsMap),code)(...Object.values(argumentsMap));
  const invoke=(request=body(),options={})=>handler(new Request('https://edge.example/computer-dispatch',{method:'POST',headers:{authorization:'Bearer synthetic-user-session','content-type':'application/json'},
    body:typeof request==='string'?request:JSON.stringify(request),...options}));
  return{state,invoke,handler};
}

test('shared transport sends one protected VPS selection with only authenticated inventory fields',async()=>{
  const request=input({target:'debian',devices:[device(DEBIAN,{secret:'do not send',policy:'do not send'})]});let call;
  const out=await dispatch.selectWorkerOnVps(request,env,async(url,options)=>{assert.equal(call,undefined);call={url,options,body:JSON.parse(options.body)};return Response.json(choice(request));});
  assert.equal(out.worker.id,DEBIAN);assert.equal(call.url,'https://vps.example/v1/firbo/dispatch');
  assert.equal(call.options.headers.authorization,'Bearer synthetic-selector-key');assert.equal(call.options.redirect,'error');
  assert.equal(call.body.devices[0].secret,undefined);assert.equal(call.body.devices[0].policy,undefined);
  assert.equal(call.body.target,'debian');assert.deepEqual(call.body.params,request.params);
});

test('foreign inventory, oversized payload and unsupported identities are rejected before HTTP',async()=>{
  for(const request of [input({devices:[device(DEBIAN,{organization_id:FOREIGN})]}),input({requestId:'invalid'}),input({params:{goal:'x'.repeat(220001)}}),input({devices:Array(21).fill(device())})]){
    let calls=0;await assert.rejects(dispatch.selectWorkerOnVps(request,env,async()=>{calls++;return Response.json({});}),/dispatch_bad_request/);assert.equal(calls,0);
  }
});

test('helper never retries uncertain HTTP or leaks unknown upstream errors',async()=>{
  for(const mode of ['throw','private-error']){let calls=0;await assert.rejects(dispatch.selectWorkerOnVps(input(),env,async()=>{calls++;if(mode==='throw')throw new Error('private transport');return Response.json({error:'private upstream trace'},{status:500});}),/^Error: dispatch_unavailable$/);assert.equal(calls,1);}
  for(const error of ['no_eligible_worker','target_unavailable','target_ambiguous'])await assert.rejects(dispatch.selectWorkerOnVps(input(),env,async()=>Response.json({error},{status:409})),new RegExp(error));
});

test('helper rejects malformed response identity, foreign workers and modified native params',async()=>{
  const request=input();for(const changed of [
    {request_id:MAC},{organization_id:FOREIGN},{worker:{kind:'computer',id:MAC,name:'Mac',platform:'darwin x64'}},
    {job:{kind:'desktop_task',params:{goal:'Different goal'}}},{job:{kind:'exec',params:{command:'unexpected'}}},
  ])assert.throws(()=>dispatch.validateWorkerDecision({...choice(request),...changed},request),/dispatch_bad_response/);
  await assert.rejects(dispatch.selectWorkerOnVps(request,env,async()=>new Response('x'.repeat(240001))),/dispatch_bad_response/);
});

test('helper revalidates explicit platform and exact device targets independently of the VPS',()=>{
  const request=input();assert.throws(()=>dispatch.validateWorkerDecision(choice(request),{...request,target:'mac'}),/dispatch_bad_response/);
  assert.throws(()=>dispatch.validateWorkerDecision(choice(request),{...request,deviceId:MAC}),/dispatch_bad_response/);
  assert.equal(dispatch.validateWorkerDecision(choice(request),{...request,target:'DEBIAN'}).worker.id,DEBIAN);
});

test('helper pins the original params before transport awaits despite caller mutation',async()=>{
  const request=input();
  await assert.rejects(dispatch.selectWorkerOnVps(request,env,async(_url,options)=>{
    const sent=JSON.parse(options.body);assert.equal(sent.params.goal,nativeGoal);
    request.params.goal='Changed while waiting';request.target='mac';
    return Response.json(choice(sent,sent.devices[0],{kind:'desktop_task',params:request.params}));
  }),/dispatch_bad_response/);
});

test('open_app adapts only to its exact native goal, never a reviewed browser plan',()=>{
  const request=input({kind:'open_app',params:{app:'Google Chrome'},goal:'Open Google Chrome'});
  const out=choice(request,request.devices[0],{kind:'desktop_task',params:{goal:'Open Google Chrome'}});
  assert.deepEqual(dispatch.validateWorkerDecision(out,request).job,out.job);
  assert.throws(()=>dispatch.validateWorkerDecision(out,{...request,goal:'Open Safari'}),/dispatch_bad_response/);
  assert.throws(()=>dispatch.validateWorkerDecision(out,input({kind:'browser_task',params:{steps:[{action:'open',url:'https://example.com/'}]},goal:'Open Google Chrome'})),/dispatch_bad_response/);
});

test('actual Edge requires authentication and Owner/Admin membership before inventory or HTTP',async()=>{
  for(const role of [null,'member']){
    const h=await edgeAdapter();if(role===null)h.state.user=null;else h.state.rows.organization_members[0].role=role;
    const res=await h.invoke();assert.equal(res.status,role===null?401:403);assert.equal(h.state.calls.length,0);
    assert.ok(!h.state.reads.some(r=>r.table==='connector_devices'));
  }
});

test('actual Edge rejects bad params, local URLs, injected plans and wrong method without queueing',async()=>{
  for(const change of [
    {params:{goal:''}},{kind:'browser_open',params:{url:'http://example.com/'}},{kind:'browser_open',params:{url:'https://127.0.0.1/'}},
    {kind:'browser_task',params:{steps:[{action:'open',url:'https://example.com/'}],execute:'unexpected'}},
    {kind:'open_app',params:{app:'Safari; unexpected'}},{kind:'server_task',params:{}},{request_id:'bad'},
  ]){const h=await edgeAdapter();const res=await h.invoke(body(change));assert.equal(res.status,400);assert.equal(h.state.calls.length,0);assert.equal(h.state.rows.connector_jobs.length,0);}
  const h=await edgeAdapter();assert.equal((await h.invoke('x'.repeat(220001))).status,400);assert.equal(h.state.calls.length,0);
  assert.equal((await h.handler(new Request('https://edge.example/computer-dispatch'))).status,405);
});

test('actual Edge selects from trusted same-company inventory and previews without an effect',async()=>{
  const h=await edgeAdapter();h.state.rows.connector_devices.push(device(FOREIGN,{organization_id:FOREIGN}));
  h.state.rows.connector_jobs.push({id:MAC,organization_id:FOREIGN,device_id:DEBIAN,status:'running'});
  const res=await h.invoke(body({action:'preview',confirm:undefined,devices:[device(FOREIGN,{organization_id:FOREIGN})],worker:{id:FOREIGN}}));
  assert.equal(res.status,200);const result=await res.json();assert.equal(result.worker.id,DEBIAN);assert.equal(result.job_id,undefined);
  assert.equal(h.state.calls.length,1);assert.equal(h.state.calls[0].body.devices.length,2);assert.ok(h.state.calls[0].body.devices.every(d=>d.organization_id===ORG));
  assert.equal(h.state.calls[0].body.devices[0].load,0);assert.equal(h.state.rows.connector_jobs.length,1);
});

test('an org administrator cannot preview, retarget or queue a different owner\'s computer',async()=>{
 const h=await edgeAdapter();
 // The MAC remains in the same company but belongs to a second user.
 h.state.rows.connector_devices[1].created_by=FOREIGN;
 const preview=await h.invoke(body({action:'preview',confirm:undefined}));
 assert.equal(preview.status,200);
 assert.equal(h.state.calls.length,1);
 assert.deepEqual(h.state.calls[0].body.devices.map(d=>d.id),[DEBIAN]);
 assert.equal(h.state.rows.connector_jobs.length,0);
 // An explicit foreign device ID must never select a different computer.
 const foreign=await h.invoke(body({device_id:MAC}));
 assert.notEqual(foreign.status,200);
 assert.equal(h.state.rows.connector_jobs.length,0);
 assert.equal(h.state.calls.length,1,'foreign pin denied before a second VPS call');
});
test('owner transfer after VPS selection denies dispatch instead of reassigning worker',async()=>{
 const h=await edgeAdapter();
 h.state.vpsHook=(_request,state)=>{state.rows.connector_devices[0].created_by=FOREIGN;};
 const response=await h.invoke();
 assert.equal(response.status,409);
 assert.equal(h.state.calls.length,1);
 assert.equal(h.state.rows.connector_jobs.length,0);
});
test('missing creator does not make a company laptop available for direct CEO control',async()=>{
 const h=await edgeAdapter();
 delete h.state.rows.connector_devices[0].created_by;
 const res=await h.invoke(body({device_id:DEBIAN}));
 assert.equal(res.status,409);
 assert.equal(h.state.calls.length,0);
 assert.equal(h.state.rows.connector_jobs.length,0);
});
test('actual Edge normalizes only the approved app and enqueues the VPS-selected adapted goal using the original user',async()=>{
  const h=await edgeAdapter();h.state.adapt=true;
  const res=await h.invoke(body({kind:'open_app',params:{app:' Google Chrome ',command:'ignored'},goal:'Open Google Chrome',device_id:DEBIAN}));
  assert.equal(res.status,200);const out=await res.json();assert.equal(out.job_id,REQUEST);assert.deepEqual(out.job,{kind:'desktop_task',params:{goal:'Open Google Chrome'}});
  const enqueue=h.state.calls[1];assert.equal(enqueue.headers.authorization,'Bearer synthetic-user-session');assert.equal(enqueue.headers.apikey,'synthetic-public');
  assert.equal(enqueue.body.request_id,REQUEST);assert.equal(enqueue.body.device_id,DEBIAN);assert.deepEqual(enqueue.body.params,{goal:'Open Google Chrome'});
  assert.deepEqual(enqueue.body.dispatch_request.params,{app:'Google Chrome'});assert.equal(enqueue.body.dispatch_request.device_id,DEBIAN);
  assert.equal(h.state.rows.connector_jobs.length,1);
});

test('actual Edge checks current plan and selected device again after the VPS wait',async()=>{
  for(const mutation of [
    state=>{state.rows.organizations[0].plan='starter';},state=>{state.rows.organization_members[0].role='member';},
    state=>{state.rows.connector_devices[0].agent_policy.enabled=false;},state=>{state.rows.connector_devices[0].capabilities.full_control=false;},
    state=>{state.rows.connector_devices[0].last_seen_at=new Date(Date.now()-61000).toISOString();},state=>{state.rows.connector_devices[0].organization_id=FOREIGN;},
  ]){const h=await edgeAdapter();h.state.vpsHook=(_request,state)=>mutation(state);const res=await h.invoke();assert.ok([403,409].includes(res.status));assert.equal(h.state.calls.length,1);assert.equal(h.state.rows.connector_jobs.length,0);}
});

test('same request replays its original worker without another selector or enqueue; changed app, goal or target conflicts',async()=>{
  const h=await edgeAdapter();h.state.adapt=true;
  const original=body({kind:'open_app',params:{app:'Google Chrome'},goal:'Open browser',target:'debian'});
  assert.equal((await h.invoke(original)).status,200);assert.equal(h.state.calls.length,2);
  const repeat=await h.invoke(original);assert.equal(repeat.status,200);assert.equal((await repeat.json()).duplicate,true);assert.equal(h.state.calls.length,2);assert.equal(h.state.rows.connector_jobs.length,1);
  for(const changed of [{params:{app:'Safari'}},{target:'mac'},{goal:'Different goal'},{device_id:MAC}]){
    const res=await h.invoke({...original,...changed});assert.equal(res.status,409);assert.equal((await res.json()).error,'request_conflict');assert.equal(h.state.calls.length,2);
  }
});

test('another creator or an agent-origin execution cannot be replayed as owner work',async()=>{
  for(const changed of [{created_by:MAC},{origin:'agent'}]){const h=await edgeAdapter();assert.equal((await h.invoke()).status,200);Object.assign(h.state.rows.connector_jobs[0],changed);
    const res=await h.invoke();assert.equal(res.status,409);assert.equal((await res.json()).error,'request_conflict');assert.equal(h.state.calls.length,2);}
});

test('lost enqueue ACK stays uncertain and exact retry recovers the first job rather than switching workers',async()=>{
  const h=await edgeAdapter();h.state.lostEnqueueResponse=true;
  const first=await h.invoke();assert.equal(first.status,503);assert.equal(h.state.rows.connector_jobs.length,1);assert.equal(h.state.calls.length,2);
  h.state.selected=MAC;const recovered=await h.invoke();assert.equal(recovered.status,200);const out=await recovered.json();assert.equal(out.worker.id,DEBIAN);assert.equal(out.job_id,REQUEST);assert.equal(out.duplicate,true);assert.equal(h.state.calls.length,2);
});

test('mismatched queue receipt or ACK never confirms completion or silently retries',async()=>{
  for(const mode of ['wrongAck','receipt']){const h=await edgeAdapter();if(mode==='wrongAck')h.state.wrongAck=true;else h.state.connectorReceiptHook=row=>{row.params={goal:'Different goal'};};
    const res=await h.invoke();assert.equal(res.status,503);assert.equal((await res.json()).error,'dispatch_enqueue_uncertain');assert.equal(h.state.calls.length,2);assert.equal(h.state.rows.connector_jobs.length,1);}
});

const browserBody=(changes={})=>body({kind:'browser_open',params:{url:'https://example.com/'},goal:'Open the requested page',...changes});
test('trusted Full Control appears on preview and dispatch only when owner rules and real capability both allow it',async()=>{
  const h=await edgeAdapter();
  const preview=await h.invoke(body({action:'preview',confirm:undefined}));assert.equal(preview.status,200);
  assert.equal((await preview.json()).owner_full_control,true);assert.equal(h.state.rows.connector_jobs.length,0);
  const queued=await h.invoke(body({owner_full_control_required:true}));assert.equal(queued.status,200);
  assert.equal((await queued.json()).owner_full_control,true);assert.equal(h.state.rows.connector_jobs.length,1);
  assert.equal(h.state.calls[2].body.owner_full_control_required,true,'same requirement reaches the final Connector queue boundary');
});

test('guarded policy, absent or false local Full Control capability keep preview guarded',async()=>{
  for(const mutation of [
    dev=>{dev.agent_policy.control='guarded';},dev=>{dev.capabilities.full_control=false;},dev=>{delete dev.capabilities.full_control;},
  ]){
    const h=await edgeAdapter();mutation(h.state.rows.connector_devices[0]);
    const response=await h.invoke(browserBody({action:'preview',confirm:undefined}));assert.equal(response.status,200);
    assert.equal((await response.json()).owner_full_control,false);assert.equal(h.state.rows.connector_jobs.length,0);
  }
});

test('neither caller nor VPS can spoof the trusted owner Full Control marker',async()=>{
  const h=await edgeAdapter();h.state.rows.connector_devices[0].agent_policy.control='guarded';
  h.state.vpsResponse=request=>Response.json({...choice(request,request.devices[0]),owner_full_control:true});
  const response=await h.invoke(browserBody({action:'preview',confirm:undefined,owner_full_control:true}));assert.equal(response.status,200);
  assert.equal((await response.json()).owner_full_control,false);assert.equal(h.state.calls.length,1);assert.equal(h.state.rows.connector_jobs.length,0);
});

test('preview derives mode after current rules are reread; stale full preview or changed membership cannot grant it',async()=>{
  const guarded=await edgeAdapter();guarded.state.vpsHook=(_request,state)=>{state.rows.connector_devices[0].agent_policy.control='guarded';};
  const response=await guarded.invoke(browserBody({action:'preview',confirm:undefined}));assert.equal(response.status,200);
  assert.equal((await response.json()).owner_full_control,false);assert.equal(guarded.state.rows.connector_jobs.length,0);
  for(const mutation of [state=>{state.rows.organization_members[0].role='member';},state=>{state.rows.organizations[0].plan='starter';},state=>{state.rows.connector_devices[0].agent_policy.enabled=false;}]){
    const h=await edgeAdapter();h.state.vpsHook=(_request,state)=>mutation(state);
    const rejected=await h.invoke(body({action:'preview',confirm:undefined}));assert.ok([403,409].includes(rejected.status));
    assert.equal((await rejected.json()).owner_full_control,undefined);assert.equal(h.state.rows.connector_jobs.length,0);
  }
});

test('automatic dispatch rejects mode downgrade after preview while explicit guarded approval remains executable',async()=>{
  const h=await edgeAdapter();
  const preview=await h.invoke(browserBody({action:'preview',confirm:undefined}));assert.equal((await preview.json()).owner_full_control,true);
  h.state.rows.connector_devices[0].agent_policy.control='guarded';
  const rejected=await h.invoke(browserBody({owner_full_control_required:true}));assert.equal(rejected.status,409);
  assert.equal((await rejected.json()).error,'target_unavailable');assert.equal(h.state.rows.connector_jobs.length,0);
  const approved=await h.invoke(browserBody());assert.equal(approved.status,200);
  assert.equal((await approved.json()).owner_full_control,false);assert.equal(h.state.rows.connector_jobs.length,1);
});

test('automatic dispatch cannot queue from a forged marker or lost capability during VPS selection',async()=>{
  for(const mutation of [dev=>{dev.agent_policy.control='guarded';},dev=>{dev.capabilities.full_control=false;}]){
    const h=await edgeAdapter();h.state.vpsHook=(_request,state)=>mutation(state.rows.connector_devices[0]);
    const response=await h.invoke(browserBody({owner_full_control:true,owner_full_control_required:true}));assert.equal(response.status,409);
    assert.equal(h.state.calls.length,1);assert.equal(h.state.rows.connector_jobs.length,0);
  }
  for(const bad of [false,'true',1,null]){
    const h=await edgeAdapter();assert.equal((await h.invoke(browserBody({owner_full_control_required:bad}))).status,400);assert.equal(h.state.calls.length,0);
  }
});

test('historical adapted execution replays the same receipt after permission, capability or plan downgrade without another effect',async()=>{
  for(const mutation of [
    dev=>{dev.agent_policy.control='guarded';},dev=>{dev.agent_policy.enabled=false;},dev=>{dev.capabilities.full_control=false;},
    dev=>{dev.capabilities.job_kinds=['browser_open'];},(_dev,state)=>{state.rows.organizations[0].plan='starter';},
  ]){
    const h=await edgeAdapter();h.state.adapt=true;
    const original=body({kind:'open_app',params:{app:'Google Chrome'},goal:'Open Google Chrome',owner_full_control_required:true});
    assert.equal((await h.invoke(original)).status,200);mutation(h.state.rows.connector_devices[0],h.state);
    const replay=await h.invoke(original);assert.equal(replay.status,200);const receipt=await replay.json();
    assert.equal(receipt.job_id,REQUEST);assert.equal(receipt.worker.id,DEBIAN);assert.equal(receipt.duplicate,true);
    assert.equal(receipt.owner_full_control,false);
    assert.equal(h.state.calls.length,2);assert.equal(h.state.rows.connector_jobs.length,1);
  }
});
