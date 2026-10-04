/** Actual entrypoint handlers with the SDK import replaced by a test double.
 * Database, auth and inference transport are mocked. No real Deno deployment,
 * SQL isolation, provider spend, browser session or durable transaction is claimed.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TASK='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONVO='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const root = new URL('../../',import.meta.url);
const originalFetch=globalThis.fetch, originalDeno=globalThis.Deno;
const temp=await mkdtemp(join(tmpdir(),'firbo-edge-tests-'));
let current, captured;
globalThis.__firboTestCreateClient=(...args)=>current.client(...args);
globalThis.Deno={env:{get:key=>current.env[key]},serve:handler=>{captured=handler;}};
const handlers={};
for (const name of ['agent-chat','agent-runner']) {
  const source=await readFile(new URL(`supabase/functions/${name}/index.ts`,root),'utf8');
  const replacement="const createClient = (...args: any[]) => (globalThis as any).__firboTestCreateClient(...args);";
  const code=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",replacement)
    .replace("'../_shared/gateway-routing.ts'",JSON.stringify(new URL('supabase/functions/_shared/gateway-routing.ts',root).href))
    .replace("'../_shared/free-routing.ts'",JSON.stringify(new URL('supabase/functions/_shared/free-routing.ts',root).href));
  assert.notEqual(code,source);
  const path=join(temp,`${name}.ts`);await writeFile(path,code);await import(pathToFileURL(path).href);handlers[name]=captured;
}
after(async()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__firboTestCreateClient;await rm(temp,{recursive:true,force:true});});

function fixture(options={}) {
  const state={calls:[],writes:[],reads:[],env:{
    SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',
    FIRBO_TEXT_ROUTING_MODE:'gateway',OMNIROUTE_BASE_URL:'https://gateway.firboai.app/v1',OMNIROUTE_API_KEY:'inference-test',
    OMNIROUTE_PRICE_IN_PER_M:'1',OMNIROUTE_PRICE_OUT_PER_M:'2',
    LLM_DEFAULT:'openai:test-model',LLM_FALLBACK:'openai:backup-model',OPENAI_API_KEY:'direct-secret',...options.env}};
  const user={id:USER,email:'owner@example.test'};
  const task={id:TASK,organization_id:ORG,title:'Review test task',description:'Do not send anything without approval.',status:options.taskStatus??'pending',priority:'normal',assigned_agent_id:AGENT,result:options.result??null};
  const agent={id:AGENT,name:'Test agent',model:'auto',enabled:!options.disabled,temperature:0.4,monthly_budget_usd:options.monthlyBudget??10,system_prompt:'Work safely.',autonomy:options.autonomy??'supervised',agent_tools:options.tools??[]};
  const execute=(table,op,payload,filters,selection)=>{
    const info={table,op,payload,filters,selection};
    if(op!=='select'){
      state.writes.push(info);
      if(table==='messages')return{data:options.messageError?null:{id:'saved',...payload},error:options.messageError?{message:'db failure'}:null};
      if(table==='tasks'&&op==='update')return{data:options.claimLost&&payload.status==='running'?null:{id:TASK},error:options.resultError&&payload.result?{message:'db failure'}:null};
      if(table==='usage_events')return{data:null,error:options.usageError?{message:'db failure'}:null};
      if(table==='approvals')return{data:null,error:options.approvalError?{message:'db failure'}:null};
      return{data:null,error:null};
    }
    state.reads.push(info);
    if(table==='conversations')return{data:options.missingConversation?null:{id:CONVO,organization_id:ORG,user_id:options.foreignConversation?'foreign':USER,agent_id:AGENT,title:'Test',status:'active'},error:null};
    if(table==='organization_members')return{data:options.noMembership?null:{role:options.role??'owner'},error:null};
    if(table==='agents'){
      assert.ok(filters.some(([k,v])=>k==='organization_id'&&v===ORG),'agent read must be bound to verified organization');
      return{data:options.foreignAgent?null:agent,error:null};
    }
    if(table==='tasks')return{data:options.missingTask?null:task,error:null};
    if(table==='usage_events')return{data:options.spent?[{cost_usd:options.spent}]:[],count:options.count??0,error:options.budgetError?{message:'db unavailable'}:null};
    if(table==='memories'||table==='messages')return{data:[],error:null};
    if(table==='organizations')return{data:{name:'Test company',profile:{}},error:null};
    if(table==='cron_secrets')return{data:{value:'cron-test'},error:null};
    throw Error('Unhandled test table '+table);
  };
  const client=(_url,key)=>({
    auth:{getUser:async()=>({data:{user:options.unsigned?null:user}}),admin:{getUserById:async()=>({data:{user}})}},
    rpc:async()=>({data:100,error:options.planError?{message:'db failure'}:null}),
    from:table=>{
      let op='select',payload,selection;const filters=[];
      const b={
        select(s){selection=s;return b;},insert(p){op='insert';payload=p;return b;},update(p){op='update';payload=p;return b;},
        eq(k,v){filters.push([k,v]);return b;},in(k,v){filters.push([k,v]);return b;},gte(){return b;},or(){return b;},order(){return b;},limit(){return b;},
        maybeSingle(){return Promise.resolve(execute(table,op,payload,filters,selection));},single(){return b.maybeSingle();},
        then(resolve,reject){return Promise.resolve(execute(table,op,payload,filters,selection)).then(resolve,reject);},
      };return b;
    },
  });
  state.client=client;current=state;
  globalThis.fetch=async(url,init)=>{
    state.calls.push({url,init});
    if(String(url).includes('api.firboai.app/v1/firbo/free/')){
      if(options.freeFailure)return Response.json({error:'unavailable'},{status:503});
      const request=JSON.parse(init.body);
      return Response.json({model:'ollama:qwen3:1.7b',choices:[{message:{content:JSON.stringify({summary:'Draft',report:'Synthetic draft',actions:[{action:'send_email',risk:'medium',payload:{}}]})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10},
        firbo:{contract:'firbo-free-text/v1',request_id:request.request_id,policy:'no-paid-fallback',provider_fee_usd:options.badFreeCost?1:0,cost_basis:'self_hosted_no_metered_fee',infrastructure_cost_excluded:true}});
    }
    if(options.gatewayFailure&&String(url).includes('gateway.firboai.app'))return new Response('upstream private error',{status:502});
    return Response.json({model:'provider/resolved',choices:[{message:{content:JSON.stringify({summary:'Test result',report:'Result',actions:options.noActions?[]:[{action:'send_email',risk:'medium',payload:{to:'test@example.test'}}]})}}],usage:{prompt_tokens:100,completion_tokens:20}});
  };
  return state;
}
async function invoke(name,options={},bodyExtra={}){
  const state=fixture(options);
  const payload=name==='agent-chat'?{conversation_id:CONVO,message:'Test message',...bodyExtra}:{task_id:TASK,...bodyExtra};
  const headers={'content-type':'application/json',authorization:'Bearer user-test',...(options.cron?{'x-cron-secret':options.cron}:{})};
  const response=await handlers[name](new Request('https://db.example.test/functions/v1/'+name,{method:'POST',headers,body:JSON.stringify(payload)}));
  return{state,response,body:await response.json()};
}

for(const name of Object.keys(handlers)){
  test(`${name}: selected gateway route uses one request and keeps company accounting`,async()=>{
    const {state,response,body}=await invoke(name);
    assert.equal(response.status,200);assert.equal(state.calls.length,1);assert.ok(state.calls[0].url.startsWith('https://gateway.firboai.app/v1/'));
    const usage=state.writes.find(w=>w.table==='usage_events');assert.equal(usage.payload.organization_id,ORG);assert.equal(usage.payload.model,'omniroute:firbo-economy');
    assert.equal(body.routing.reported_model,'provider/resolved');assert.equal(body.routing.cost_basis,'configured_estimate');
    assert.ok(!JSON.stringify(body).includes('inference-test'));
  });
  test(`${name}: gateway failure cannot use direct-provider fallback`,async()=>{
    const {state,response,body}=await invoke(name,{gatewayFailure:true});assert.equal(response.status,502);assert.equal(state.calls.length,1);assert.equal(body.routing.status,'failed');
    assert.ok(!state.calls.some(c=>c.url.includes('api.openai.com')));
  });
  test(`${name}: legacy default preserves old route`,async()=>{
    const {state,response}=await invoke(name,{env:{FIRBO_TEXT_ROUTING_MODE:undefined}});assert.equal(response.status,200);assert.ok(state.calls[0].url.startsWith('https://api.openai.com/'));
  });
  test(`${name}: other agents are unaffected by canary`,async()=>{
    const {state,response}=await invoke(name,{env:{FIRBO_TEXT_ROUTING_MODE:'canary',FIRBO_GATEWAY_CANARY_AGENTS:USER}});assert.equal(response.status,200);assert.ok(state.calls[0].url.startsWith('https://api.openai.com/'));
  });
  for(const [label,options,status] of [['anonymous',{unsigned:true},401],['viewer',{role:'viewer'},403],['not member',{noMembership:true},403],['foreign agent',{foreignAgent:true},404],['disabled',{disabled:true},409],['budget exceeded',{spent:10},402],['budget unavailable',{budgetError:true},503],['plan unavailable',{planError:true},503],['hourly limit',{count:100},429],['invalid config',{env:{FIRBO_TEXT_ROUTING_MODE:'typo'}},503]]){
    test(`${name}: ${label} stops before inference`,async()=>{const {state,response}=await invoke(name,options);assert.equal(response.status,status);assert.equal(state.calls.length,0);assert.ok(!state.writes.some(w=>w.table==='approvals'));});
  }
  test(`${name}: usage persistence failure is not reported as success`,async()=>{
    const {response,body}=await invoke(name,{usageError:true});assert.equal(response.status,503);assert.equal(body.error,'result_save_failed');assert.equal(body.retry_safe,false);
  });
}
test('chat cannot act on another user conversation',async()=>{const {state,response}=await invoke('agent-chat',{foreignConversation:true});assert.equal(response.status,403);assert.equal(state.calls.length,0);});
test('task retains human approval requirement',async()=>{const {state,body}=await invoke('agent-runner');const approvals=state.writes.find(w=>w.table==='approvals');assert.equal(approvals.payload[0].status,'pending');assert.equal(approvals.payload[0].organization_id,ORG);assert.equal(body.status,'awaiting_approval');});
test('suggest-only task does not insert external approvals',async()=>{const {state,body}=await invoke('agent-runner',{autonomy:'suggest'});assert.equal(body.status,'completed');assert.ok(!state.writes.some(w=>w.table==='approvals'));});
test('blocked tool proposals are dropped',async()=>{const {state,body}=await invoke('agent-runner',{tools:[{tool_name:'send_email',enabled:false,policy:'block'}]});assert.equal(body.dropped,1);assert.ok(!state.writes.some(w=>w.table==='approvals'));});
test('lost task claim stops duplicate execution',async()=>{const {state,response}=await invoke('agent-runner',{claimLost:true});assert.equal(response.status,409);assert.equal(state.calls.length,0);});
test('ambiguous prior result requires reconciliation instead of retry',async()=>{const {state,response}=await invoke('agent-runner',{result:{reconcile_required:true}});assert.equal(response.status,409);assert.equal(state.calls.length,0);});
test('task persists gateway routing trace',async()=>{const {state}=await invoke('agent-runner');const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result);assert.equal(result.payload.result.routing.route,'omniroute');});
test('approval save failure is blocked and marked for reconciliation',async()=>{const {state,response}=await invoke('agent-runner',{approvalError:true});assert.equal(response.status,503);const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result);assert.equal(result.payload.status,'blocked');assert.equal(result.payload.result.reconcile_required,true);});
test('cron identity is preserved only with valid secret and company permission',async()=>{const {state,response}=await invoke('agent-runner',{unsigned:true,cron:'cron-test'},{system_user_id:USER});assert.equal(response.status,200);assert.equal(state.calls.length,1);});
test('wrong cron secret cannot substitute for user authentication',async()=>{const {state,response}=await invoke('agent-runner',{unsigned:true,cron:'wrong'},{system_user_id:USER});assert.equal(response.status,401);assert.equal(state.calls.length,0);});

for(const handler of ['agent-chat','agent-runner']){
 test(handler+' free pilot uses authenticated native lane, not configured paid fallbacks',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_FREE_ORGANIZATIONS:ORG,FIRBO_TEXT_ROUTING_MODE:'legacy'},monthlyBudget:0});
  assert.equal(response.status,200);assert.equal(state.calls.length,1);assert.ok(state.calls[0].url.includes('api.firboai.app/v1/firbo/free/'));
  assert.equal(state.calls[0].init.headers.authorization,'Bearer user-test');
  assert.equal(JSON.parse(state.calls[0].init.body).organization_id,ORG);
  assert.equal(state.writes.filter(x=>x.table==='usage_events')[0].payload.cost_usd,0);
  assert.equal(state.writes.filter(x=>x.table==='approvals').length,0);
 });
 test(handler+' free outage cannot fall back to paid gateway or legacy',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_FREE_ORGANIZATIONS:ORG},freeFailure:true});
  assert.equal(response.status,502);assert.equal(state.calls.length,1);
 });
 test(handler+' nonzero free report is refused',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_FREE_ORGANIZATIONS:ORG},badFreeCost:true});
  assert.equal(response.status,502);assert.equal(state.calls.length,1);assert.equal(state.writes.filter(x=>x.table==='usage_events').length,0);
 });
 test(handler+' malformed free entitlement fails closed',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_FREE_ORGANIZATIONS:'not-a-company'}});
  assert.equal(response.status,503);assert.equal(state.calls.length,0);
 });
 test(handler+' client cannot choose its own free entitlement',async()=>{
  const {state,response}=await invoke(handler,{}, {free:true,plan:'free'});assert.equal(response.status,200);
  assert.ok(state.calls[0].url.includes('gateway.firboai.app'));
 });
}
test('free runner refuses cron pseudo-identity before task claim',async()=>{
 const {state,response}=await invoke('agent-runner',{unsigned:true,cron:'cron-test',env:{FIRBO_FREE_ORGANIZATIONS:ORG}},{system_user_id:USER});
 assert.equal(response.status,503);assert.equal(state.calls.length,0);assert.equal(state.writes.filter(x=>x.table==='tasks').length,0);
});
