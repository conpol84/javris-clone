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
    .replace(/'\.\.\/_shared\/([a-z-]+\.ts)'/g,(_m,file)=>JSON.stringify(new URL(`supabase/functions/_shared/${file}`,root).href));
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
  const agent={id:AGENT,name:'Test agent',model:options.model??'auto',enabled:!options.disabled,temperature:0.4,monthly_budget_usd:options.monthlyBudget??10,system_prompt:'Work safely.',autonomy:options.autonomy??'supervised',agent_tools:options.tools??[]};
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
    if(table==='organization_members')return{data:options.noMembership?null:{role:options.role??'owner'},count:options.adminMember?1:0,error:null};
    if(table==='agents'){
      assert.ok(filters.some(([k,v])=>k==='organization_id'&&v===ORG),'agent read must be bound to verified organization');
      return{data:options.foreignAgent?null:agent,error:null};
    }
    if(table==='tasks')return{data:options.missingTask?null:task,error:null};
    if(table==='usage_events')return{data:options.spent?[{cost_usd:options.spent}]:[],count:options.count??0,error:options.budgetError?{message:'db unavailable'}:null};
    if(table==='memories'||table==='messages'||table==='approvals'||table==='skills'||table==='platform_admins')return{data:options[table]??[],error:null};
    if(table==='report_feedback')return{data:options.feedback??[],error:null};
    if(table==='knowledge_chunks')return{data:null,count:options.knowledgeCount??0,error:null};
    if(table==='organizations')return{data:{name:'Test company',profile:{},plan:options.plan},error:null};
    if(table==='cron_secrets')return{data:{value:'cron-test'},error:null};
    throw Error('Unhandled test table '+table);
  };
  const client=(_url,key)=>({
    auth:{getUser:async()=>({data:{user:options.unsigned?null:user}}),admin:{getUserById:async()=>({data:{user}})}},
    rpc:async(fn,args)=>{state.rpcs=[...(state.rpcs??[]),{fn,args}];if(fn==='match_knowledge')return{data:options.knowledgeHits??[],error:null};if(fn==='provider_key_for_runtime')return{data:options.ownKey??null,error:null};return{data:100,error:options.planError?{message:'db failure'}:null};},
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
    if(options.ownFailure&&String(url).startsWith('https://api.openai.com/'))return Response.json({error:{message:'invalid'}},{status:401});
    if(String(url).endsWith('/search'))return Response.json({results:[{title:'Sports market grows',url:'https://news.example/a',snippet:'Up 5%'}]});
    if(String(url).endsWith('/web/fetch'))return Response.json({content:'Full article text about the sports market.'});
    if(/jarvis/.test(String(url)))return String(url).endsWith('/v1/info')?Response.json({model:'firbo-quality'}):Response.json({choices:[{message:{content:'45'}}]});
    if(options.chatReplies&&String(url).endsWith('/chat/completions'))return Response.json({model:'provider/resolved',choices:[{message:{content:options.chatReplies.shift()}}],usage:{prompt_tokens:100,completion_tokens:20}});
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
  const {state,response}=await invoke(handler,{env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:ORG,FIRBO_TEXT_ROUTING_MODE:'legacy'},monthlyBudget:0});
  assert.equal(response.status,200);assert.equal(state.calls.length,1);assert.ok(state.calls[0].url.includes('api.firboai.app/v1/firbo/free/'));
  assert.equal(state.calls[0].init.headers.authorization,'Bearer user-test');
  assert.equal(JSON.parse(state.calls[0].init.body).organization_id,ORG);
  assert.equal(state.writes.filter(x=>x.table==='usage_events')[0].payload.cost_usd,0);
  assert.equal(state.writes.filter(x=>x.table==='approvals').length,0);
 });
 test(handler+' free outage cannot fall back to paid gateway or legacy',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:ORG},freeFailure:true});
  assert.equal(response.status,502);assert.equal(state.calls.length,1);
 });
 test(handler+' nonzero free report is refused',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:ORG},badFreeCost:true});
  assert.equal(response.status,502);assert.equal(state.calls.length,1);assert.equal(state.writes.filter(x=>x.table==='usage_events').length,0);
 });
 test(handler+' malformed free entitlement fails closed',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:'not-a-company'}});
  assert.equal(response.status,503);assert.equal(state.calls.length,0);
 });
 test(handler+' client cannot choose its own free entitlement',async()=>{
  const {state,response}=await invoke(handler,{}, {free:true,plan:'free'});assert.equal(response.status,200);
  assert.ok(state.calls[0].url.includes('gateway.firboai.app'));
 });
}
test('free runner refuses cron pseudo-identity before task claim',async()=>{
 const {state,response}=await invoke('agent-runner',{unsigned:true,cron:'cron-test',env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:ORG}},{system_user_id:USER});
 assert.equal(response.status,503);assert.equal(state.calls.length,0);assert.equal(state.writes.filter(x=>x.table==='tasks').length,0);
});

