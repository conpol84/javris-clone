// Actual Edge Function entrypoint with synthetic SDK/Auth/HTTP only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const USER='aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa', ORG='bbbbbbbb-eeee-4eee-8eee-bbbbbbbbbbbb';
const FLOW='cccccccc-eeee-4eee-8eee-cccccccccccc', RUN='dddddddd-eeee-4eee-8eee-dddddddddddd';
const TASK='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', AGENT='ffffffff-eeee-4eee-8eee-ffffffffffff';
const savedFetch=globalThis.fetch, savedDeno=globalThis.Deno;
let state, handler;
globalThis.__workflowCreateClient=()=>state.client;
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-public'})[key]},serve:fn=>{handler=fn;}};
const folder=await mkdtemp(join(tmpdir(),'firbo-workflow-'));
const raw=await readFile(new URL('../../supabase/functions/workflow-runner/index.ts',import.meta.url),'utf8');
const source=raw.replace("import { createClient } from 'npm:@supabase/supabase-js@2';","const createClient = (..._args: any[]) => (globalThis as any).__workflowCreateClient();");
assert.notEqual(raw,source); const path=join(folder,'workflow.ts'); await writeFile(path,source);await import(pathToFileURL(path).href);
after(async()=>{globalThis.fetch=savedFetch;globalThis.Deno=savedDeno;delete globalThis.__workflowCreateClient;await rm(folder,{recursive:true,force:true});});

