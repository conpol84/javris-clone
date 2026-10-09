import test from 'node:test';
import assert from 'node:assert/strict';
import {makeHandler,ORG,DEVICE,TOKEN} from './helpers/connector-handler.mjs';
const ID='44444444-4444-4444-8444-444444444444';
async function owner(){const r=await makeHandler();r.state.user={id:'owner'};r.state.rows.organization_members.push({organization_id:ORG,user_id:'owner',role:'owner'});Object.assign(r.state.rows.connector_devices[0],{platform:'linux x64',last_seen_at:new Date().toISOString(),agent_policy:{enabled:true,control:'full'},capabilities:{full_control:true,job_kinds:['desktop_task','exec']}});return r;}
const body={action:'create_job',request_id:ID,device_id:DEVICE,kind:'exec',params:{command:'pwd',cwd:''},confirm:true};
test('the actual Connector binds deterministic id and same request reuses one job',async()=>{const r=await owner();const a=await r.invoke(body);assert.equal(a.status,200);assert.equal((await a.json()).job_id,ID);const b=await r.invoke(body);assert.equal(b.status,200);assert.equal((await b.json()).duplicate,true);assert.equal(r.state.rows.connector_jobs.length,1);});
test('same id with changed params conflicts and cannot overwrite the first executor',async()=>{const r=await owner();await r.invoke(body);const res=await r.invoke({...body,params:{command:'whoami',cwd:''}});assert.equal(res.status,409);assert.equal(r.state.rows.connector_jobs.length,1);assert.equal(r.state.rows.connector_jobs[0].params.command,'pwd');});
test('request id is validated before an enqueue',async()=>{const r=await owner();assert.equal((await r.invoke({...body,request_id:'not-a-uuid'})).status,400);assert.equal(r.state.rows.connector_jobs.length,0);});
test('completed request is not queued again and queue load does not change identity',async()=>{const r=await owner();await r.invoke(body);r.state.rows.connector_jobs[0].status='done';for(let i=0;i<10;i++)r.state.rows.connector_jobs.push({id:'other'+i,device_id:DEVICE,status:'queued'});assert.equal((await r.invoke(body)).status,200);assert.equal(r.state.rows.connector_jobs.length,11);});
test('atomic dispatch record binds original adapted app as well as native goal',async()=>{const r=await owner();const record={contract:'firbo-dispatch-request/v1',request_id:ID,organization_id:ORG,kind:'open_app',params:{app:'Chrome'},goal:'Open browser'};
 const native={...body,kind:'desktop_task',params:{goal:'Open browser'},dispatch_request:record};assert.equal((await r.invoke(native)).status,200);
 const altered=await r.invoke({...native,dispatch_request:{...record,params:{app:'Safari'}}});assert.equal(altered.status,409);assert.equal(r.state.rows.connector_jobs.length,1);assert.deepEqual(r.state.rows.connector_jobs[0].dispatch_request,record);
});
test('another tenant cannot reuse or replace an existing request',async()=>{const r=await owner();await r.invoke(body);r.state.rows.organization_members=[];assert.equal((await r.invoke(body)).status,403);assert.equal(r.state.rows.connector_jobs.length,1);});
test('native Inbox approval cannot change VPS selected device or stored goal',async()=>{const r=await owner();r.state.rows.approvals=[{id:ID,organization_id:ORG,task_id:null,action:'computer_desktop_task',status:'pending',payload:{goal:'Find the requested page',device_id:DEVICE}}];
 const response=await r.invoke({action:'decide_execution',approval_id:ID,decision:'approved',device_id:DEVICE,payload:{goal:'Different task',device_id:DEVICE}});assert.equal(response.status,409);assert.equal(r.state.decisions,undefined);
});
test('native approval reaches the transactional RPC with exact stored goal and worker',async()=>{const r=await owner();const payload={goal:'Find the requested page',device_id:DEVICE};r.state.rows.approvals=[{id:ID,organization_id:ORG,task_id:null,action:'computer_desktop_task',status:'pending',payload}];
 const res=await r.invoke({action:'decide_execution',approval_id:ID,decision:'approved',device_id:DEVICE,payload});assert.equal(res.status,409);assert.equal(r.state.decisions[0].p_kind,'desktop_task');assert.deepEqual(r.state.decisions[0].p_params,{goal:payload.goal});assert.equal(r.state.decisions[0].p_device,DEVICE);
});
test('actual native control reads agent provenance and stops when current computer power is revoked',async()=>{
 const r=await owner(),agent='55555555-5555-4555-8555-555555555555',task='66666666-6666-4666-8666-666666666666',claim='77777777-7777-4777-8777-777777777777';
 r.state.rows.connector_jobs=[{id:ID,organization_id:ORG,device_id:DEVICE,created_by:'owner',kind:'desktop_task',status:'running',origin:'agent',agent_task_id:task,agent_id:agent,agent_run_claim:claim,cancel_requested_at:null}];
 r.state.rows.agents=[{id:agent,organization_id:ORG,enabled:true,autonomy:'auto'}];r.state.rows.agent_tools=[{organization_id:ORG,agent_id:agent,tool_name:'computer_use',enabled:true,policy:'allow'}];
 r.state.rows.tasks=[{id:task,organization_id:ORG,status:'running',run_claim:claim,assigned_agent_id:agent,result:{}}];
 const first=await r.invoke({action:'control',token:TOKEN,job_id:ID});assert.equal((await first.json()).stop,false);
 const projection=r.state.reads.find(x=>x.table==='connector_jobs').select.split(',');for(const field of ['origin','agent_task_id','agent_id','agent_run_claim'])assert.ok(projection.includes(field));
 r.state.rows.agent_tools[0].enabled=false;const second=await r.invoke({action:'control',token:TOKEN,job_id:ID});assert.equal((await second.json()).stop,true);
});

