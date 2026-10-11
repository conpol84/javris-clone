// Execute the actual Edge handler. Only SDK, Auth and HTTP are synthetic.
// Query predicates and conditional updates are applied, unlike permissive mocks.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const U='11111111-1111-4111-8111-111111111111', O='22222222-2222-4222-8222-222222222222';
const F='33333333-3333-4333-8333-333333333333', R='44444444-4444-4444-8444-444444444444';
const T='55555555-5555-4555-8555-555555555555', A='66666666-6666-4666-8666-666666666666';
const origin='jarvis_autopilot_server_v1';
const ago = minutes => new Date(Date.now()-minutes*60_000).toISOString();
const copy = value => structuredClone(value);
const saved={fetch:globalThis.fetch,Deno:globalThis.Deno,warn:console.warn,error:console.error};
let state,handler;
globalThis.__recoveryClient=()=>state.client;
globalThis.Deno={serve:fn=>{handler=fn;},env:{get:key=>({SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',SUPABASE_ANON_KEY:'synthetic-public',FIRBO_JARVIS_SERVER_AUTOPILOTOT:state?.enabled?'on':'off',FIRBO_JARVIS_SERVER_AUTOPILOT:state?.enabled?'on':'off'})[key]}};
console.warn=(...args)=>state?.logs.push(args.join(' '));
console.error=(...args)=>state?.logs.push(args.join(' '));
const temp=await mkdtemp(join(tmpdir(),'firbo-recovery-'));
const raw=await readFile(new URL('../../supabase/functions/workflow-runner/index.ts',import.meta.url),'utf8');
const source=raw.replace("import { createClient } from 'npm:@supabase/supabase-js@2';","const createClient = (..._args: any[]) => (globalThis as any).__recoveryClient();");
assert.notEqual(raw,source);
await writeFile(join(temp,'workflow.ts'),source);
await import(pathToFileURL(join(temp,'workflow.ts')).href);
after(async()=>{globalThis.fetch=saved.fetch;globalThis.Deno=saved.Deno;console.warn=saved.warn;console.error=saved.error;delete globalThis.__recoveryClient;await rm(temp,{recursive:true,force:true});});

function fixture(options={}) {
 const task={id:T,organization_id:O,created_by:U,status:'completed',result:{summary:'Saved verified report'},run_claim:null,updated_at:ago(1),metadata:{},...copy(options.task??{})};
 const run={id:R,organization_id:O,workflow_id:F,started_by:U,status:'running',step:0,task_id:T,updated_at:ago(1),...copy(options.run??{})};
 const tables={tasks:[task,...copy(options.extraTasks??[])],workflow_runs:options.flow?[run]:[],
  workflows:[{id:F,organization_id:O,created_by:U,enabled:true,name:'Test flow',revision:3}],
  workflow_steps:Array.from({length:options.stepCount??2},(_,position)=>({id:'step-'+position,organization_id:O,workflow_id:F,agent_id:A,position,action:'Use saved evidence'})),
  profiles:[{id:U,locale:'el'}],organization_members:[{organization_id:O,user_id:U,role:'owner'}],cron_secrets:[{name:'shifts',value:'synthetic-cron'}]};
 const writes=[],reads=[],calls=[],rpcs=[],logs=[];
 let lostAck=options.lostTransitionAck, raced=options.reviewRace;
 const get=(row,key)=>key.includes('->>')?row[key.split('->>')[0]]?.[key.split('->>')[1]]:row[key];
 const client={auth:{getUser:async()=>({data:{user:{id:U}}})},from:table=>{
  let op='select',payload,limit=Infinity,order,ascending=true;const filters=[];
  const execute=single=>{
   const matches=row=>filters.every(([key,value,operator])=>operator==='gte'?get(row,key)>=value:get(row,key)===value);
   if(op==='select') {
    reads.push({table,filters:copy(filters),single});
    if(options.readError===table || (options.orphanReadError&&table==='tasks'&&!single))return{data:null,error:{message:'synthetic DB unavailable'}};
    let rows=(tables[table]??[]).filter(matches);
    if(order)rows.sort((a,b)=>(get(a,order)<get(b,order)?-1:get(a,order)>get(b,order)?1:0)*(ascending?1:-1));
    rows=rows.slice(0,limit);return{data:copy(single?rows[0]??null:rows),error:null};
   }
   if(table==='tasks'&&op==='update'&&payload.status==='blocked'&&raced) {
    const row=tables.tasks.find(r=>r.id===T);Object.assign(row,raced);raced=null;
   }
   if(options.cancelOnTransition&&table==='workflow_runs'&&op==='update'&&payload.task_id===null) run.status='cancelled';
   let changed=[];
   if(op==='insert'){
    const row={id:randomUUID(),status:'pending',run_claim:null,result:null,updated_at:ago(0),...copy(payload)};
    tables[table].push(row);changed=[row];
   } else {
    changed=(tables[table]??[]).filter(matches);
    for(const row of changed) Object.assign(row,copy(payload));
   }
   writes.push({table,op,payload:copy(payload),filters:copy(filters),matched:changed.length});
   if(lostAck&&table==='workflow_runs'&&payload.task_id===null&&changed.length){lostAck=false;return{data:null,error:{message:'lost write ACK'}};}
   return{data:copy(single?changed[0]??null:changed),error:null};
  };
  const q={select(){return q;},eq(k,v){filters.push([k,v,'eq']);return q;},is(k,v){filters.push([k,v,'is']);return q;},gte(k,v){filters.push([k,v,'gte']);return q;},limit(n){limit=n;return q;},order(k,opts){order=k;ascending=opts?.ascending!==false;return q;},
   insert(p){op='insert';payload=p;return q;},update(p){op='update';payload=p;return q;},
   maybeSingle(){return Promise.resolve(execute(true));},single(){return q.maybeSingle();},then(a,b){return Promise.resolve(execute(false)).then(a,b);}};
  return q;
 },rpc:async(fn,args)=>{
  rpcs.push({fn,args});
  if(fn==='claim_due_workflows')return{data:[],error:options.queueError?{message:'offline'}:null};
  assert.equal(fn,'claim_due_jarvis_autopilot_tasks');
  const due=tables.tasks.filter(t=>t.status==='pending'&&t.run_claim===null&&t.metadata.source===origin&&t.metadata.dispatch_state==='new').slice(0,args.p_limit);
  for(const t of due)t.metadata={...t.metadata,dispatch_state:'claimed',dispatch_claimed_at:ago(0)};
  return{data:due.map(t=>({task_id:t.id,organization_id:t.organization_id,created_by:t.created_by})),error:null};
 }};
 state={client,tables,task,run,writes,reads,calls,rpcs,logs,enabled:options.enabled??false};
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://db.example.test/functions/v1/agent-runner','No real provider/network permitted');
  const body=JSON.parse(init.body);calls.push({body,headers:init.headers});
  const row=tables.tasks.find(t=>t.id===body.task_id);
  if(options.onDispatch)await options.onDispatch(row,state);
  else if(!options.noPersist)Object.assign(row,{status:'running',run_claim:randomUUID()});
  if(options.transportError)throw Error('Synthetic lost ACK');
  if(options.rawReply)return new Response(options.rawReply,{status:options.httpStatus??200});
  return Response.json({status:options.responseStatus??'completed',private_detail:'never copy me'},{status:options.httpStatus??200});
 };
 return state;
}
const tick=(secret='synthetic-cron')=>handler(new Request('https://db.example.test/functions/v1/workflow-runner',{method:'POST',headers:{'content-type':'application/json','x-cron-secret':secret},body:JSON.stringify({action:'tick'})}));
const newJarvis=()=>({status:'pending',result:null,metadata:{source:origin,dispatch_state:'new'}});
const orphan=(age=10)=>({status:'pending',result:null,metadata:{source:origin,dispatch_state:'claimed',dispatch_claimed_at:ago(age)}});
const inserted=s=>s.writes.filter(w=>w.table==='tasks'&&w.op==='insert'&&w.matched);

test('awaiting approval never advances or times out, even after a day',async()=>{
 const s=fixture({flow:true,task:{status:'awaiting_approval'},run:{updated_at:ago(1440)}});
 await tick();assert.equal(s.run.status,'running');assert.equal(s.run.step,0);assert.equal(s.writes.length,0);assert.equal(s.calls.length,0);
});
for(const result of [null,{},[],{report:''},{report:'Saved',reconcile_required:true},{summary:'Saved',error:'model_error'},{summary:'Saved',verified_success:false},{report:'Saved',computer_execution:{}},{report:'Saved',computer_execution:'not evidence'},{report:'Saved',computer_execution:{verified_success:true,completed:false}},{report:'Saved',computer_execution:{verified_success:true,error:'unconfirmed'}},{report:'Saved',computer_execution:{verified_success:true,reconcile_required:true}}])
 test('completed task with unusable result does not delegate: '+JSON.stringify(result),async()=>{
  const s=fixture({flow:true,task:{result}});await tick();assert.equal(s.run.result.error,'step_result_requires_review');assert.equal(s.run.result.reconcile_required,true);assert.equal(inserted(s).length,0);assert.equal(s.calls.length,0);
 });
test('saved result advances once and reaches same metered runner in owner language',async()=>{
 const s=fixture({flow:true});const response=await tick();assert.equal((await response.json()).moved,1);assert.equal(inserted(s).length,1);assert.equal(s.calls.length,1);
 assert.equal(s.calls[0].body.system_user_id,U);assert.equal(s.calls[0].body.lang,'el');assert.equal(s.calls[0].headers['x-cron-secret'],'synthetic-cron');
 assert.match(inserted(s)[0].payload.description,/Saved verified report/);
});
test('two simultaneous ticks create only one next-step task',async()=>{
 const s=fixture({flow:true});await Promise.all([tick(),tick()]);assert.equal(inserted(s).length,1);assert.equal(s.calls.length,1);assert.equal(s.run.step,1);
});
test('lost transition ACK does not replay or falsely fail an in-flight transition',async()=>{
 const s=fixture({flow:true,lostTransitionAck:true});await tick();await tick();assert.equal(s.run.step,1);assert.equal(s.run.task_id,null);assert.equal(s.run.status,'running');assert.equal(s.calls.length,0);assert.equal(inserted(s).length,0);
 s.run.updated_at=ago(20);await tick();assert.equal(s.run.result.error,'step_transition_unconfirmed');assert.equal(s.run.result.reconcile_required,true);assert.equal(inserted(s).length,0);
});
test('concurrent cancellation defeats transition compare-and-swap',async()=>{
 const s=fixture({flow:true,cancelOnTransition:true});await tick();assert.equal(s.run.status,'cancelled');assert.equal(inserted(s).length,0);assert.equal(s.calls.length,0);
});
test('last completed step finalizes only its own current run',async()=>{
 const s=fixture({flow:true,stepCount:1});await tick();assert.equal(s.run.status,'completed');assert.equal(s.run.result.summary,'Saved verified report');assert.equal(s.calls.length,0);
});
test('task read failure is not task missing and does not overwrite saved state',async()=>{
 const s=fixture({flow:true,readError:'tasks'});await tick();assert.equal(s.writes.length,0);assert.equal(s.run.status,'running');
});
test('workflow DB queue failure returns unavailable, not a green zero-work tick',async()=>{
 const s=fixture({queueError:true});const r=await tick();assert.equal(r.status,503);assert.equal((await r.json()).error,'workflow_queue_unavailable');assert.equal(s.writes.length,0);
});
test('run inventory failure returns unavailable without any dispatch',async()=>{
 const s=fixture({readError:'workflow_runs'});assert.equal((await tick()).status,503);assert.equal(s.calls.length,0);
});
test('old pending workflow is blocked for reconciliation, not blindly kicked again',async()=>{
 const s=fixture({flow:true,task:{status:'pending',result:null},run:{updated_at:ago(5)}});await tick();await tick();assert.equal(s.task.status,'blocked');assert.equal(s.task.result.reconcile_required,true);assert.equal(s.calls.length,0);
});
test('blocked step never advances and preserves its original receipt',async()=>{
 const result={error:'original',cost_usd:1};const s=fixture({flow:true,task:{status:'blocked',result}});await tick();assert.equal(s.run.result.error,'step_blocked');assert.deepEqual(s.task.result,result);assert.equal(s.calls.length,0);
});
test('stranded JARVIS dispatch claim becomes review-required without rerunning',async()=>{
 const s=fixture({enabled:true,task:orphan()});const r=await tick();assert.equal((await r.json()).jarvis_reviewed,1);await tick();assert.equal(s.task.status,'blocked');assert.equal(s.task.result.verified_success,false);assert.equal(s.calls.length,0);
});
test('fresh or malformed claim timestamps are never treated as stale',async()=>{
 for(const task of [orphan(1),{...orphan(),metadata:{source:origin,dispatch_state:'claimed',dispatch_claimed_at:'bad'}}]){
  const s=fixture({enabled:true,task});await tick();assert.equal(s.task.status,'pending');assert.equal(s.calls.length,0);
 }
});
test('running/terminal tasks and existing receipts survive stale-claim cleanup',async()=>{
 for(const change of [{status:'running',run_claim:A},{status:'completed',result:{summary:'Keep'}},{result:{accounting:{attempt:'keep'}}}]){
  const task={...orphan(),...change};const s=fixture({enabled:true,task});await tick();assert.deepEqual(s.task.result,task.result);assert.equal(s.task.status,task.status);assert.equal(s.writes.length,0);
 }
});
test('concurrent runner claim wins over orphan review and does not log false receipt_saved',async()=>{
 const s=fixture({enabled:true,task:orphan(),reviewRace:{status:'running',run_claim:A}});const r=await tick();assert.equal((await r.json()).jarvis_reviewed,0);assert.equal(s.task.status,'running');assert.ok(s.logs.some(x=>x.includes('"receipt_saved":false')));
});
test('HTTP 200 with no saved task acceptance is review-required, no duplicate dispatch',async()=>{
 const s=fixture({enabled:true,task:newJarvis(),noPersist:true});await tick();await tick();assert.equal(s.task.status,'blocked');assert.equal(s.calls.length,1);assert.ok(!JSON.stringify(s.task.result).includes('private_detail'));
});
test('malformed HTTP reply cannot fake completion',async()=>{
 const s=fixture({enabled:true,task:newJarvis(),noPersist:true,rawReply:'<html>ok</html>'});await tick();assert.equal(s.task.status,'blocked');assert.equal(s.task.result.verified_success,false);
});
test('lost HTTP response preserves actual saved success',async()=>{
 const s=fixture({enabled:true,task:newJarvis(),transportError:true,onDispatch:row=>Object.assign(row,{status:'completed',result:{summary:'Actual stored work'}})});
 await tick();await tick();assert.equal(s.task.status,'completed');assert.deepEqual(s.task.result,{summary:'Actual stored work'});assert.equal(s.calls.length,1);
});
test('readback failure does not manufacture success or overwrite unknown work',async()=>{
 const s=fixture({enabled:true,task:newJarvis(),noPersist:true,onDispatch:()=>{},readError:'tasks'});await tick();assert.equal(s.task.status,'pending');assert.equal(s.writes.length,0);assert.ok(s.logs.some(x=>x.includes('firbo_jarvis_receipt_read_failed')));
});
test('cleanup is scoped to creator, tenant, origin, exact claim, pending and no result',async()=>{
 const s=fixture({enabled:true,task:orphan()});await tick();const w=s.writes.find(w=>w.table==='tasks');
 for(const [key,value] of [['id',T],['organization_id',O],['created_by',U],['metadata->>source',origin],['metadata->>dispatch_state','claimed'],['status','pending'],['run_claim',null],['result',null]])assert.ok(w.filters.some(([k,v])=>k===key&&v===value),key);
 assert.ok(w.filters.some(([k])=>k==='metadata->>dispatch_claimed_at'));
});
test('foreign tenant task ID cannot be consumed by a workflow',async()=>{
 const s=fixture({flow:true,task:{organization_id:A}});await tick();assert.equal(s.run.result.error,'step_missing');assert.equal(s.calls.length,0);assert.equal(inserted(s).length,0);
});
test('feature gate OFF and invalid cron identity never consume JARVIS work',async()=>{
 const s=fixture({enabled:false,task:newJarvis()});await tick();assert.equal(s.calls.length,0);assert.equal(s.task.metadata.dispatch_state,'new');
 const q=fixture({enabled:true,task:orphan()});assert.equal((await tick('wrong')).status,401);assert.equal(q.writes.length,0);assert.equal(q.rpcs.length,0);
});

test('very old pending workflow also blocks its task, not just the workflow',async()=>{
 const s=fixture({flow:true,task:{status:'pending',result:null},run:{updated_at:ago(30)}});await tick();assert.equal(s.task.status,'blocked');assert.equal(s.run.status,'failed');assert.equal(s.calls.length,0);
});
