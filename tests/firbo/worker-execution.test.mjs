// Actual publication/authorization helpers; PostgREST and SQL RPC are fixture
// adapters. This never queues a job, operates a device or calls a model.
import test, {after, mock} from 'node:test';
import assert from 'node:assert/strict';
import {finalizePendingComputerExecution} from '../../supabase/functions/_shared/worker-execution.ts';
import {desktopAuthorization} from '../../supabase/functions/_shared/desktop-planner.ts';

const ORG='22222222-2222-4222-8222-222222222222';
const TASK='44444444-4444-4444-8444-444444444444';
const DEVICE='33333333-3333-4333-8333-333333333333';
const AGENT='55555555-5555-4555-8555-555555555555';
const CLAIM='66666666-6666-4666-8666-666666666666';
const JOB='77777777-7777-4777-8777-777777777777';
const OTHER='88888888-8888-4888-8888-888888888888';
const SHA='a'.repeat(64);
const goal='Άνοιξε το YouTube και παίξε Μαζωνάκης Ώρες Μικρές';
const provider = mock.method(globalThis,'fetch',async()=>{
 throw Error('finalization and authorization must not call a model or network');
});
after(()=>{
 assert.equal(provider.mock.callCount(),0,'zero network/model dispatches');
 provider.mock.restore();
});

function rig(){
 const expected={job_id:JOB,device_id:DEVICE,kind:'desktop_task',params:{goal},run_claim:CLAIM};
 const task={id:TASK,organization_id:ORG,status:'running',run_claim:CLAIM,assigned_agent_id:AGENT,
  result:{report:'Employee report held pending real computer work',verified_success:false,
   computer_execution:{contract:'firbo-worker-execution/v1',ready_to_finalize:true,status:'waiting',jobs:[expected]}}};
 const job={id:JOB,organization_id:ORG,device_id:DEVICE,kind:'desktop_task',params:{goal},status:'done',
  result:{completed:true,blocked:false,summary:'Artist/title matched and clock advanced'},error:null,
  origin:'agent',agent_task_id:TASK,agent_id:AGENT,agent_run_claim:CLAIM,report_sha256:SHA,
  receipt:{contract:'firbo-execution-receipt/v1',job_id:JOB,device_id:DEVICE,kind:'desktop_task',report_sha256:SHA,ok:true}};
 const rows={tasks:[task],connector_jobs:[job],approvals:[],organizations:[{id:ORG,plan:'enterprise',plan_status:'active',status:'active'}],
  organization_members:[{organization_id:ORG,user_id:'owner',role:'owner'}],
  agents:[{id:AGENT,organization_id:ORG,enabled:true,autonomy:'act'}],
  agent_tools:[{organization_id:ORG,agent_id:AGENT,tool_name:'computer_use',enabled:true,policy:'allow'}]};
 const calls=[],reads=[],failures=new Set();
 const state={rows,calls,reads,failures,beforePublish:null};
 const db={
  from(table){
   const filters=[];let maximum=Infinity;
   const execute=single=>{
    reads.push(table);
    if(failures.has(table))return{data:null,error:{message:'fixture read unavailable'}};
    const chosen=(rows[table]??[]).filter(row=>filters.every(([k,v])=>row[k]===v)).slice(0,maximum);
    return{data:structuredClone(single?(chosen[0]??null):chosen),error:null};
   };
   const q={select(){return q},eq(k,v){filters.push([k,v]);return q},limit(value){maximum=value;return q},
    maybeSingle:async()=>execute(true),then(resolve,reject){return Promise.resolve(execute(false)).then(resolve,reject)},
    insert(){throw Error('must not queue work')},update(){throw Error('must publish through claimed SQL RPC')}};
   return q;
  },
  async rpc(name,args){
   calls.push({name,args:structuredClone(args)});
   assert.equal(name,'publish_task_run','no queue/model/admission RPC may run');
   state.beforePublish?.();
   const current=rows.tasks.find(t=>t.id===args.p_task&&t.organization_id===args.p_org);
   if(!current||current.status!=='running'||current.run_claim!==args.p_claim)return{data:null,error:{message:'state_conflict'}};
   current.status=args.p_status;current.result=structuredClone(args.p_result);current.run_claim=null;
   return{data:{id:args.p_task,organization_id:args.p_org,run_claim:args.p_claim,status:args.p_status},error:null};
  },
 };
 const device={id:DEVICE,organization_id:ORG,paired:true,revoked_at:null,
  agent_policy:{enabled:true,control:'full',hours:null},capabilities:{full_control:true,job_kinds:['desktop_task']}};
 return{state,db,task,job,expected,device,finalize:()=>finalizePendingComputerExecution(db,TASK,ORG,CLAIM)};
}