test('local-model chat stays off unless explicitly switched on, even when a company is listed',async()=>{
  for (const name of ['agent-chat','agent-runner']) {
    const source=await readFile(new URL(`../../supabase/functions/${name}/index.ts`,import.meta.url),'utf8');
    assert.match(source,/Deno\.env\.get\('FIRBO_ALLOW_LOCAL_CHAT'\) === 'on' && freeForOrganization\(/,name);
  }
});

test('a failed free-plan run stays retryable; other gateway failures still require reconciliation',async()=>{
  const source=await readFile(new URL('../../supabase/functions/agent-runner/index.ts',import.meta.url),'utf8');
  assert.match(source,/const planFree = orgPlan\?\.plan === 'free' && Deno\.env\.get\('FIRBO_FREE_PLAN_ROUTING'\) === 'gateway'/);
  assert.match(source,/reconcile_required: !!free \|\| \(!!gateway && !planFree\)/);
});

test('mission-runner moves only free-plan companies to the free combo and reports a reason when no model exists',async()=>{
  const source=await readFile(new URL('../../supabase/functions/mission-runner/index.ts',import.meta.url),'utf8');
  assert.match(source,/orgPlan\?\.plan === 'free' && Deno\.env\.get\('FIRBO_FREE_PLAN_ROUTING'\) === 'gateway'/);
  assert.match(source,/const targets: Target\[\] = own \? \[own\] : gateway \? \[\] : specs\.map\(resolveTarget\)/);
  assert.match(source,/if \(!own && orgPlan\?\.plan === 'free'/);
  assert.match(source,/cost: target\.own \? 0 :/);
  assert.match(source,/reason: 'no_model_for_agent'/);
  assert.equal((source.match(/await ask\(targets, gateway,/g)||[]).length,2);
});

const OWN='sk-own-company-key-1234567890';
for (const name of ['agent-chat','agent-runner']) {
  test(`${name}: an own key goes straight to the provider, once, at $0 for Firbo`, async () => {
    const {state,response}=await invoke(name,{model:'openai:gpt-5-mini',ownKey:OWN});
    assert.equal(response.status,200);
    assert.equal(state.calls.length,1);
    assert.equal(String(state.calls[0].url),'https://api.openai.com/v1/chat/completions');
    assert.equal(state.calls[0].init.headers.authorization,`Bearer ${OWN}`);
    assert.equal(JSON.parse(state.calls[0].init.body).model,'gpt-5-mini');
    const usage=state.writes.find(w=>w.table==='usage_events');
    assert.equal(usage.payload.cost_usd,0);
    assert.equal(usage.payload.own_key,true);
    assert.ok(state.rpcs.some(r=>r.fn==='provider_key_for_runtime'&&r.args.p_provider==='openai'));
  });
  test(`${name}: a failing own key says why and never falls back to Firbo's models`, async () => {
    const {state,response,body}=await invoke(name,{model:'openai:gpt-5-mini',ownKey:OWN,ownFailure:true});
    assert.equal(response.status,502);
    assert.equal(body.reason,'own_key_openai_http_401');
    assert.equal(state.calls.length,1);
    assert.ok(!state.calls.some(c=>String(c.url).includes('gateway.firboai.app')));
    assert.ok(!state.writes.some(w=>w.table==='usage_events'));
  });
  test(`${name}: without a saved key the normal route is used and the key is never sent`, async () => {
    const {state,response}=await invoke(name,{model:'openai:gpt-5-mini',env:{FIRBO_TEXT_ROUTING_MODE:'legacy'}});
    assert.equal(response.status,200);
    assert.equal(state.calls[0].init.headers.authorization,'Bearer direct-secret');
    assert.ok(!state.calls.some(c=>JSON.stringify(c.init?.headers??{}).includes(OWN)));
    assert.notEqual(state.writes.find(w=>w.table==='usage_events').payload.own_key,true);
  });
}

test('agent-runner: the agent searches, reads a page, then reports; usage and steps are recorded once', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'allow'},{tool_name:'browser_extract',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"web_search","input":"sports market 2026"}','{"action":"read_page","input":"https://news.example/a"}',JSON.stringify({summary:'Market up 5%',report:'Source: https://news.example/a',actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies});
  assert.equal(response.status,200);
  const chats=state.calls.filter(c=>String(c.url).endsWith('/chat/completions'));
  assert.equal(chats.length,3);
  const lastBody=JSON.parse(chats[2].init.body);
  assert.ok(lastBody.messages.some(m=>/Full article text/.test(m.content)));
  const usage=state.writes.filter(w=>w.table==='usage_events');
  assert.equal(usage.length,1);
  assert.equal(usage[0].payload.input_tokens,300);
  assert.equal(usage[0].payload.cost_usd,Math.round((300*1+60*2))/1e6);
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.summary,'Market up 5%');
  assert.deepEqual(result.steps.map(s=>s.action),['web_search','read_page']);
  assert.ok(result.powers_used.includes('web_search')&&result.powers_used.includes('browser_extract'));
});
test('agent-runner: a gateway reply that is only the model thinking aloud is asked again', async () => {
  const chatReplies=["Okay, let's see. The user wants a report about the market. I need to",JSON.stringify({summary:'Market up 5%',report:'Report',actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools:[],chatReplies});
  assert.equal(response.status,200);
  assert.equal(state.calls.filter(c=>String(c.url).endsWith('/chat/completions')).length,2);
  assert.equal(state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result.summary,'Market up 5%');
});
test('agent-runner: a blocked tool is never offered to the model', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'block'}];
  const {state}=await invoke('agent-runner',{tools});
  const chat=state.calls.find(c=>String(c.url).endsWith('/chat/completions'));
  assert.doesNotMatch(JSON.parse(chat.init.body).messages[0].content,/"action": "web_search"/);
  assert.ok(!state.calls.some(c=>String(c.url).endsWith('/search')));
});