test('automatic owner dispatch is allowed only with current Full Control and real local capability',async()=>{
 const r=await owner();const response=await r.invoke({...body,owner_full_control_required:true});
 assert.equal(response.status,200);assert.equal((await response.json()).job_id,ID);assert.equal(r.state.rows.connector_jobs.length,1);
 const projection=r.state.reads.filter(read=>read.table==='connector_devices');assert.equal(projection.length,2,'mode is reread at the final queue boundary');
});

test('automatic dispatch refuses guarded, disabled, incapable, offline or outside-hours devices without queueing',async()=>{
 const hour=new Date().getUTCHours();
 for(const change of [
  dev=>{dev.agent_policy.control='guarded';},dev=>{dev.agent_policy.enabled=false;},
  dev=>{dev.capabilities.full_control=false;},dev=>{delete dev.capabilities.full_control;},
  dev=>{dev.capabilities.job_kinds=['desktop_task'];},dev=>{dev.last_seen_at=new Date(Date.now()-61000).toISOString();},
  dev=>{dev.agent_policy.hours={from:(hour+1)%24,to:(hour+2)%24,tz:'UTC'};},
 ]){
  const r=await owner();change(r.state.rows.connector_devices[0]);
  const response=await r.invoke({...body,owner_full_control_required:true});assert.equal(response.status,409,change.toString());
  assert.equal((await response.json()).error,'device_not_ready');assert.equal(r.state.rows.connector_jobs.length,0);
 }
});

test('policy changed during request is reread before automatic enqueue, while manual guarded approval retains compatibility',async()=>{
 const r=await owner();let reads=0;r.state.beforeRead=({table})=>{if(table==='connector_devices'&&++reads===2)r.state.rows.connector_devices[0].agent_policy.control='guarded';};
 assert.equal((await r.invoke({...body,owner_full_control_required:true})).status,409);assert.equal(r.state.rows.connector_jobs.length,0);assert.equal(reads,2);
 const manuallyApproved=await r.invoke(body);assert.equal(manuallyApproved.status,200);assert.equal(r.state.rows.connector_jobs.length,1);
});

test('a Full Control replay after downgrade reads the first job and never schedules another effect',async()=>{
 const r=await owner();assert.equal((await r.invoke({...body,owner_full_control_required:true})).status,200);
 r.state.rows.connector_devices[0].agent_policy.control='guarded';r.state.rows.connector_devices[0].capabilities.full_control=false;
 const replay=await r.invoke({...body,owner_full_control_required:true});assert.equal(replay.status,200);assert.equal((await replay.json()).duplicate,true);
 assert.equal(r.state.rows.connector_jobs.length,1);
});

test('automatic mode flag must be absent or literal true, never a caller-supplied truthy value',async()=>{
 for(const value of [false,'true',1,null]){
  const r=await owner();assert.equal((await r.invoke({...body,owner_full_control_required:value})).status,400);assert.equal(r.state.rows.connector_jobs.length,0);
 }
});