test('readyfalse and unknown reconciliation markers hold the report without publishing',async()=>{
 for(const update of [{ready_to_finalize:false},{status:'unknown'}]){
  const r=rig();Object.assign(r.task.result.computer_execution,update);
  assert.equal(await r.finalize(),null);assert.equal(r.state.calls.length,0);
  assert.equal(r.task.status,'running');assert.equal(r.task.run_claim,CLAIM);
 }
 const r=rig();r.task.result.reconcile_required=true;
 assert.equal(await r.finalize(),null);assert.equal(r.state.calls.length,0);
});

test('queued and running jobs keep the same employee run claim and report',async()=>{
 for(const status of ['queued','running']){
  const r=rig();r.job.status=status;
  const before=structuredClone(r.task.result);const result=await r.finalize();
  assert.equal(result.status,'running');assert.deepEqual(result.result,before);
  assert.equal(r.task.run_claim,CLAIM);assert.equal(r.task.status,'running');
  assert.equal(r.state.calls.length,0);
 }
});

test('all correlated receipts must match the stored job, agent, company, claim and parameters',async()=>{
 const changes=[
  r=>r.job.organization_id=OTHER,r=>r.job.agent_task_id=OTHER,r=>r.job.origin='owner',
  r=>r.job.agent_id=OTHER,r=>r.job.agent_run_claim=OTHER,r=>r.expected.run_claim=OTHER,
  r=>r.job.device_id=OTHER,r=>r.job.kind='browser_task',r=>r.job.params={goal:'Another action'},
  r=>r.job.receipt.contract='invented',r=>r.job.receipt.job_id=OTHER,
  r=>r.job.receipt.device_id=OTHER,r=>r.job.receipt.kind='browser_task',
  r=>r.job.receipt.report_sha256='b'.repeat(64),r=>r.job.report_sha256='bad hash',
  r=>r.job.receipt.ok=false,r=>r.job.receipt=null,
 ];
 for(const change of changes){
  const r=rig();change(r);
  assert.equal(await r.finalize(),null,change.toString());
  assert.equal(r.state.calls.length,0,change.toString());
  assert.equal(r.task.status,'running');assert.equal(r.task.run_claim,CLAIM);
 }
});

test('completed native receipt publishes actual success and releases the run once',async()=>{
 const r=rig();r.task.result.execution_receipts=['SQL-owned provenance'];
 r.task.result.last_execution={job:JOB};r.task.result.execution_job_id=JOB;
 const out=await r.finalize();
 assert.equal(out.status,'completed');assert.equal(out.result.verified_success,true);
 assert.equal(out.result.computer_execution.verified_success,true);
 assert.equal(out.result.computer_execution.jobs[0].receipt.report_sha256,SHA);
 assert.equal(r.state.calls.length,1);assert.equal(r.state.calls[0].args.p_claim,CLAIM);
 assert.deepEqual(r.state.calls[0].args.p_approvals,[]);
 for(const key of ['execution_receipts','last_execution','execution_job_id'])assert.equal(Object.hasOwn(r.state.calls[0].args.p_result,key),false);
 assert.equal(r.task.status,'completed');assert.equal(r.task.run_claim,null);
 assert.equal(await r.finalize(),null);assert.equal(r.state.calls.length,1,'terminal report is not republished');
});