test('agent-runner: two 👎 on recent reports move an economy agent up to the quality route, with the owner notes', async () => {
  const feedback=[{rating:-1,note:'Too vague, add numbers'},{rating:1,note:null},{rating:-1,note:null}];
  const {state,response}=await invoke('agent-runner',{feedback,plan:'pro'});
  assert.equal(response.status,200);
  const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
  assert.equal(chat.model,'firbo-quality');
  assert.match(chat.messages[0].content,/Too vague, add numbers/);
  assert.equal(state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result.routed_up,'feedback');
  const liked=await invoke('agent-runner',{feedback:[{rating:-1,note:null},{rating:1,note:null}],plan:'pro'});
  assert.notEqual(JSON.parse(liked.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).model,'firbo-quality');
});
test('agent-runner: installed skills are part of the instructions', async () => {
  const {state}=await invoke('agent-runner',{skills:[{name:'Price quotes',instructions:'Always add VAT 24% and a validity date.'}]});
  const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
  assert.match(chat.messages[0].content,/SKILLS[\s\S]*Price quotes[\s\S]*VAT 24%/);
});
test('agent-runner: the calculator power is offered and its exact result is fed back', async () => {
  const tools=[{tool_name:'calculator',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"calculator","input":"1200 * 0.24"}',JSON.stringify({summary:'VAT is 288',report:'VAT is 288',actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies});
  assert.equal(response.status,200);
  const chats=state.calls.filter(c=>String(c.url).endsWith('/chat/completions'));
  assert.match(JSON.parse(chats[0].init.body).messages[0].content,/"action": "calculator"/);
  assert.ok(JSON.parse(chats[1].init.body).messages.some(m=>/1200 \* 0\.24 = 288/.test(m.content)));
});
const serverEnv={OPENJARVIS_URL:'https://admin-jarvis.example/jarvis',OPENJARVIS_API_KEY:'admin-key',OPENJARVIS_SANDBOX_URL:'https://box-jarvis.example/jarvis-box',OPENJARVIS_SANDBOX_API_KEY:'box-key',FIRBO_SERVER_AGENT_PLANS:'pro,business,enterprise'};
const serverReplies=()=>['{"action":"server_task","input":"print(sum(range(10)))"}',JSON.stringify({summary:'45',report:'45',actions:[]})];
test('agent-runner: a customer company gets only the sandboxed server agent, never the admin one', async () => {
  const tools=[{tool_name:'code_interpreter',enabled:true,policy:'allow'}];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies:serverReplies(),plan:'pro',env:serverEnv});
  assert.equal(response.status,200);
  const urls=state.calls.map(c=>String(c.url));
  assert.ok(urls.some(u=>u.startsWith('https://box-jarvis.example/jarvis-box/v1/chat/completions')));
  assert.ok(!urls.some(u=>u.startsWith('https://admin-jarvis.example')));
  const box=state.calls.find(c=>String(c.url).startsWith('https://box-jarvis.example/jarvis-box/v1/chat'));
  assert.equal(box.init.headers.authorization,'Bearer box-key');
  assert.match(JSON.parse(state.calls.find(c=>String(c.url).includes('gateway')).init.body).messages[0].content,/locked sandbox/);
});
test('agent-runner: the platform admin company uses the full server agent; a plan without the power gets none', async () => {
  const tools=[{tool_name:'code_interpreter',enabled:true,policy:'allow'}];
  const own=await invoke('agent-runner',{tools,chatReplies:serverReplies(),plan:'free',adminMember:true,platform_admins:[{user_id:USER}],env:serverEnv});
  assert.equal(own.response.status,200);
  assert.ok(own.state.calls.some(c=>String(c.url).startsWith('https://admin-jarvis.example/jarvis/v1/chat/completions')));
  const starter=await invoke('agent-runner',{tools,plan:'starter',env:serverEnv});
  assert.ok(!starter.state.calls.some(c=>/jarvis/.test(String(c.url))));
  assert.doesNotMatch(JSON.parse(starter.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content,/server_task/);
});

test('agent-chat: matching company knowledge is part of the answer context', async () => {
  const {state,response}=await invoke('agent-chat',{knowledgeCount:3,knowledgeHits:[{title:'Price list',url:null,content:'The yearly plan costs 480 euro.',score:0.03}]});
  assert.equal(response.status,200);
  const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
  assert.match(chat.messages[0].content,/COMPANY KNOWLEDGE[\s\S]*Price list[\s\S]*480 euro/);
  assert.equal(state.rpcs.find(r=>r.fn==='match_knowledge').args.p_org,ORG);
});
test('agent-chat: the scheduler secret lets Telegram act only as the person it names, with their role checked', async () => {
  const ok=await invoke('agent-chat',{unsigned:true,cron:'cron-test'},{system_user_id:USER});
  assert.equal(ok.response.status,200);
  const bad=await invoke('agent-chat',{unsigned:true,cron:'wrong'},{system_user_id:USER});
  assert.equal(bad.response.status,401);
  const outsider=await invoke('agent-chat',{unsigned:true,cron:'cron-test',noMembership:true},{system_user_id:USER});
  assert.equal(outsider.response.status,403);
});