function fixture(options={}) {
 const wf={id:FLOW,organization_id:ORG,name:'Synthetic flow',created_by:USER,enabled:true,trigger_type:'manual',revision:3};
 const run={id:RUN,organization_id:ORG,workflow_id:FLOW,status:'running',started_by:USER,task_id:TASK,step:0};
 const task={id:TASK,status:options.taskStatus??'pending',result:options.taskResult??null};
 const writes=[],fetches=[];
 const exec=(table,op,payload,filters)=>{
  if(op==='select'){
   if(table==='cron_secrets')return{data:{value:'synthetic-cron'},error:null};
   if(table==='workflows')return{data:wf,error:null};
   if(table==='organization_members')return{data:{role:options.role??'owner'},error:null};
   if(table==='profiles')return{data:{locale:'el'},error:null};
   if(table==='workflow_steps')return{data:options.noSteps?[]:[{id:'step-a',agent_id:AGENT,position:0,action:'Report synthetic data'}],error:options.stepsError?{message:'offline'}:null};
   if(table==='tasks')return{data:{...task},error:null};
   throw Error('Unhandled select '+table);
  }
  writes.push({table,op,payload,filters});
  if(table==='workflow_runs'&&op==='insert')return{data:run,error:null};
  if(table==='tasks'&&op==='insert')return{data:{id:TASK},error:null};
  if(table==='workflows'&&op==='update'){
   if(options.hookError)return{data:null,error:{message:'synthetic write failure'}};
   if(options.hookZero)return{data:null,error:null};
   return{data:{id:FLOW,hook_hash:options.badHook?'different':payload.hook_hash},error:null};
  }
  if(table==='workflow_runs'&&op==='update'){
   if(payload.task_id&&options.linkError)return{data:null,error:{message:'synthetic link failure'}};
   Object.assign(run,payload);return{data:{id:RUN},error:null};
  }
  if(table==='tasks'&&op==='update'){Object.assign(task,payload);return{data:{id:TASK},error:null};}
  throw Error('Unhandled write '+table);
 };
 const client={auth:{getUser:async()=>({data:{user:{id:USER}}})},from:table=>{
  let op='select',payload;const filters=[];
  const q={select(){return q;},eq(...f){filters.push(f);return q;},order(){return q;},insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},
   maybeSingle(){return Promise.resolve(exec(table,op,payload,filters));},single(){return q.maybeSingle();},then(resolve,reject){return Promise.resolve(exec(table,op,payload,filters)).then(resolve,reject);}};
  return q;
 }};
 state={client,writes,fetches,wf,run,task};
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://db.example.test/functions/v1/agent-runner','external network/provider calls are forbidden in this fixture');
  fetches.push({url,init});
  if(options.transportError)throw Error('Synthetic transport interrupted');
  return Response.json(options.reply??{ok:true},{status:options.httpStatus??200});
 };
 return state;
}
async function invoke(options={},body={action:'start',workflow_id:FLOW}){
 const state=fixture(options);const response=await handler(new Request('https://db.example.test/functions/v1/workflow-runner',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic-user'},body:JSON.stringify(body)}));
 return{state,response,body:await response.json()};
}
test('runner HTTP rejection is recorded immediately on run and unclaimed task',async()=>{
 const {state,response}=await invoke({httpStatus:503,reply:{error:'free_cron_identity_required'}});
 assert.equal(response.status,200);assert.equal(state.run.status,'failed');assert.equal(state.task.status,'failed');
 assert.equal(state.run.result.error,'free_cron_identity_required');assert.equal(state.run.result.runner_http_status,503);
 const receipt=state.writes.find(w=>w.table==='workflow_runs'&&w.payload.status==='failed');
 assert.ok(receipt.filters.some(([k,v])=>k==='organization_id'&&v===ORG));assert.ok(receipt.filters.some(([k,v])=>k==='task_id'&&v===TASK));
});
test('transport interruption is unconfirmed and never treated as a safe automatic retry',async()=>{
 const {state}=await invoke({transportError:true});assert.equal(state.run.status,'failed');assert.equal(state.task.status,'blocked');
 assert.equal(state.run.result.error,'runner_transport_unconfirmed');assert.equal(state.run.result.reconcile_required,true);assert.equal(state.task.result.reconcile_required,true);
});
test('duplicate launch rejection preserves an already running task and its workflow',async()=>{
 const {state}=await invoke({httpStatus:409,reply:{error:'not_runnable'},taskStatus:'running'});
 assert.equal(state.run.status,'running');assert.equal(state.task.status,'running');
 assert.ok(!state.writes.some(w=>w.payload?.status==='failed'));
});
test('runner failure never overwrites a saved task model failure or reconciliation receipt',async()=>{
 const result={error:'model_error',reconcile_required:true,routing:{request_id:'synthetic-request'}};
 const {state}=await invoke({httpStatus:502,reply:{error:'model_error'},taskStatus:'failed',taskResult:result});
 assert.deepEqual(state.task.result,result);assert.equal(state.run.result.error,'model_error');
});
test('unexpected provider error bodies never enter workflow receipts',async()=>{
 const {state}=await invoke({httpStatus:502,reply:{error:'synthetic-secret-provider-body',reason:'private detail'}});
 assert.equal(state.run.result.error,'runner_http_502');assert.ok(!JSON.stringify(state.run.result).includes('private detail'));
});
test('step read failure or empty chain cannot be reported completed',async()=>{
 for(const options of [{stepsError:true},{noSteps:true}]){
  const {state}=await invoke(options);assert.equal(state.run.status,'failed');assert.equal(state.fetches.length,0);
  assert.ok(['steps_read_failed','no_steps'].includes(state.run.result.error));
 }
});
test('a lost run-task linkage fails without invoking the agent',async()=>{
 const state=fixture({linkError:true});await assert.rejects(()=>handler(new Request('https://db.example.test/functions/v1/workflow-runner',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'start',workflow_id:FLOW})})),/workflow_link_failed/);
 assert.equal(state.fetches.length,0);assert.equal(state.task.result.error,'workflow_link_failed');
});
test('hook URL is returned only after the exact hash is confirmed saved',async()=>{
 for(const options of [{hookError:true},{badHook:true},{hookZero:true}]){
  const {response,body}=await invoke(options,{action:'set_hook',workflow_id:FLOW,expected_revision:3});assert.ok([409,500].includes(response.status));assert.ok(!body.url);
 }
 const {state,response,body}=await invoke({}, {action:'set_hook',workflow_id:FLOW,expected_revision:3});assert.equal(response.status,200);assert.ok(body.url);
 const write=state.writes.find(w=>w.table==='workflows');assert.ok(write.filters.some(([k,v])=>k==='revision'&&v===3));assert.ok(write.filters.some(([k,v])=>k==='organization_id'&&v===ORG));
});
test('stale hook revision and non-manager calls do not write or launch anything',async()=>{
 const stale=await invoke({}, {action:'set_hook',workflow_id:FLOW,expected_revision:2});assert.equal(stale.response.status,409);assert.equal(stale.state.writes.length,0);
 const viewer=await invoke({role:'viewer'});assert.equal(viewer.response.status,403);assert.equal(viewer.state.writes.length,0);assert.equal(viewer.state.fetches.length,0);
});