test('terminal native blocked or checkpoint results publish blocked with verifiedfalse',async()=>{
 for(const result of [{completed:false,blocked:true,summary:'Login requires owner'},
                     {completed:false,checkpoint:true,summary:'Task reached checkpoint'},
                     {completed:true,blocked:true,summary:'Conflicting status'}]){
  const r=rig();r.job.result=result;const out=await r.finalize();
  assert.equal(out.status,'blocked');assert.equal(out.result.verified_success,false);
  assert.equal(out.result.computer_execution.verified_success,false);
  assert.equal(r.state.calls[0].args.p_status,'blocked');
 }
});

test('a requested Stop prevents a done receipt from becoming verified success',async()=>{
 const r=rig();r.job.cancel_requested_at=new Date().toISOString();
 const out=await r.finalize();
 assert.equal(out.status,'blocked');assert.equal(out.result.verified_success,false);
 assert.equal(out.result.computer_execution.verified_success,false);
 assert.equal(r.state.calls[0].args.p_status,'blocked');
});

test('observed computer summary and correlated receipt replace draft while retaining its provenance',async()=>{
 const r=rig();r.expected.device_name='My shell';
 const draft=r.task.result.report;const observed=r.job.result.summary;
 const out=await r.finalize();
 assert.equal(out.result.unverified_draft,draft);
 assert.equal(out.result.summary,`My shell: ${observed}`);
 assert.equal(out.result.report,`My shell: ${observed}\nJob: ${JOB}`);
 assert.equal(out.result.computer_execution.jobs[0].result.summary,observed);
 assert.equal(out.result.computer_execution.jobs[0].receipt.report_sha256,SHA);
 assert.doesNotMatch(out.result.report,/Employee report held/);
});

test('a previously retained unverified draft is not overwritten on receipt publication',async()=>{
 const r=rig();r.task.result.unverified_draft='Original preserved plan';
 const out=await r.finalize();assert.equal(out.result.unverified_draft,'Original preserved plan');
});

test('failed and confirmed cancellation publish failed, never successful execution',async()=>{
 for(const status of ['error','cancelled']){
  const r=rig();r.job.status=status;r.job.result=null;r.job.error='interrupted';
  if(status==='error')r.job.receipt.ok=false;else r.job.receipt=null;
  const out=await r.finalize();assert.equal(out.status,'failed');
  assert.equal(out.result.verified_success,false);assert.equal(r.task.status,'failed');
 }
});

test('outstanding approval or any untracked active computer work prevents final publication',async()=>{
 for(const pending of ['approval','job']){
  const r=rig();
  if(pending==='approval')r.state.rows.approvals.push({id:OTHER,organization_id:ORG,task_id:TASK,status:'pending'});
  else r.state.rows.connector_jobs.push({...r.job,id:OTHER,status:'running'});
  assert.equal((await r.finalize()).status,'running');assert.equal(r.state.calls.length,0);
  assert.equal(r.task.run_claim,CLAIM);
 }
});

test('changed claim before finalizer and during publication cannot finish the new run',async()=>{
 const before=rig();before.task.run_claim=OTHER;
 assert.equal(await before.finalize(),null);assert.equal(before.state.calls.length,0);
 const racing=rig();racing.state.beforePublish=()=>racing.task.run_claim=OTHER;
 assert.equal(await racing.finalize(),null);assert.equal(racing.state.calls.length,1);
 assert.equal(racing.task.run_claim,OTHER);assert.equal(racing.task.status,'running');
 assert.equal(racing.task.result.verified_success,false);
});

test('database read failure never finalizes, queues replacement work or calls a model',async()=>{
 for(const table of ['tasks','connector_jobs','approvals']){
  const r=rig();r.state.failures.add(table);await r.finalize();
  assert.equal(r.state.calls.length,0);assert.equal(r.state.rows.connector_jobs.length,1);
  assert.equal(r.task.status,'running');assert.equal(r.task.run_claim,CLAIM);
 }
});

test('actual legacy browser launch and exitzero receipts publish verified success',async()=>{
 for(const [kind,params,result] of [['browser_open',{url:'https://example.com/'},{url:'https://example.com/',launched:true}],
                                 ['exec',{command:'pwd'},{code:0,stdout:'/home/firbo'}]]){
  const r=rig();Object.assign(r.job,{kind,params,result});
  Object.assign(r.expected,{kind,params});r.job.receipt.kind=kind;
  assert.equal((await r.finalize()).status,'completed',kind);
 }
});

test('valid file read and write readback receipts expose the actual result and verified hash',async()=>{
 for(const [kind,params,result] of [
  ['read',{path:'notes.txt'},{path:'/home/firbo/notes.txt',content:'Γεια σου',sha256:SHA,truncated:false}],
  ['write',{path:'report.txt',content:'Γεια σου',overwrite:false},{path:'/home/firbo/report.txt',bytes:15,
    verification:{method:'sha256-readback',sha256:SHA,bytes:15}}],
 ]){
  const r=rig();Object.assign(r.job,{kind,params,result});Object.assign(r.expected,{kind,params});
  r.job.receipt.kind=kind;const out=await r.finalize();
  assert.equal(out.status,'completed');assert.equal(out.result.verified_success,true);
  assert.deepEqual(out.result.computer_execution.jobs[0].result,result);
 }
});

test('malformed file read or write observations and interrupted commands never verify',async()=>{
 for(const [kind,params,result] of [
  ['read',{path:'notes.txt'},{content:'Γεια σου'}],
  ['read',{path:'notes.txt'},{content:'Γεια σου',sha256:'invented'}],
  ['read',{path:'notes.txt'},{sha256:SHA}],
  ['write',{path:'report.txt',content:'Γεια σου'},{path:'report.txt',written:true}],
  ['write',{path:'report.txt',content:'Γεια σου'},{verification:{method:'sha256-readback',sha256:'invented'}}],
  ['write',{path:'report.txt',content:'Γεια σου'},{verification:{method:'assumed',sha256:SHA}}],
  ['exec',{command:'pwd'},{code:0,interrupted:true}],
  ['exec',{command:'pwd'},{code:0,signal:'SIGTERM'}],
 ]){
  const r=rig();Object.assign(r.job,{kind,params,result});Object.assign(r.expected,{kind,params});
  r.job.receipt.kind=kind;const out=await r.finalize();
  assert.equal(out.status,'blocked',JSON.stringify(result));assert.equal(out.result.verified_success,false);
 }
});

test('native agent authorization rechecks task, agent and computerpower before every next action',async()=>{
 const cases=[
  r=>r.state.rows.agent_tools[0].enabled=false,
  r=>r.state.rows.agent_tools[0].policy='block',
  r=>r.state.rows.agent_tools[0].policy='approval',
  r=>r.state.rows.agents[0].enabled=false,
  r=>r.state.rows.agents[0].autonomy='suggest',
  r=>r.task.run_claim=OTHER,
  r=>r.task.assigned_agent_id=OTHER,
  r=>r.task.status='cancelled',
  r=>r.task.result.reconcile_required=true,
 ];
 for(const change of cases){
  const r=rig();Object.assign(r.job,{status:'running',created_by:'owner'});
  assert.equal(await desktopAuthorization(r.db,r.device,r.job),true);
  change(r);
  assert.equal(await desktopAuthorization(r.db,r.device,r.job),false,change.toString());
  assert.equal(r.state.calls.length,0);
 }
});

test('native agent authorization fails closed on missing memberships or read errors',async()=>{
 for(const table of ['organizations','organization_members','tasks','agents','agent_tools']){
  const r=rig();Object.assign(r.job,{status:'running',created_by:'owner'});
  r.state.failures.add(table);
  assert.equal(await desktopAuthorization(r.db,r.device,r.job),false,table);
  assert.equal(r.state.calls.length,0);
 }
});
