/** Actual entrypoint handlers with the SDK import replaced by a test double.
 * Database, auth and inference transport are mocked. No real Deno deployment,
 * SQL isolation, provider spend, browser session or durable transaction is claimed.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { maximumInferenceCost, maximumTokenBoundCost } from '../../supabase/functions/_shared/inference-accounting.ts';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const AGENT='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TASK='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONVO='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CLAIM='ffffffff-ffff-4fff-8fff-ffffffffffff';
const CHAT_REQUEST='11111111-1111-4111-8111-111111111111';
const ACCOUNTING='22222222-2222-4222-8222-222222222222';
const JARVIS_EMPLOYEE='99999999-9999-4999-8999-999999999999';
const JARVIS_MESSAGE='88888888-8888-4888-8888-888888888888';
const root = new URL('../../',import.meta.url);
const originalFetch=globalThis.fetch, originalDeno=globalThis.Deno;
const temp=await mkdtemp(join(tmpdir(),'firbo-edge-tests-'));
let current, captured;
globalThis.__firboTestCreateClient=(...args)=>current.client(...args);
globalThis.Deno={env:{get:key=>current.env[key]},serve:handler=>{captured=handler;}};
const handlers={};
const textHandlers=['agent-chat','agent-runner'];
for (const name of [...textHandlers,'mission-runner']) {
  const source=await readFile(new URL(`supabase/functions/${name}/index.ts`,root),'utf8');
  const replacement="const createClient = (...args: any[]) => (globalThis as any).__firboTestCreateClient(...args);";
  const code=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",replacement)
    .replace(/'\.\.\/_shared\/([a-z-]+\.ts)'/g,(_m,file)=>JSON.stringify(new URL(`supabase/functions/_shared/${file}`,root).href));
  assert.notEqual(code,source);
  const path=join(temp,`${name}.ts`);await writeFile(path,code);await import(pathToFileURL(path).href);handlers[name]=captured;
}
after(async()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__firboTestCreateClient;await rm(temp,{recursive:true,force:true});});

function fixture(options={}) {
  const state={calls:[],writes:[],reads:[],stored:[],computerJobs:options.existingComputerJobs??[],env:{
    SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',
    FIRBO_TEXT_ROUTING_MODE:'gateway',OMNIROUTE_BASE_URL:'https://gateway.firboai.app/v1',OMNIROUTE_API_KEY:'inference-test',
    OMNIROUTE_PRICE_IN_PER_M:'1',OMNIROUTE_PRICE_OUT_PER_M:'2',
    ...((options.tools??[]).some(t=>t.tool_name==='computer_use')?{OPENJARVIS_URL:'https://jarvis.example.test',OPENJARVIS_API_KEY:'selection-test'}:{}),
    LLM_DEFAULT:'openai:test-model',LLM_FALLBACK:'openai:backup-model',OPENAI_API_KEY:'direct-secret',...options.env}};
  const user={id:USER,email:'owner@example.test'};
  const task={id:TASK,organization_id:ORG,title:options.taskTitle??'Review test task',description:'Do not send anything without approval.',status:options.taskStatus??(options.mission?'running':'pending'),priority:'normal',assigned_agent_id:AGENT,result:options.result??null,
    ...(options.serverJarvisTask?{created_by:USER,metadata:{source:'jarvis_autopilot_server_v1',dispatch_state:options.dispatchState??'claimed'}}:{}),
    ...(options.mission?{kind:'mission',metadata:{}}:{})};
  const agent={id:AGENT,name:'Test agent',type:options.agentType??(options.mission?'ceo':'custom'),model:options.model??'auto',enabled:!options.disabled,temperature:0.4,monthly_budget_usd:options.monthlyBudget??10,system_prompt:'Work safely.',owner_instructions:options.ownerInstructions??'',autonomy:options.autonomy??'supervised',agent_tools:options.tools??[],
    ...(options.mission?{slug:'ceo'}:{})};
  const execute=(table,op,payload,filters,selection,single=false)=>{
    const info={table,op,payload,filters,selection};
    if(op!=='select'){
      state.writes.push(info);
      if(table==='tasks'&&op==='update'&&payload.result?.computer_execution) {
        if(options.computerReceiptSaveError)return{data:null,error:{message:'database unavailable'}};
        state.computerResult=payload.result;
        return{data:{id:TASK,organization_id:ORG,status:'running',run_claim:CLAIM,result:payload.result},error:null};
      }
      if(table==='messages')return{data:options.messageError?null:{id:options.savedAssistantId&&payload.role==='assistant'?options.savedAssistantId:'saved',...payload},error:options.messageError?{message:'db failure'}:null};
      if(table==='tasks'&&op==='update'&&payload.result?.reconcile_required===true) {
        if(options.reconciliationWriteThrows)throw new Error('transport unavailable');
        return {data:options.reconciliationWriteConflict?null:{id:TASK,organization_id:ORG,status:'running',run_claim:CLAIM,result:payload.result},error:options.reconciliationWriteError?{message:'database unavailable'}:null};
      }
      if(table==='tasks'&&op==='update')return{data:options.claimLost&&payload.status==='running'?null:{id:TASK},error:options.resultError&&payload.result?{message:'db failure'}:null};
      if(table==='usage_events')return{data:null,error:options.usageError?{message:'db failure'}:null};
      if(table==='approvals')return{data:null,error:options.approvalError?{message:'db failure'}:null};
      if(table==='connector_jobs'){
        const row={id:'12121212-1212-4212-8212-121212121212',...payload};
        state.computerJobs=[...(state.computerJobs??[]),row];
        if(options.computerInsertResponseLost)return{data:null,error:{message:'response lost'}};
        return{data:{id:row.id},error:null};
      }
      return{data:null,error:null};
    }
    state.reads.push(info);
    if(table==='conversations'){
      // An authorized old-session LIST is a collection, unlike the current
      // conversation maybeSingle. Keep its company/user/CEO query observable.
      if(selection?.includes('updated_at'))return{data:options.pastCeoSessions??[],error:null};
      return{data:options.missingConversation?null:{id:CONVO,organization_id:ORG,user_id:options.foreignConversation?'foreign':USER,agent_id:AGENT,title:'Test',status:'active'},error:null};
    }
    if(table==='organization_members')return{data:options.noMembership?null:{role:options.role??'owner'},count:options.adminMember?1:0,error:null};
    if(table==='agents'){
      assert.ok(filters.some(([k,v])=>k==='organization_id'&&v===ORG),'agent read must be bound to verified organization');
      if(options.jarvisEmployee&&single&&selection?.includes('autonomy')
        &&filters.some(([k,v])=>k==='id'&&v===JARVIS_EMPLOYEE))
        return{data:{id:JARVIS_EMPLOYEE,slug:'research',name:'Research',enabled:true,autonomy:'auto'},error:null};
      if(options.mission&&!single)return{data:options.foreignAgent||options.disabled?[]:[agent],error:null};
      return{data:options.foreignAgent?null:{...agent,...(selection?.includes('autonomy')&&state.rpcs?.some(r=>r.fn==='claim_task_run')?{autonomy:options.freshAutonomy??agent.autonomy,enabled:options.freshAgentEnabled??agent.enabled}:{})},error:null};
    }
    if(options.mission&&table==='tasks'&&filters.some(([k,v])=>k==='parent_task_id'&&v===TASK)){
      if(options.missionStepsThrow)throw new Error('private database transport failure');
      return{data:Object.hasOwn(options,'missionSteps')?options.missionSteps:[{id:CHAT_REQUEST,organization_id:ORG,parent_task_id:TASK,title:'Research delivered',status:'completed',assigned_agent_id:AGENT,result:{report:'Observed completed research.'}}],
        error:options.missionStepsError?{message:'private database failure'}:null};
    }
    if(table==='tasks'&&selection==='id,organization_id,status,run_claim,result'&&options.reconciliationReadConflict)return{data:{...task,status:'completed',run_claim:null},error:null};
    if(table==='tasks'&&filters.some(([k])=>k==='neq:id')&&filters.some(([k,v])=>k==='created_by'&&v===USER)){
       // The new specialist historical-work query is a collection. Its
       // content must not accidentally reuse the current task singleton.
       return{data:options.previousAgentTasks??[],error:null};
     }
     if(table==='tasks')return{data:options.missingTask?null:{...task,result:state.computerResult??task.result,
      ...(selection?.includes('run_claim')&&(state.rpcs?.some(r=>r.fn==='claim_task_run')||options.taskStatus==='running')?{
        status:options.taskChangedAfterSelection&&state.workerSelections?.length?'completed':'running',
        run_claim:options.taskChangedAfterSelection&&state.workerSelections?.length?null:CLAIM,assigned_agent_id:AGENT}: {})},error:null};
    if(table==='connector_devices'){
      const initialPolicy={enabled:true,apps:['Safari'],shortcuts:[],writes:'auto',commands:'safe',hours:null};
      const device={id:'13131313-1313-4313-8313-131313131313',organization_id:ORG,created_by:USER,name:'Synthetic Mac',platform:'darwin',last_seen_at:new Date().toISOString(),
        paired:true,revoked_at:null,capabilities:{job_kinds:['list','read','write','browser_task'],roots:['Documents']},
        agent_policy:single?(options.freshDevicePolicy??initialPolicy):initialPolicy};
      const devices=options.devices??[device];
      const chosen=devices.find(d=>filters.some(([key,value])=>key==='id'&&value===d.id));
      return{data:single?chosen?{...chosen,agent_policy:options.freshDevicePolicy??chosen.agent_policy,
        ...(options.deviceChangedAfterSelection&&state.workerSelections?.length?{capabilities:{job_kinds:[]}}:{})}:null:devices,error:null};
    }
    if(table==='agent_tools')return{data:{enabled:options.freshToolEnabled??true,policy:options.freshToolPolicy??'allow'},error:null};
    if(table==='connector_jobs'){
      if(selection==='device_id')return{data:options.workerActiveJobs??[],error:null};
      const jobs=(state.computerJobs??[]).map(j=>({...j,status:options.computerJobStatus??'done',
        result:options.computerJobResult??{entries:[{name:'report.md',type:'file'}]},error:null,
        ...(options.computerTerminalReceipt?{report_sha256:'a'.repeat(64),receipt:{contract:'firbo-execution-receipt/v1',job_id:j.id,
          device_id:j.device_id,kind:j.kind,ok:true,report_sha256:'a'.repeat(64)}}:{})}));
      return{data:single?jobs.find(j=>filters.every(([k,v])=>j[k]===v))??null:jobs,error:null};
    }
    if(table==='usage_events')return{data:options.memberSpendRows??(options.spent?[{cost_usd:options.spent}]:[]),count:options.count??0,error:options.budgetError?{message:'db unavailable'}:null};
    if(table==='company_memory_publications')return{data:options.companyMemoryPublications??[],error:null};
    if(table==='jarvis_autopilot_settings')return{data:options.serverJarvisGrant?{enabled:true}:null,error:options.serverGrantError?{message:'unavailable'}:null};
    if(table==='memories')return{data:(options.memories??[]).map(m=>({...m,user_id:m.user_id===undefined?USER:m.user_id})),error:null};
    if(table==='messages'){
      // Current chat history, old CEO snippets and exact job-ID lookup must
      // match their distinct real Postgres query return types.
      if(single&&filters.some(([k])=>k==='id'))return{data:options.existingJournalMessage??null,error:null};
      const archived=filters.find(([k,v])=>k==='conversation_id'&&Array.isArray(v));
      return{data:archived?options.pastCeoMessages??[]:options.messages??[],error:null};
    }
    if(table==='approvals'||table==='skills'||table==='platform_admins')return{data:options[table]??[],error:null};
    if(table==='report_feedback')return{data:options.feedback??[],error:null};
    if(table==='knowledge_chunks')return{data:null,count:options.knowledgeCount??0,error:null};
    if(table==='integrations'){
      assert.ok(filters.some(([k,v])=>k==='organization_id'&&v===ORG),'integration read must be bound to verified organization');
      return{data:options.integrations??[],error:options.integrationsError?{message:'db unavailable'}:null};
    }
    if(table==='organizations')return{data:{name:'Test company',profile:{},plan:options.plan??'pro',plan_status:options.planStatus??'active',status:'active'},error:null};
    if(table==='cron_secrets')return{data:{value:'cron-test'},error:null};
    throw Error('Unhandled test table '+table);
  };
  const client=(_url,key)=>({
    auth:{getUser:async()=>({data:{user:options.unsigned?null:user}}),admin:{getUserById:async()=>({data:{user}})}},
    storage:{from:()=>({
      upload:async(path,bytes,config)=>{state.stored.push({path,size:bytes.length,config});return{error:options.imageStoreError?{message:'storage unavailable'}:null};},
      getPublicUrl:path=>({data:{publicUrl:`https://cdn.example/${path}`}}),
    })},
    rpc:async(fn,args)=>{
      state.rpcs=[...(state.rpcs??[]),{fn,args}];
      if(fn==='firbo_reserve_inference') {
        if(options.budgetError)return{data:null,error:{message:'db unavailable'}};
        if(options.spent)return{data:{ok:false,reason:'budget_exceeded',spent:options.spent,budget:10},error:null};
        if((options.count??0)>=60)return{data:{ok:false,reason:'rate_limited',hourly:options.count,limit:60},error:null};
        if(options.reservationDuplicate)return{data:{ok:true,duplicate:true,request_id:ACCOUNTING,status:'reserved'},error:null};
        return{data:{ok:true,duplicate:false,request_id:ACCOUNTING,status:'reserved',spent:0,reserved:0,budget:10},error:null};
      }
      if(fn==='firbo_reserve_runner_inference') {
        if(options.budgetError)return{data:null,error:{message:'db unavailable'}};
        if(options.spent)return{data:{ok:false,reason:'budget_exceeded',spent:options.spent,budget:10},error:null};
        if((options.count??0)>=20)return{data:{ok:false,reason:'rate_limited',hourly:options.count,limit:20},error:null};
        if(options.denyServerReservation&&String(args.p_route).startsWith('openjarvis:'))return{data:{ok:false,reason:'budget_exceeded'},error:null};
        const requestId=crypto.randomUUID();
        state.runnerRequests=[...(state.runnerRequests??[]),requestId];
        return{data:{ok:true,duplicate:false,request_id:requestId,status:'reserved',
          attempt_ordinal:args.p_attempt_ordinal,dispatch_state:'admitted',spent:0,reserved:0,budget:10},error:null};
      }
      if(fn==='firbo_begin_runner_dispatch') {
        return{data:{ok:true,duplicate:false,request_id:args.p_request,
          dispatch_allowed:!options.runnerDispatchDenied,dispatch_state:'dispatching'},error:null};
      }
      if(fn==='firbo_settle_inference') {
        if(options.usageError)return{data:null,error:{message:'db unavailable'}};
        state.writes.push({table:'usage_events',op:'rpc',payload:{organization_id:ORG,user_id:USER,agent_id:AGENT,model:args.p_model,
          input_tokens:args.p_input_tokens,output_tokens:args.p_output_tokens,cost_usd:args.p_cost_usd,latency_ms:args.p_latency_ms,own_key:args.p_own_key,
          inference_request_id:args.p_request}});
        return{data:{ok:true,duplicate:false,request_id:args.p_request,status:options.accountingOverrun?'settled_overrun':'settled'},error:null};
      }
      if(fn==='firbo_mark_inference_ambiguous')return{data:{ok:true,request_id:args.p_request,status:'reconcile_required'},error:null};
      if(fn==='firbo_release_inference')return{data:{ok:true,request_id:args.p_request,status:'released'},error:null};
      if(fn==='claim_task_run') {
        if(options.claimLost||options.activeExecution)return{data:null,error:{message:options.activeExecution?'task_active_jobs':'not_runnable'}};
        if(options.claimUnavailable)return{data:null,error:{message:'database unavailable'}};
        return{data:options.malformedClaim?{}:{id:TASK,organization_id:ORG,status:'running',run_claim:CLAIM},error:null};
      }
      if(fn==='publish_task_run') {
        if(options.publishConflict)return{data:null,error:{message:'state_conflict'}};
        if(options.resultError||options.approvalError&&args.p_approvals.length)return{data:null,error:{message:'db failure'}};
        if(options.publishResponseLost&&state.rpcs.filter(r=>r.fn==='publish_task_run').length>1)return{data:null,error:{message:'state_conflict'}};
        // Model the successful RPC effects for existing accounting/receipt
        // assertions. Real transaction/isolation guarantees use PostgreSQL tests.
        state.writes.push({table:'tasks',op:'rpc',payload:{status:args.p_status,result:args.p_result}});
        if(args.p_approvals.length)state.writes.push({table:'approvals',op:'rpc',payload:args.p_approvals.map(a=>({...a,organization_id:ORG,task_id:TASK,agent_id:AGENT,status:'pending'}))});
        if(options.publishResponseLost)return{data:null,error:{message:'response lost after commit'}};
        return{data:{id:TASK,organization_id:ORG,status:args.p_status,run_claim:CLAIM,queued:args.p_approvals.length},error:null};
      }
      if(fn==='admit_jarvis_autopilot_task')return options.jarvisAdmissionDenied
         ? {data:null,error:{message:'quota or revoked'}}
         : {data:{task_id:options.savedAssistantId??JARVIS_MESSAGE,created:true,status:'pending'},error:null};
       if(fn==='match_knowledge')return{data:options.knowledgeHits??[],error:null};
      if(fn==='provider_key_for_runtime')return{data:options.ownKey??null,error:null};
      return{data:100,error:options.planError?{message:'db failure'}:null};
    },
    from:table=>{
      let op='select',payload,selection;const filters=[];
      const b={
        select(s){selection=s;return b;},insert(p){op='insert';payload=p;return b;},update(p){op='update';payload=p;return b;},
        eq(k,v){filters.push([k,v]);return b;},neq(k,v){filters.push(['neq:'+k,v]);return b;},in(k,v){filters.push([k,v]);return b;},is(k,v){filters.push([k,v]);return b;},contains(){return b;},gte(){return b;},or(v){filters.push(['or',v]);return b;},order(){return b;},limit(){return b;},
        maybeSingle(){return Promise.resolve(execute(table,op,payload,filters,selection,true));},single(){return b.maybeSingle();},
        then(resolve,reject){return Promise.resolve(execute(table,op,payload,filters,selection,false)).then(resolve,reject);},
      };return b;
    },
  });
  state.client=client;current=state;
  globalThis.fetch=async(url,init)=>{
    state.calls.push({url,init});
    if(String(url).endsWith('/v1/firbo/dispatch')){
      const request=JSON.parse(init.body);state.workerSelections=[...(state.workerSelections??[]),request];
      if(options.workerSelectionFailure)return Response.json({error:'target_unavailable'},{status:409});
      if(request.kind==='server_task')return Response.json({contract:request.contract,request_id:request.request_id,organization_id:request.organization_id,
        worker:{kind:'vps',id:'vps',name:'Firbo VPS',platform:'linux'},job:{kind:request.kind,params:request.params},reason:'synthetic_vps_selection'});
      const device=request.devices.find(d=>d.id===options.selectedWorker)??request.devices[0];
      if(!device)return Response.json({error:'no_eligible_worker'},{status:409});
      return Response.json({contract:request.contract,request_id:request.request_id,organization_id:request.organization_id,
        worker:{kind:'computer',id:device.id,name:device.name,platform:device.platform},
        job:options.selectedWorkerJob??{kind:request.kind,params:request.params},reason:'synthetic_vps_selection'});
    }
    if(String(url).includes('api.firboai.app/v1/firbo/free/')){
      if(options.freeFailure)return Response.json({error:'unavailable'},{status:503});
      const request=JSON.parse(init.body);
      return Response.json({model:'ollama:qwen3:1.7b',choices:[{message:{content:JSON.stringify({summary:'Draft',report:'Synthetic draft',actions:[{action:'send_email',risk:'medium',payload:{}}]})},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10},
        firbo:{contract:'firbo-free-text/v1',request_id:request.request_id,policy:'no-paid-fallback',provider_fee_usd:options.badFreeCost?1:0,cost_basis:'self_hosted_no_metered_fee',infrastructure_cost_excluded:true}});
    }
    if(options.ownFailure&&String(url).startsWith('https://api.openai.com/'))return Response.json({error:{message:'invalid'}},{status:401});
    if(options.gatewaySearchFailure && String(url).includes('gateway.firboai.app') && String(url).endsWith('/search'))return new Response('upstream error',{status:502});
    if(options.emptyGatewaySearch && String(url).includes('gateway.firboai.app') && String(url).endsWith('/search'))return Response.json({results:[]});
    if(String(url)==='https://api.tavily.com/search')return Response.json({
      results:[{title:'Sports market grows',url:'https://news.example/a',content:'Up 5%'}],
      ...(options.tavilyMissingUsage?{}:{usage:{credits:1}}),
    });
    if(String(url).endsWith('/search'))return Response.json({results:[{title:'Sports market grows',url:'https://news.example/a',snippet:'Up 5%'}]});
    if(String(url).endsWith('/web/fetch'))return Response.json({content:'Full article text about the sports market.'});
    if(/jarvis/.test(String(url)))return String(url).endsWith('/v1/info')?Response.json({model:'firbo-quality'}):Response.json({
      model:'firbo-quality',choices:[{message:{content:'45'}}],execution:options.serverExecution,
      ...(options.serverMissingUsage?{}:{usage:{prompt_tokens:30,completion_tokens:5,total_tokens:35}})});
    if(options.imageResponse&&String(url).endsWith('/images/generations')){
      if(options.imageGatewayFailure)return new Response('upstream error',{status:502});
      return Response.json({data:[{b64_json:Buffer.from(new Uint8Array(5000).fill(7)).toString('base64')}]});
    }
    if(options.pollinationsResponse&&String(url).startsWith('https://image.pollinations.ai/')){
      return new Response(new Uint8Array(5000).fill(8),{status:200,headers:{'content-type':'image/jpeg'}});
    }
    if(options.visionResponse&&String(url).endsWith('/chat/completions')){
      const request=JSON.parse(init.body);
      if(Array.isArray(request?.messages?.[0]?.content))return Response.json({model:'vision/resolved',choices:[{message:{content:'Blue image.'}}],
        ...(options.visionMissingUsage?{}:{usage:{prompt_tokens:250,completion_tokens:15}})});
    }
    if(options.chatReplies&&String(url).endsWith('/chat/completions')){
      const reply=options.chatReplies.shift();
      if(reply!==undefined)return Response.json({model:'provider/resolved',choices:[{message:{content:reply}}],usage:{prompt_tokens:100,completion_tokens:20}});
    }
    if(options.gatewayFailure&&String(url).includes('gateway.firboai.app'))return new Response('upstream private error',{status:502});
    return Response.json({model:'provider/resolved',choices:[{message:{content:JSON.stringify({summary:'Test result',report:options.shortReport?'Result':FULL_REPORT,actions:options.noActions?[]:[{action:'send_email',risk:'medium',payload:{to:'test@example.test'}}]})}}],usage:{prompt_tokens:100,completion_tokens:20}});
  };
  return state;
}
// A report that already meets the professional standard (sections, enough substance): it needs no quality pass.
const FULL_REPORT=['## Executive summary','The market grew. '.repeat(40),'## Findings','Sales rose in every region. '.repeat(25),'## Recommendations','1. Expand online. '.repeat(25)].join('\n');
async function invoke(name,options={},bodyExtra={}){
  const state=fixture({...options,mission:name==='mission-runner'});
  const payload=name==='agent-chat'?{conversation_id:CONVO,message:'Test message',request_id:CHAT_REQUEST,...bodyExtra}
    :name==='mission-runner'?{mission_id:TASK,action:'synthesize',...bodyExtra}:{task_id:TASK,...bodyExtra};
  const headers={'content-type':'application/json',authorization:'Bearer user-test',...(options.cron?{'x-cron-secret':options.cron}:{})};
  const response=await handlers[name](new Request('https://db.example.test/functions/v1/'+name,{method:'POST',headers,body:JSON.stringify(payload)}));
  return{state,response,body:await response.json()};
}

for(const name of textHandlers){
  test(`${name}: selected gateway route uses one request and keeps company accounting`,async()=>{
    const {state,response,body}=await invoke(name);
    assert.equal(response.status,200);assert.equal(state.calls.length,1);assert.ok(state.calls[0].url.startsWith('https://gateway.firboai.app/v1/'));
    const usage=state.writes.find(w=>w.table==='usage_events');assert.equal(usage.payload.organization_id,ORG);
    assert.equal(usage.payload.model,name==='agent-runner'?'omniroute:provider/resolved':'omniroute:firbo-economy');
    assert.equal(body.routing.reported_model,'provider/resolved');assert.equal(body.routing.cost_basis,'configured_estimate');
    assert.ok(!JSON.stringify(body).includes('inference-test'));
  });
  test(`${name}: gateway failure cannot use direct-provider fallback`,async()=>{
    const {state,response,body}=await invoke(name,{gatewayFailure:true});assert.equal(response.status,name==='agent-runner'?503:502);assert.equal(state.calls.length,1);assert.equal(body.routing.status,'failed');
    if(name==='agent-runner'){assert.equal(body.error,'reconciliation_required');assert.equal(body.retry_safe,false);}
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
    const {response,body}=await invoke(name,{usageError:true});assert.equal(response.status,503);
    assert.equal(body.error,name==='agent-runner'?'reconciliation_required':'result_save_failed');assert.equal(body.retry_safe,false);
  });
}
test('chat cannot act on another user conversation',async()=>{const {state,response}=await invoke('agent-chat',{foreignConversation:true});assert.equal(response.status,403);assert.equal(state.calls.length,0);});
test('JARVIS preference affects CEO reasoning only and never grants execution rights',async()=>{
 const enabled=await invoke('agent-chat',{agentType:'ceo'},{jarvis_autopilot:true});
 assert.equal(enabled.response.status,200);
 const prompt=JSON.parse(enabled.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
 assert.match(prompt,/JARVIS AUTOPILOT IS ON/);
 assert.match(prompt,/grants ZERO permissions/);
 const ordinary=await invoke('agent-chat',{agentType:'ceo'});
 assert.equal(ordinary.response.status,200);
 const normalPrompt=JSON.parse(ordinary.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
 assert.doesNotMatch(normalPrompt,/JARVIS AUTOPILOT IS ON/);
 for(const invalid of ['on',1,null]){
  const rejected=await invoke('agent-chat',{agentType:'ceo'},{jarvis_autopilot:invalid});
  assert.equal(rejected.response.status,400);
  assert.equal(rejected.state.calls.length,0);
 }
 const nonCeo=await invoke('agent-chat',{agentType:'research'},{jarvis_autopilot:true});
 assert.equal(nonCeo.response.status,200);
 const specialistPrompt=JSON.parse(nonCeo.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
 assert.doesNotMatch(specialistPrompt,/JARVIS AUTOPILOT IS ON/);
});
test('JARVIS server ON requires the stored personal grant, not just a browser flag',async()=>{
 const marker='Answer\\n\\n[[task:'+JARVIS_EMPLOYEE+']] Compare sectors\\nCite public sources.';
 const base={agentType:'ceo',env:{FIRBO_JARVIS_SERVER_AUTOPILOT:'on'},savedAssistantId:JARVIS_MESSAGE,jarvisEmployee:true};
 const off=await invoke('agent-chat',{...base,serverJarvisGrant:false,chatReplies:[marker]},{jarvis_autopilot:true});
 assert.equal(off.response.status,200);
 assert.ok(!off.body.jarvis_autopilot,'a UI preference cannot authorize a server task');
 assert.equal(off.state.rpcs.filter(x=>x.fn==='admit_jarvis_autopilot_task').length,0);
 const offPrompt=JSON.parse(off.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
 assert.doesNotMatch(offPrompt,/JARVIS AUTOPILOT IS ON/);
 const on=await invoke('agent-chat',{...base,serverJarvisGrant:true,chatReplies:[marker]},{jarvis_autopilot:true});
 assert.equal(on.response.status,200);
 assert.deepEqual(on.body.jarvis_autopilot,{mode:'server',task_id:JARVIS_MESSAGE,created:true,status:'pending'});
 const claim=on.state.rpcs.find(x=>x.fn==='admit_jarvis_autopilot_task');
 assert.ok(claim,'saved CEO message was not admitted through the server-only RPC');
 assert.deepEqual(claim.args,{p_org:ORG,p_owner:USER,p_conversation:CONVO,
  p_message:JARVIS_MESSAGE,p_agent:JARVIS_EMPLOYEE,p_title:'Compare sectors',p_details:'Cite public sources.'});
 assert.equal(on.state.writes.filter(x=>x.table==='tasks').length,0,'chat cannot directly start tasks outside RPC');
 const denied=await invoke('agent-chat',{...base,serverJarvisGrant:true,chatReplies:[marker],jarvisAdmissionDenied:true},{jarvis_autopilot:true});
 assert.equal(denied.response.status,200);
 assert.ok(!denied.body.jarvis_autopilot,'failed admission never announces work as queued');
});
test('JARVIS runner refuses no grant, missing queue claim and disabled gate before paid work',async()=>{
 for(const options of [
   {serverJarvisGrant:false,dispatchState:'claimed'},
   {serverJarvisGrant:true,dispatchState:'new'},
   {serverJarvisGrant:true,dispatchState:'claimed',env:{FIRBO_JARVIS_SERVER_AUTOPILOT:'off'}},
 ]){
   const env={FIRBO_JARVIS_SERVER_AUTOPILOT:'on',...options.env};
   const r=await invoke('agent-runner',{serverJarvisTask:true,autonomy:'auto',...options,env});
   assert.equal(r.response.status,403);
   assert.equal(r.body.error,'jarvis_not_authorized');
   assert.equal(r.state.calls.length,0);
   assert.ok(!r.state.rpcs?.some(x=>x.fn==='claim_task_run'));
 }
 const good=await invoke('agent-runner',{serverJarvisTask:true,autonomy:'auto',
   serverJarvisGrant:true,env:{FIRBO_JARVIS_SERVER_AUTOPILOT:'on'}});
 assert.equal(good.response.status,200);
 assert.equal(good.state.rpcs.filter(x=>x.fn==='claim_task_run').length,1);
});
test('agent-chat requires a client request id before any write or inference',async()=>{
  const {state,response}=await invoke('agent-chat',{}, {request_id:undefined});
  assert.equal(response.status,400);assert.equal(state.calls.length,0);assert.equal(state.writes.length,0);
});
test('agent-chat reserves before inference and settles the same ledger row atomically',async()=>{
  const {state,response,body}=await invoke('agent-chat');
  assert.equal(response.status,200);
  const reserve=state.rpcs.find(r=>r.fn==='firbo_reserve_inference');
  const settle=state.rpcs.find(r=>r.fn==='firbo_settle_inference');
  assert.equal(reserve.args.p_org,ORG);assert.equal(reserve.args.p_agent,AGENT);assert.equal(reserve.args.p_request_key,CHAT_REQUEST);
  assert.ok(reserve.args.p_reserved_usd>settle.args.p_cost_usd);assert.equal(settle.args.p_request,ACCOUNTING);
  assert.deepEqual(body.accounting,{request_id:ACCOUNTING,status:'settled'});
  assert.equal(state.writes.filter(w=>w.table==='usage_events').length,1);
});
test('agent-chat keeps an ambiguous provider failure reserved for reconciliation',async()=>{
  const {state,response,body}=await invoke('agent-chat',{gatewayFailure:true});
  assert.equal(response.status,502);assert.equal(body.retry_safe,false);assert.equal(body.accounting.status,'reconcile_required');
  const reconcile=state.rpcs.find(r=>r.fn==='firbo_mark_inference_ambiguous');
  assert.equal(reconcile.args.p_request,ACCOUNTING);assert.equal(reconcile.args.p_reason,'gateway_http_502');
  assert.ok(!state.rpcs.some(r=>r.fn==='firbo_settle_inference'));
});
test('agent-chat refuses a concurrent duplicate reservation',async()=>{
  const {state,response,body}=await invoke('agent-chat',{reservationDuplicate:true});
  assert.equal(response.status,409);assert.equal(body.error,'not_runnable');assert.equal(body.reason,'request_in_progress');assert.equal(state.calls.length,0);
  assert.ok(!state.writes.some(w=>w.table==='messages'));
});
test('agent-chat releases a reservation when the local user message cannot be saved',async()=>{
  const {state,response}=await invoke('agent-chat',{messageError:true});
  assert.equal(response.status,503);assert.equal(state.calls.length,0);
  const release=state.rpcs.find(r=>r.fn==='firbo_release_inference');
  assert.equal(release.args.p_request,ACCOUNTING);assert.equal(release.args.p_reason,'message_save_failed');
});
test('reservation estimate is conservative, additive across fallbacks and rejects invalid rates',()=>{
  const one=maximumInferenceCost({messages:[{role:'user',content:'hello'}]},[{priceIn:1,priceOut:2,maxOutputTokens:100}]);
  const two=maximumInferenceCost({messages:[{role:'user',content:'hello'}]},[{priceIn:1,priceOut:2,maxOutputTokens:100},{priceIn:3,priceOut:4,maxOutputTokens:200}]);
  assert.ok(one>0);assert.ok(two>one);
  assert.throws(()=>maximumInferenceCost({},[{priceIn:-1,priceOut:1,maxOutputTokens:1}]),/invalid_cost_rate/);
});
test('non-text token caps reserve conservatively and reject unbounded input',()=>{
  assert.equal(maximumTokenBoundCost(100_000,[{priceIn:3,priceOut:15,maxOutputTokens:700}]),0.3105);
  assert.throws(()=>maximumTokenBoundCost(-1,[{priceIn:3,priceOut:15,maxOutputTokens:700}]),/invalid_input_token_cap/);
  assert.throws(()=>maximumTokenBoundCost(1_000_000_001,[{priceIn:3,priceOut:15,maxOutputTokens:700}]),/invalid_input_token_cap/);
});
test('agent-chat offers only work sources not already present in this company',async()=>{
  const {state,response}=await invoke('agent-chat',{agentType:'ceo',integrations:[{kind:'gdrive_read',status:'active'}]});
  assert.equal(response.status,200);
  const request=JSON.parse(state.calls[0].init.body);
  const system=request.messages.find(m=>m.role==='system').content;
  assert.match(system,/Connected work sources: Google Drive · read/);
  const proposal=system.split('\n').find(line=>line.includes("founder's work would materially benefit"));
  assert.ok(proposal);assert.doesNotMatch(proposal,/gdrive_read \(/);assert.match(proposal,/gmail_read \(/);
});
test('agent-chat fails closed when integration state cannot be read',async()=>{
  const {state,response}=await invoke('agent-chat',{agentType:'ceo',integrationsError:true});
  assert.equal(response.status,200);
  const request=JSON.parse(state.calls[0].init.body);
  const system=request.messages.find(m=>m.role==='system').content;
  assert.match(system,/Connected work sources: unavailable/);
  assert.match(system,/propose exactly one from this list: none\./);
});
test('task retains human approval requirement',async()=>{const {state,body}=await invoke('agent-runner');const approvals=state.writes.find(w=>w.table==='approvals');assert.equal(approvals.payload[0].status,'pending');assert.equal(approvals.payload[0].organization_id,ORG);assert.equal(body.status,'awaiting_approval');});
test('suggest-only task does not insert external approvals',async()=>{const {state,body}=await invoke('agent-runner',{autonomy:'suggest'});assert.equal(body.status,'completed');assert.ok(!state.writes.some(w=>w.table==='approvals'));});
test('suggest-only employee cannot queue a computer write',async()=>{
  const tools=[{tool_name:'computer_use',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"computer","input":"write report.md :: synthetic"}',JSON.stringify({summary:'Suggested only',report:'I suggested the write.',actions:[]})];
  const {state,response}=await invoke('agent-runner',{autonomy:'suggest',tools,chatReplies});
  assert.equal(response.status,200);assert.equal(state.computerJobs?.length??0,0);
  assert.ok(JSON.parse(state.calls.filter(c=>String(c.url).endsWith('/chat/completions'))[1].init.body).messages.some(m=>/only suggest/i.test(m.content)));
});
test('computer action re-reads current employee power and device policy before enqueue',async()=>{
  const tools=[{tool_name:'computer_use',enabled:true,policy:'allow'}];
  const replies=()=>['{"action":"computer","input":"list Documents"}',JSON.stringify({summary:'Stopped',report:'Access was disabled.',actions:[]})];
  for(const options of [{freshToolEnabled:false},{freshDevicePolicy:{enabled:false,apps:[],shortcuts:[],writes:'off',commands:'off',hours:null}}]){
    const {state,response}=await invoke('agent-runner',{...options,tools,chatReplies:replies()});
    assert.equal(response.status,200);assert.equal(state.computerJobs?.length??0,0);
  }
});
test('auto computer job carries the exact task claim and authorization snapshots',async()=>{
  const tools=[{tool_name:'computer_use',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"computer","input":"list Documents"}',JSON.stringify({summary:'Listed',report:'report.md',actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies});
  assert.equal(response.status,200);assert.equal(state.computerJobs.length,1);
  assert.equal(state.computerJobs[0].agent_run_claim,CLAIM);assert.equal(state.computerJobs[0].agent_task_id,TASK);
  assert.equal(state.computerJobs[0].agent_policy_snapshot.enabled,true);
  assert.ok(state.computerJobs[0].agent_capabilities_snapshot.job_kinds.includes('list'));
});

const NATIVE_MAC='14141414-1414-4414-8414-141414141414';
const NATIVE_DEBIAN='15151515-1515-4515-8515-151515151515';
const nativeEnv={FIRBO_DESKTOP_VISION_MODEL:'openai/test-vision',FIRBO_DESKTOP_PRICE_IN_PER_M:'5',FIRBO_DESKTOP_PRICE_OUT_PER_M:'30'};
const nativeDevices=()=>[
  {id:NATIVE_MAC,organization_id:ORG,created_by:USER,name:'Synthetic Catalina Mac',platform:'darwin',paired:true,revoked_at:null,
    last_seen_at:new Date().toISOString(),capabilities:{job_kinds:['list','read','browser_open'],roots:['Documents']},
    agent_policy:{enabled:true,control:'full',writes:'auto',commands:'safe',hours:null}},
  {id:NATIVE_DEBIAN,organization_id:ORG,created_by:USER,name:'Synthetic Debian',platform:'linux',paired:true,revoked_at:null,
    last_seen_at:new Date().toISOString(),capabilities:{job_kinds:['list','read','desktop_task'],roots:['/home/firbo'],full_control:true},
    agent_policy:{enabled:true,control:'full',writes:'auto',commands:'safe',hours:null}},
];
const computerTools=[{tool_name:'computer_use',enabled:true,policy:'allow'}];
const nativeReplies=()=>['{"action":"computer","input":"desktop Άνοιξε YouTube και επιβεβαίωσε ότι προχωρά ο χρόνος."}',
  JSON.stringify({summary:'Finished',report:'The job completed.',actions:[]})];

test('employee native goal goes through VPS-selected Debian and stays running despite model completion prose',async()=>{
  const {state,response,body}=await invoke('agent-runner',{tools:computerTools,devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,
    plan:'enterprise',env:nativeEnv,computerJobStatus:'running',chatReplies:nativeReplies(),workerActiveJobs:[{device_id:NATIVE_MAC},{device_id:NATIVE_MAC}]});
  assert.equal(response.status,202);assert.equal(body.status,'running');assert.equal(body.pending,true);
  assert.equal(state.workerSelections.length,1);assert.equal(state.workerSelections[0].devices.length,2);
  assert.equal(state.workerSelections[0].devices[0].load,2);assert.equal(state.workerSelections[0].devices[1].load,0);
  assert.equal(state.computerJobs.length,1);const job=state.computerJobs[0];
  assert.equal(job.device_id,NATIVE_DEBIAN);assert.equal(job.kind,'desktop_task');
  assert.equal(job.params.goal,'Άνοιξε YouTube και επιβεβαίωσε ότι προχωρά ο χρόνος.');
  assert.equal(job.dispatch_request.contract,'firbo-dispatch-request/v1');assert.equal(job.dispatch_request.request_id,job.id);
  assert.deepEqual(job.dispatch_request.params,job.params);assert.ok(!('devices' in job.dispatch_request));
  assert.equal(job.origin,'agent');assert.equal(job.agent_task_id,TASK);assert.equal(job.agent_run_claim,CLAIM);
  const marker=state.computerResult.computer_execution;
  assert.equal(marker.ready_to_finalize,true);assert.equal(marker.verified_success,false);assert.equal(marker.jobs[0].job_id,job.id);
  assert.doesNotMatch(state.computerResult.report,/job completed/);assert.match(state.computerResult.unverified_draft.report,/job completed/);
  assert.ok(!state.rpcs.some(r=>r.fn==='publish_task_run'));assert.ok(!state.writes.some(w=>w.table==='connector_jobs'&&w.op==='update'));
  const system=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
  assert.match(system,/desktop <complete natural-language goal>/);assert.doesNotMatch(system,/run osascript/);
});

test('employee open_app accepts the exact VPS native adaptation on a worker without open_app',async()=>{
  const {state,response}=await invoke('agent-runner',{tools:computerTools,devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,
    selectedWorkerJob:{kind:'desktop_task',params:{goal:'Open Google Chrome'}},plan:'enterprise',env:nativeEnv,computerJobStatus:'running',
    chatReplies:['{"action":"computer","input":"open_app Google Chrome"}',JSON.stringify({summary:'Pending',report:'Waiting.',actions:[]})]});
  assert.equal(response.status,202);assert.equal(state.computerJobs.length,1);
  assert.equal(state.computerJobs[0].kind,'desktop_task');assert.deepEqual(state.computerJobs[0].params,{goal:'Open Google Chrome'});
  assert.equal(state.computerJobs[0].dispatch_request.kind,'open_app');assert.deepEqual(state.computerJobs[0].dispatch_request.params,{app:'Google Chrome'});
});

test('employee native approval keeps the chosen worker and goal, without inline enqueue',async()=>{
  const {state,response,body}=await invoke('agent-runner',{tools:[{tool_name:'computer_use',enabled:true,policy:'approval'}],freshToolPolicy:'approval',
    devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,plan:'enterprise',env:nativeEnv,chatReplies:nativeReplies()});
  assert.equal(response.status,200);assert.equal(body.status,'awaiting_approval');assert.equal(state.computerJobs.length,0);
  const approved=state.writes.find(w=>w.table==='approvals').payload[0];
  assert.equal(approved.action,'computer_desktop_task');assert.equal(approved.payload.device_id,NATIVE_DEBIAN);
  assert.equal(approved.payload.goal,'Άνοιξε YouTube και επιβεβαίωσε ότι προχωρά ο χρόνος.');assert.equal(approved.risk,'high');
  assert.equal(approved.payload.dispatch_request.kind,'desktop_task');assert.equal(approved.payload.dispatch_request.request_id,approved.payload.worker_request_id);
});

test('employee cannot bypass the chosen pending approval with another computer step',async()=>{
  const {state,response,body}=await invoke('agent-runner',{tools:[{tool_name:'computer_use',enabled:true,policy:'approval'}],freshToolPolicy:'approval',
    devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,plan:'enterprise',env:nativeEnv,
    chatReplies:[nativeReplies()[0],'{"action":"computer","input":"list /home/firbo"}',JSON.stringify({summary:'Waiting',report:'Owner approval needed.',actions:[]})]});
  assert.equal(response.status,200);assert.equal(body.status,'awaiting_approval');assert.equal(state.computerJobs.length,0);
  assert.equal(state.workerSelections.length,1);assert.equal(state.writes.find(w=>w.table==='approvals').payload.length,1);
});

test('employee worker selection failures and changed authorization never fall back or enqueue',async()=>{
  for(const changed of [{workerSelectionFailure:true},{taskChangedAfterSelection:true},{deviceChangedAfterSelection:true},
    {freshDevicePolicy:{enabled:false,control:'full'}},{planStatus:'cancelled'},{role:'manager'}]){
    const {state,response}=await invoke('agent-runner',{...changed,tools:computerTools,devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,
      plan:'enterprise',env:nativeEnv,chatReplies:nativeReplies()});
    assert.equal(response.status,200);assert.equal(state.computerJobs.length,0);
    assert.ok((state.workerSelections?.length??0)<=1);assert.ok(!state.writes.some(w=>w.table==='connector_jobs'));
  }
});

test('employee explicit target remains in the VPS request and unavailable target queues nothing',async()=>{
  const {state,response}=await invoke('agent-runner',{tools:computerTools,devices:nativeDevices(),workerSelectionFailure:true,
    plan:'enterprise',env:nativeEnv,chatReplies:[JSON.stringify({action:'computer',input:JSON.stringify({kind:'desktop_task',goal:'Open Chrome',target:'mac'})}),
      JSON.stringify({summary:'Blocked',report:'Requested Mac unavailable.',actions:[]})]});
  assert.equal(response.status,200);assert.equal(state.workerSelections[0].target,'mac');assert.equal(state.computerJobs.length,0);
});

test('employee native enqueue uncertainty keeps the claim and never dispatches another effect',async()=>{
  const repeat='{"action":"computer","input":"desktop Άνοιξε YouTube και επιβεβαίωσε ότι προχωρά ο χρόνος."}';
  const {state,response,body}=await invoke('agent-runner',{tools:computerTools,devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,
    plan:'enterprise',env:nativeEnv,computerInsertResponseLost:true,computerJobStatus:'running',chatReplies:[repeat,repeat,
      JSON.stringify({summary:'Pending',report:'Needs receipt review.',actions:[]})]});
  assert.equal(response.status,503);assert.equal(body.error,'computer_dispatch_unknown');assert.equal(body.retry_safe,false);
  assert.equal(state.workerSelections.length,1);assert.equal(state.computerJobs.length,1);
  assert.equal(state.computerResult.reconcile_required,true);assert.equal(state.computerResult.computer_execution.status,'unknown');
  assert.ok(!state.rpcs.some(r=>r.fn==='publish_task_run'));
});

test('employee saves the correlated intent before the job and refuses dispatch if receipt storage fails',async()=>{
  const {state,response,body}=await invoke('agent-runner',{tools:computerTools,devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,
    plan:'enterprise',env:nativeEnv,computerReceiptSaveError:true,chatReplies:nativeReplies()});
  assert.equal(response.status,503);assert.equal(body.retry_safe,false);assert.equal(state.computerJobs.length,0);
  assert.ok(!state.writes.some(w=>w.table==='connector_jobs'));
});

test('employee native fast terminal receipt can complete only after final inference and readiness marker',async()=>{
  const {state,response,body}=await invoke('agent-runner',{tools:computerTools,devices:nativeDevices(),selectedWorker:NATIVE_DEBIAN,
    plan:'enterprise',env:nativeEnv,computerTerminalReceipt:true,computerJobStatus:'done',
    computerJobResult:{completed:true,summary:'Observed playback clock advancing.',verification:'model_screen_observation'},chatReplies:nativeReplies()});
  assert.equal(response.status,200);assert.equal(body.status,'completed');assert.equal(body.pending,false);
  assert.equal(body.computer_execution.verified_success,true);
  const receiptWrites=state.writes.filter(w=>w.table==='tasks'&&w.op==='update'&&w.payload.result?.computer_execution);
  assert.equal(receiptWrites[0].payload.result.computer_execution.ready_to_finalize,false);
  assert.equal(receiptWrites.at(-1).payload.result.computer_execution.ready_to_finalize,true);
  assert.equal(state.computerJobs.length,1);
});

test('employee pending native readback performs no new model call, claim or worker dispatch',async()=>{
  const jobId='16161616-1616-4616-8616-161616161616';
  const params={goal:'Open Chrome'};
  const receipt={job_id:jobId,request_id:jobId,device_id:NATIVE_DEBIAN,device_name:'Synthetic Debian',kind:'desktop_task',params,run_claim:CLAIM,status:'queued'};
  const result={computer_execution:{contract:'firbo-worker-execution/v1',status:'pending',jobs:[receipt],ready_to_finalize:true,verified_success:false}};
  const existingComputerJobs=[{id:jobId,organization_id:ORG,device_id:NATIVE_DEBIAN,kind:'desktop_task',params,origin:'agent',agent_task_id:TASK,agent_id:AGENT,agent_run_claim:CLAIM}];
  const {state,response,body}=await invoke('agent-runner',{taskStatus:'running',result,existingComputerJobs,computerJobStatus:'running'});
  assert.equal(response.status,202);assert.equal(body.pending,true);assert.equal(state.calls.length,0);
  assert.equal(state.writes.length,0);assert.ok(!state.rpcs?.length);
});
test('blocked tool proposals are dropped',async()=>{const {state,body}=await invoke('agent-runner',{tools:[{tool_name:'send_email',enabled:false,policy:'block'}]});assert.equal(body.dropped,1);assert.ok(!state.writes.some(w=>w.table==='approvals'));});
test('lost task claim stops duplicate execution',async()=>{const {state,response}=await invoke('agent-runner',{claimLost:true});assert.equal(response.status,409);assert.equal(state.calls.length,0);});
test('active previous computer execution prevents a new model request',async()=>{const {state,response,body}=await invoke('agent-runner',{taskStatus:'failed',activeExecution:true});assert.equal(response.status,409);assert.equal(body.error,'task_active_jobs');assert.equal(state.calls.length,0);});
test('unavailable or malformed claim fails before inference',async()=>{for(const options of [{claimUnavailable:true},{malformedClaim:true}]){const {state,response}=await invoke('agent-runner',options);assert.equal(response.status,503);assert.equal(state.calls.length,0);}});
test('report and approvals use one organization-scoped claim publication',async()=>{
  const {state,response}=await invoke('agent-runner');assert.equal(response.status,200);
  const claim=state.rpcs.find(r=>r.fn==='claim_task_run');assert.deepEqual(claim.args,{p_org:ORG,p_task:TASK,p_actor:USER});
  const publications=state.rpcs.filter(r=>r.fn==='publish_task_run');assert.equal(publications.length,1);
  assert.equal(publications[0].args.p_claim,CLAIM);assert.equal(publications[0].args.p_result.report,FULL_REPORT);assert.equal(publications[0].args.p_approvals.length,1);
  assert.ok(!state.writes.some(w=>w.op==='insert'&&w.table==='approvals'));
});
test('lost committed publication response cannot overwrite an existing result with fallback',async()=>{
  const {state,response,body}=await invoke('agent-runner',{publishResponseLost:true});assert.equal(response.status,503);assert.equal(body.retry_safe,false);
  const results=state.writes.filter(w=>w.table==='tasks'&&w.payload.result);assert.equal(results.length,1);assert.equal(results[0].payload.status,'awaiting_approval');
});
test('late or recovered claim publishes neither a success nor new approvals',async()=>{
  const {state,response}=await invoke('agent-runner',{publishConflict:true});assert.equal(response.status,503);
  assert.ok(!state.writes.some(w=>w.table==='tasks'||w.table==='approvals'));
});
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
  assert.equal(response.status,handler==='agent-runner'?503:502);assert.equal(state.calls.length,1);
 });
 test(handler+' nonzero free report is refused',async()=>{
  const {state,response}=await invoke(handler,{env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:ORG},badFreeCost:true});
  assert.equal(response.status,handler==='agent-runner'?503:502);assert.equal(state.calls.length,1);assert.equal(state.writes.filter(x=>x.table==='usage_events').length,0);
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
    assert.match(source,/Deno\.env\.get\('FIRBO_ALLOW_LOCAL_CHAT'\) === 'on'[\s\S]{0,180}&& freeForOrganization\(/,name);
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
  // plan, synthesize, each meeting turn and the meeting minutes: every model call goes through the same accounted route.
  assert.equal((source.match(/await askAccounted\(/g)||[]).length,4);
  assert.equal((source.match(/fetch\(/g)||[]).length,1);
});

function missionExecution(status='completed',jobStatus='done',extra={}){
  const job={job_id:CHAT_REQUEST,request_id:CHAT_REQUEST,device_id:CONVO,kind:'desktop_task',status:jobStatus,
    result:{completed:jobStatus==='done'},
    receipt:{contract:'firbo-execution-receipt/v1',job_id:CHAT_REQUEST,device_id:CONVO,kind:'desktop_task',report_sha256:'a'.repeat(64),ok:jobStatus==='done'}};
  return{contract:'firbo-worker-execution/v1',status,verified_success:status==='completed',jobs:[job],...extra};
}
function missionStep(status='completed',result={report:'Observed employee work.'}){
  return{id:CHAT_REQUEST,organization_id:ORG,parent_task_id:TASK,title:'Employee work',status,assigned_agent_id:AGENT,result};
}
const unresolvedMissionSteps=[
  ['pending step',missionStep('pending')],
  ['running step',missionStep('running')],
  ['approval still pending',missionStep('awaiting_approval')],
  ['unknown step status',missionStep('unknown')],
  ['completed row with pending computer work',missionStep('completed',{computer_execution:missionExecution('pending','queued')})],
  ['failed row with unknown computer dispatch',missionStep('failed',{computer_execution:missionExecution('unknown','unknown')})],
  ['terminal marker with queued receipt',missionStep('completed',{computer_execution:missionExecution('completed','queued')})],
  ['completed computer marker without verified success',missionStep('completed',{computer_execution:missionExecution('completed','done',{verified_success:false})})],
  ['computer marker with unknown contract',missionStep('completed',{computer_execution:missionExecution('completed','done',{contract:'untrusted/v1'})})],
  ['completed computer job with no receipt',missionStep('completed',{computer_execution:missionExecution('completed','done',{jobs:[{job_id:CHAT_REQUEST,device_id:CONVO,kind:'desktop_task',status:'done'}]})})],
  ['computer receipt belongs to another job',missionStep('completed',{computer_execution:missionExecution('completed','done',{jobs:[{...missionExecution().jobs[0],receipt:{...missionExecution().jobs[0].receipt,job_id:TASK}}]})})],
  ['native receipt without observed completion',missionStep('completed',{computer_execution:missionExecution('completed','done',{jobs:[{...missionExecution().jobs[0],result:{completed:false}}]})})],
  ['native receipt with blocked result',missionStep('completed',{computer_execution:missionExecution('completed','done',{jobs:[{...missionExecution().jobs[0],result:{completed:true,blocked:true}}]})})],
  ['browser receipt without observed completion',missionStep('completed',{computer_execution:missionExecution('completed','done',{jobs:[{...missionExecution().jobs[0],kind:'browser_task',receipt:{...missionExecution().jobs[0].receipt,kind:'browser_task'},result:{completed:false}}]})})],
  ['step reconciliation required',missionStep('failed',{reconcile_required:true,error:'usage_save_failed'})],
  ['step accounting still needs reconciliation',missionStep('completed',{accounting:{status:'reconcile_required'}})],
];
for(const [label,step] of unresolvedMissionSteps){
  test(`mission synthesis: ${label} stops before provider, reservation and completion`,async()=>{
    const {state,response,body}=await invoke('mission-runner',{missionSteps:[step]});
    assert.equal(response.status,409);assert.ok(['not_runnable','reconciliation_required'].includes(body.error));
    assert.equal(state.calls.length,0);
    assert.ok(!state.rpcs?.some(r=>r.fn==='firbo_reserve_inference'));
    assert.ok(!state.writes.some(w=>w.table==='tasks'&&w.payload?.status==='completed'));
  });
}
test('mission synthesis: failed child read cannot spend or publish completion',async()=>{
  const {state,response,body}=await invoke('mission-runner',{missionSteps:[],missionStepsError:true});
  assert.equal(response.status,503);assert.equal(body.error,'steps_unavailable');
  assert.equal(state.calls.length,0);assert.ok(!state.rpcs?.some(r=>r.fn==='firbo_reserve_inference'));
  assert.ok(!state.writes.some(w=>w.table==='tasks'&&w.payload?.status==='completed'));
  assert.ok(!JSON.stringify(body).includes('private database'));
});
test('mission synthesis: thrown child read fails closed without inference or completion',async()=>{
  const {state,response,body}=await invoke('mission-runner',{missionStepsThrow:true});
  assert.equal(response.status,503);assert.equal(body.error,'steps_unavailable');assert.equal(state.calls.length,0);
  assert.ok(!state.rpcs?.some(r=>r.fn==='firbo_reserve_inference'));
  assert.ok(!state.writes.some(w=>w.table==='tasks'&&w.payload?.status==='completed'));
  assert.ok(!JSON.stringify(body).includes('private database'));
});
for(const [label,steps] of [['empty',[]],['null',null],['nonarray',{}]]){
  test(`mission synthesis: ${label} child result cannot claim team completion`,async()=>{
    const {state,response,body}=await invoke('mission-runner',{missionSteps:steps});
    assert.equal(response.status,409);assert.equal(body.error,'not_runnable');assert.equal(state.calls.length,0);
    assert.ok(!state.rpcs?.some(r=>r.fn==='firbo_reserve_inference'));
    assert.ok(!state.writes.some(w=>w.table==='tasks'&&w.payload?.status==='completed'));
  });
}
for(const [label,steps] of [
  ['completed research and terminal failed employee',[missionStep(),{...missionStep('failed',{error:'Research unavailable'}),id:ACCOUNTING}]],
  ['explicitly cancelled employee',[missionStep('cancelled',{error:'Owner cancelled this step'})]],
  ['completed computer work',[missionStep('completed',{report:'Chrome opened.',computer_execution:missionExecution()})]],
  ['confirmed terminal computer error',[missionStep('failed',{error:'App unavailable',computer_execution:missionExecution('failed','error')})]],
  ['terminal blocked native goal',[missionStep('blocked',{report:'Native work was blocked before goal completion.',computer_execution:missionExecution('blocked','done',{jobs:[{...missionExecution().jobs[0],result:{completed:false,blocked:true}}]})})]],
  ['terminal blocked browser goal',[missionStep('blocked',{report:'Browser work was blocked before goal completion.',computer_execution:missionExecution('blocked','done',{jobs:[{...missionExecution().jobs[0],kind:'browser_task',receipt:{...missionExecution().jobs[0].receipt,kind:'browser_task'},result:{completed:false,blocked:true}}]})})]],
  ['terminal computer failure without success receipt',[missionStep('failed',{error:'App unavailable',computer_execution:missionExecution('failed','error',{jobs:[{job_id:CHAT_REQUEST,device_id:CONVO,kind:'desktop_task',status:'error',receipt:null}]})})]],
  ['confirmed computer cancellation',[missionStep('failed',{error:'Owner stopped the job',computer_execution:missionExecution('failed','cancelled',{jobs:[{job_id:CHAT_REQUEST,device_id:CONVO,kind:'desktop_task',status:'cancelled',receipt:null}]})})]],
]){
  test(`mission synthesis: ${label} preserves current accounting and tenant scope`,async()=>{
    const {state,response,body}=await invoke('mission-runner',{missionSteps:steps});
    assert.equal(response.status,200);assert.equal(body.status,'completed');assert.equal(state.calls.length,1);
    assert.equal(String(state.calls[0].url),'https://api.openai.com/v1/chat/completions');
    if(steps.some(step=>step.status==='blocked')){
      const prompt=JSON.parse(state.calls[0].init.body).messages[1].content;
      assert.match(prompt,/Status: blocked/);assert.match(prompt,/was blocked before goal completion/);
    }
    const childRead=state.reads.find(r=>r.table==='tasks'&&r.filters.some(([k,v])=>k==='parent_task_id'&&v===TASK));
    assert.ok(childRead.filters.some(([k,v])=>k==='organization_id'&&v===ORG),'child read must be bound to verified organization');
    const reserve=state.rpcs.find(r=>r.fn==='firbo_reserve_inference'),settle=state.rpcs.find(r=>r.fn==='firbo_settle_inference');
    assert.equal(reserve.args.p_org,ORG);assert.equal(reserve.args.p_user,USER);assert.equal(reserve.args.p_agent,AGENT);
    assert.equal(reserve.args.p_source,'mission-runner');assert.equal(settle.args.p_request,ACCOUNTING);
    assert.equal(settle.args.p_model,'openai:test-model');assert.equal(settle.args.p_input_tokens,100);assert.equal(settle.args.p_output_tokens,20);
    assert.equal(settle.args.p_cost_usd,0.0006);assert.ok(reserve.args.p_reserved_usd>settle.args.p_cost_usd);
    assert.deepEqual(body.accounting,{requests:[{request_id:ACCOUNTING,agent_id:AGENT,status:'settled'}],status:'settled'});
    const completed=state.writes.find(w=>w.table==='tasks'&&w.payload?.status==='completed');
    assert.equal(completed.payload.result.steps,steps.length);assert.equal(completed.payload.result.reconcile_required,false);
    assert.deepEqual(completed.payload.result.accounting,body.accounting);
  });
}

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
    assert.equal(response.status,name==='agent-runner'?503:502);
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

test('agent-runner: the agent searches, reads a page, then reports; every model attempt has one receipt', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'allow'},{tool_name:'browser_extract',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"web_search","input":"sports market 2026"}','{"action":"read_page","input":"https://news.example/a"}',JSON.stringify({summary:'Market up 5%',report:FULL_REPORT+'\n## Sources\n- https://news.example/a',actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies});
  assert.equal(response.status,200);
  const chats=state.calls.filter(c=>String(c.url).endsWith('/chat/completions'));
  assert.equal(chats.length,3);
  const lastBody=JSON.parse(chats[2].init.body);
  assert.ok(lastBody.messages.some(m=>/Full article text/.test(m.content)));
  const usage=state.writes.filter(w=>w.table==='usage_events');
  assert.equal(usage.length,5);
  const searches=usage.filter(row=>row.payload.model==='omniroute:search/duckduckgo-free');
  assert.equal(searches.length,2);assert.ok(searches.every(row=>row.payload.cost_usd===0));
  const inference=usage.filter(row=>row.payload.input_tokens===100&&row.payload.output_tokens===20);
  assert.equal(inference.length,3);assert.ok(inference.every(row=>row.op==='rpc'));
  assert.ok(Math.abs(
    usage.reduce((sum,row)=>sum+row.payload.cost_usd,0)
      - 3*Math.round((100*1+20*2))/1e6,
  ) < 1e-12);
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.summary,'Market up 5%');
  assert.equal(result.accounting.attempts.length,5);
  assert.deepEqual(result.steps.map(s=>s.action),['web_search','read_page']);
  assert.ok(result.powers_used.includes('web_search')&&result.powers_used.includes('browser_extract'));
});
test('agent-runner: vision uses its own claim-bound receipt and exact dispatch identity', async () => {
  const tools=[{tool_name:'image_analyze',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"analyze_image","input":"https://images.example/blue.png what color?"}',JSON.stringify({summary:'Image checked',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies,visionResponse:true,env:{FIRBO_VISION_MODEL:'firbo-vision'}});
  assert.equal(response.status,200);
  const visionCall=state.calls.find(c=>{
    if(!String(c.url).endsWith('/chat/completions'))return false;
    return Array.isArray(JSON.parse(c.init.body)?.messages?.[0]?.content);
  });
  assert.ok(visionCall);
  const reserves=state.rpcs.filter(r=>r.fn==='firbo_reserve_runner_inference');
  const visionReserve=reserves.find(r=>r.args.p_route==='omniroute:firbo-vision/vision');
  assert.ok(visionReserve);assert.equal(visionReserve.args.p_output_token_cap,700);assert.ok(visionReserve.args.p_reserved_usd>0);
  assert.equal(visionCall.init.headers['x-request-id'],state.runnerRequests[1]);
  const usage=state.writes.filter(w=>w.table==='usage_events');
  assert.equal(usage.length,3);assert.equal(usage[1].payload.model,'omniroute:firbo-vision/vision');
  assert.equal(usage[1].payload.input_tokens,250);assert.equal(usage[1].payload.output_tokens,15);
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.accounting.attempts.length,3);
});
test('agent-runner: missing vision usage is ambiguous and cannot publish or continue', async () => {
  const tools=[{tool_name:'image_analyze',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"analyze_image","input":"https://images.example/blue.png what color?"}',JSON.stringify({summary:'Must not publish',report:FULL_REPORT,actions:[]})];
  const {state,response,body}=await invoke('agent-runner',{tools,chatReplies,visionResponse:true,visionMissingUsage:true,env:{FIRBO_VISION_MODEL:'firbo-vision'}});
  assert.equal(response.status,503);assert.equal(body.error,'reconciliation_required');assert.equal(body.retry_safe,false);
  assert.ok(state.rpcs.some(r=>r.fn==='firbo_mark_inference_ambiguous'&&r.args.p_reason==='vision_usage_missing'));
  assert.equal(state.rpcs.filter(r=>r.fn==='firbo_settle_inference').length,1);
  assert.ok(!state.rpcs.some(r=>r.fn==='publish_task_run'));
});
test('agent-runner: paid image generation has its own exact claim-bound receipt', async () => {
  const tools=[{tool_name:'image_generate',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"generate_image","input":"a blue launch poster"}',JSON.stringify({summary:'Poster created',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies,imageResponse:true,env:{
    FIRBO_IMAGE_MODEL:'firbo-image',FIRBO_IMAGE_COST_USD:'0.04',FIRBO_IMAGE_MAX_COST_USD:'0.06',
  }});
  assert.equal(response.status,200);
  const imageCall=state.calls.find(c=>String(c.url).endsWith('/images/generations'));
  assert.ok(imageCall);
  assert.deepEqual(JSON.parse(imageCall.init.body),{
    model:'firbo-image',prompt:'a blue launch poster',n:1,size:'1024x1024',response_format:'b64_json',
  });
  const reserve=state.rpcs.find(r=>r.fn==='firbo_reserve_runner_inference'&&r.args.p_route==='omniroute:firbo-image/image');
  assert.ok(reserve);assert.equal(reserve.args.p_output_token_cap,1);assert.equal(reserve.args.p_reserved_usd,0.06);
  assert.equal(imageCall.init.headers['x-request-id'],state.runnerRequests[1]);
  const usage=state.writes.filter(w=>w.table==='usage_events');
  assert.equal(usage.length,3);assert.equal(usage[1].payload.model,'omniroute:firbo-image/image');assert.equal(usage[1].payload.cost_usd,0.04);
  assert.equal(state.stored.length,1);assert.match(state.stored[0].path,new RegExp(`^${ORG}/[0-9a-f-]+\\.png$`));
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.accounting.attempts.length,3);assert.equal(result.cost_usd,0.04028);
});
test('agent-runner: failed paid image dispatch is ambiguous and never falls back', async () => {
  const tools=[{tool_name:'image_generate',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"generate_image","input":"a blue launch poster"}',JSON.stringify({summary:'Must not publish',report:FULL_REPORT,actions:[]})];
  const {state,response,body}=await invoke('agent-runner',{tools,chatReplies,imageResponse:true,imageGatewayFailure:true,env:{
    FIRBO_IMAGE_MODEL:'firbo-image',FIRBO_IMAGE_COST_USD:'0.04',FIRBO_IMAGE_MAX_COST_USD:'0.06',
  }});
  assert.equal(response.status,503);assert.equal(body.error,'reconciliation_required');assert.equal(body.retry_safe,false);
  assert.ok(state.rpcs.some(r=>r.fn==='firbo_mark_inference_ambiguous'&&r.args.p_reason==='image_gateway_http_502'));
  assert.equal(state.calls.filter(c=>String(c.url).endsWith('/images/generations')).length,1);
  assert.ok(!state.calls.some(c=>String(c.url).includes('pollinations.ai')));
  assert.equal(state.rpcs.filter(r=>r.fn==='firbo_settle_inference').length,1);
  assert.ok(!state.rpcs.some(r=>r.fn==='publish_task_run'));
});
test('agent-runner: free image generation still gets a zero-cost attempt receipt', async () => {
  const tools=[{tool_name:'image_generate',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"generate_image","input":"a green match poster"}',JSON.stringify({summary:'Poster created',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies,pollinationsResponse:true});
  assert.equal(response.status,200);
  const call=state.calls.find(c=>String(c.url).startsWith('https://image.pollinations.ai/'));
  assert.ok(call);assert.match(String(call.url),/seed=\d+$/);
  const reserve=state.rpcs.find(r=>r.fn==='firbo_reserve_runner_inference'&&r.args.p_route==='pollinations:free/image');
  assert.ok(reserve);assert.equal(reserve.args.p_reserved_usd,0);
  const usage=state.writes.find(w=>w.table==='usage_events'&&w.payload.model==='pollinations:free/image');
  assert.equal(usage.payload.cost_usd,0);assert.equal(usage.payload.input_tokens,0);assert.equal(usage.payload.output_tokens,0);
  assert.equal(state.stored.length,1);assert.match(state.stored[0].path,/\.jpg$/);
});
test('agent-runner: empty gateway search uses configured Tavily and feeds evidence to the model', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"web_search","input":"sports market"}',JSON.stringify({summary:'Evidence retained',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies,emptyGatewaySearch:true,env:{TAVILY_API_KEY:'synthetic-tavily-key'}});
  assert.equal(response.status,200);
  const calls=state.calls.filter(c=>c.url==='https://api.tavily.com/search');
  // The existing runner gathers task research before the model's explicit search step.
  assert.equal(calls.length,2);
  assert.match(JSON.parse(calls[0].init.body).query,/Review test task/);
  assert.equal(JSON.parse(calls[1].init.body).query,'sports market');
  assert.ok(calls.every(c=>c.init.headers.authorization==='Bearer synthetic-tavily-key'));
  assert.ok(calls.every(c=>JSON.parse(c.init.body).include_usage===true));
  const tavilyReserves=state.rpcs.filter(r=>r.fn==='firbo_reserve_runner_inference'&&r.args.p_route==='tavily:basic/search');
  assert.equal(tavilyReserves.length,2);assert.ok(tavilyReserves.every(r=>r.args.p_reserved_usd===0.016));
  const tavilyUsage=state.writes.filter(w=>w.table==='usage_events'&&w.payload.model==='tavily:basic/search');
  assert.equal(tavilyUsage.length,2);assert.ok(tavilyUsage.every(w=>w.payload.cost_usd===0.008));
  const chats=state.calls.filter(c=>String(c.url).endsWith('/chat/completions'));
  assert.ok(JSON.parse(chats.at(-1).init.body).messages.some(m=>m.content.includes('Sports market grows')));
  assert.ok(!JSON.stringify(state.writes).includes('synthetic-tavily-key'));
});
test('agent-runner: configured gateway search gets one paid receipt per dispatch', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'allow'}];
  const chatReplies=['{"action":"web_search","input":"sports market"}',JSON.stringify({summary:'Evidence retained',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies,env:{
    FIRBO_GATEWAY_SEARCH_COST_USD:'0.003',FIRBO_GATEWAY_SEARCH_MAX_COST_USD:'0.005',
  }});
  assert.equal(response.status,200);
  const calls=state.calls.filter(c=>String(c.url).includes('gateway.firboai.app')&&String(c.url).endsWith('/search'));
  assert.equal(calls.length,2);assert.ok(calls.every(c=>c.init.headers['x-request-id']));
  const reserves=state.rpcs.filter(r=>r.fn==='firbo_reserve_runner_inference'&&r.args.p_route==='omniroute:search/auto');
  assert.equal(reserves.length,2);assert.ok(reserves.every(r=>r.args.p_reserved_usd===0.005));
  const usage=state.writes.filter(w=>w.table==='usage_events'&&w.payload.model==='omniroute:search/auto');
  assert.equal(usage.length,2);assert.ok(usage.every(w=>w.payload.cost_usd===0.003));
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.cost_usd,0.00628);assert.equal(result.accounting.attempts.length,4);
});
test('agent-runner: ambiguous paid gateway search cannot fall back or publish', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'allow'}];
  const {state,response,body}=await invoke('agent-runner',{tools,gatewaySearchFailure:true,env:{
    FIRBO_GATEWAY_SEARCH_COST_USD:'0.003',FIRBO_GATEWAY_SEARCH_MAX_COST_USD:'0.005',TAVILY_API_KEY:'synthetic-tavily-key',
  }});
  assert.equal(response.status,503);assert.equal(body.error,'reconciliation_required');assert.equal(body.retry_safe,false);
  assert.ok(state.rpcs.some(r=>r.fn==='firbo_mark_inference_ambiguous'&&r.args.p_reason==='web_gateway_http_502'));
  assert.equal(state.calls.filter(c=>String(c.url).endsWith('/search')).length,1);
  assert.ok(!state.calls.some(c=>String(c.url)==='https://api.tavily.com/search'));
  assert.ok(!state.rpcs.some(r=>r.fn==='publish_task_run'));
});
test('agent-runner: missing Tavily usage is ambiguous and cannot publish', async () => {
  const tools=[{tool_name:'web_search',enabled:true,policy:'allow'}];
  const {state,response,body}=await invoke('agent-runner',{tools,emptyGatewaySearch:true,tavilyMissingUsage:true,env:{TAVILY_API_KEY:'synthetic-tavily-key'}});
  assert.equal(response.status,503);assert.equal(body.error,'reconciliation_required');assert.equal(body.retry_safe,false);
  assert.ok(state.rpcs.some(r=>r.fn==='firbo_mark_inference_ambiguous'&&r.args.p_reason==='tavily_usage_missing'));
  assert.ok(!state.calls.some(c=>String(c.url).endsWith('/chat/completions')));
  assert.ok(!state.rpcs.some(r=>r.fn==='publish_task_run'));
});
test('agent-runner: a gateway reply that is only the model thinking aloud is asked again', async () => {
  const chatReplies=["Okay, let's see. The user wants a report about the market. I need to",JSON.stringify({summary:'Market up 5%',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools:[],chatReplies});
  assert.equal(response.status,200);
  assert.equal(state.calls.filter(c=>String(c.url).endsWith('/chat/completions')).length,2);
  assert.equal(state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result.summary,'Market up 5%');
});
test('agent-runner: a draft below the professional standard gets exactly one quality pass on the same route', async () => {
  const {state,response}=await invoke('agent-runner',{shortReport:true,noActions:true});
  assert.equal(response.status,200);
  const chats=state.calls.filter(c=>String(c.url).endsWith('/chat/completions'));
  assert.equal(chats.length,2);
  assert.ok(chats.every(c=>String(c.url).startsWith('https://gateway.firboai.app/v1/')));
  const polish=JSON.parse(chats[1].init.body).messages;
  assert.match(polish[0].content,/senior editor/);assert.match(polish[0].content,/never add new facts/);
  assert.match(polish[1].content,/DRAFT:/);
  const first=JSON.parse(chats[0].init.body).messages[0].content;
  assert.match(first,/DELIVERABLE: a professional report/);
  const usage=state.writes.filter(w=>w.table==='usage_events');
  assert.equal(usage.length,2);assert.ok(usage.every(row=>row.payload.input_tokens===100));
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.format,'report');assert.equal(result.calls,2);
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
test('agent-runner: explicit slide counts are enforced in the actual generation prompt', async () => {
  const {state,response}=await invoke('agent-runner',{plan:'pro',taskTitle:'Presentation for the board: Q3 sales — 10 slides'});
  assert.equal(response.status,200);
  const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
  assert.match(chat.messages[0].content,/exactly 10 slides/);
});

test('owner personal instructions reach both task work and direct chat', async () => {
  for (const name of ['agent-runner','agent-chat']) {
    const {state,response}=await invoke(name,{ownerInstructions:'Start with the decision. Use comparison tables. Never repeat the same point.'});
    assert.equal(response.status,200);
    const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
    assert.match(chat.messages[0].content,/OWNER INSTRUCTIONS FOR YOUR WORKING STYLE/);
    assert.match(chat.messages[0].content,/Start with the decision/);
  }
});

test('agent-runner: a presentation starts on the quality route (paid plans), with the slide standard', async () => {
  const {state,response}=await invoke('agent-runner',{plan:'pro',taskTitle:'Presentation for the board: Q3 sales'});
  assert.equal(response.status,200);
  const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
  assert.equal(chat.model,'firbo-quality');
  assert.match(chat.messages[0].content,/DELIVERABLE: a presentation/);
  assert.doesNotMatch(chat.messages[0].content,/You can use tools before you answer/);
  const result=state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result;
  assert.equal(result.routed_up,'deliverable');
  assert.equal(result.format,'presentation');
  const free=await invoke('agent-runner',{plan:'free',taskTitle:'Presentation for the board: Q3 sales'});
  assert.notEqual(JSON.parse(free.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).model,'firbo-quality');
});
test('agent-runner: a presentation with no web material researches with its tools instead of writing from nothing', async () => {
  const tools=[{tool_name:'calculator',enabled:true,policy:'allow'}];
  const {state,response}=await invoke('agent-runner',{plan:'pro',taskTitle:'Presentation for the board: Q3 sales',tools});
  assert.equal(response.status,200);
  const chat=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body);
  assert.match(chat.messages[0].content,/You can use tools before you answer/);
  assert.doesNotMatch(chat.messages[0].content,/WEB MATERIAL/);
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
const serverEnv={FIRBO_SERVER_EXECUTION_ENABLED:'on',OPENJARVIS_URL:'https://admin-jarvis.example/jarvis',OPENJARVIS_API_KEY:'admin-key',OPENJARVIS_SANDBOX_URL:'https://box-jarvis.example/jarvis-box',OPENJARVIS_SANDBOX_API_KEY:'box-key',FIRBO_SERVER_AGENT_PLANS:'pro,business,enterprise',FIRBO_SERVER_PRICE_IN_PER_M:'2',FIRBO_SERVER_PRICE_OUT_PER_M:'4',FIRBO_SERVER_MAX_OUTPUT_TOKENS:'8192'};
const serverReplies=()=>['{"action":"server_task","input":"print(sum(range(10)))"}',JSON.stringify({summary:'45',report:'45',actions:[]})];
test('suggest-only employees cannot execute through either OpenJarvis server', async () => {
  for (const extra of [{ autonomy: 'suggest' }, { freshAutonomy: 'suggest' }, { freshAgentEnabled: false }]) {
    const {state,response}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
      chatReplies:serverReplies(),plan:'pro',env:serverEnv,...extra});
    assert.equal(response.status,200);
    assert.ok(!state.calls.some(c=>/https:\/\/(box|admin)-jarvis\.example/.test(String(c.url))));
  }
});
test('agent-runner: a customer company gets only the sandboxed server agent, never the admin one', async () => {
  const tools=[{tool_name:'code_interpreter',enabled:true,policy:'allow'}];
  const {state,response}=await invoke('agent-runner',{tools,chatReplies:serverReplies(),plan:'pro',env:serverEnv});
  assert.equal(response.status,200);
  const urls=state.calls.map(c=>String(c.url));
  assert.ok(urls.some(u=>u.startsWith('https://box-jarvis.example/jarvis-box/v1/chat/completions')));
  assert.ok(!urls.some(u=>u.startsWith('https://admin-jarvis.example')&&!u.endsWith('/v1/firbo/dispatch')));
  assert.equal(state.workerSelections.length,1);assert.equal(state.workerSelections[0].kind,'server_task');
  const box=state.calls.find(c=>String(c.url).startsWith('https://box-jarvis.example/jarvis-box/v1/chat'));
  assert.equal(box.init.headers.authorization,'Bearer box-key');
  assert.equal(JSON.parse(box.init.body).max_tokens,8192);
  const usage=state.writes.find(w=>w.table==='usage_events'&&w.payload.model==='openjarvis:firbo-quality');
  assert.ok(usage);assert.equal(usage.payload.input_tokens,30);assert.equal(usage.payload.output_tokens,5);assert.equal(usage.payload.cost_usd,0.00008);
  assert.equal(box.init.headers['x-firbo-request-id'],usage.payload.inference_request_id);
  const reservation=state.rpcs.find(r=>r.fn==='firbo_reserve_runner_inference'&&r.args.p_route==='openjarvis:sandbox');
  assert.ok(reservation);assert.ok(reservation.args.p_reserved_usd>=usage.payload.cost_usd);
  assert.match(JSON.parse(state.calls.find(c=>String(c.url).includes('gateway')).init.body).messages[0].content,/locked sandbox/);
});
test('agent-runner: missing server usage is ambiguous and blocks publication or another provider call', async () => {
  const {state,response,body}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
    chatReplies:serverReplies(),plan:'pro',env:serverEnv,serverMissingUsage:true});
  assert.equal(response.status,503);assert.equal(body.error,'reconciliation_required');assert.equal(body.retry_safe,false);
  assert.equal(state.calls.filter(c=>String(c.url).startsWith('https://box-jarvis.example')&&String(c.url).endsWith('/chat/completions')).length,1);
  assert.ok(state.rpcs.some(r=>r.fn==='firbo_mark_inference_ambiguous'));
  assert.ok(state.writes.filter(w=>w.table==='tasks').every(w=>Object.keys(w.payload).length===1&&w.payload.result?.reconcile_required===true));
});
test('agent-runner: denied server reservation makes no server inference request', async () => {
  const {state,response,body}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
    chatReplies:serverReplies(),plan:'pro',env:serverEnv,denyServerReservation:true});
  assert.equal(response.status,402);assert.equal(body.error,'budget_exceeded');
  assert.equal(state.calls.filter(c=>String(c.url).startsWith('https://box-jarvis.example')&&String(c.url).endsWith('/chat/completions')).length,0);
  assert.ok(!state.rpcs.some(r=>r.fn==='firbo_mark_inference_ambiguous'));
});
test('agent-runner: server execution is not offered without explicit pricing bounds', async () => {
  const env={...serverEnv};delete env.FIRBO_SERVER_PRICE_IN_PER_M;
  const {state,response}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
    chatReplies:serverReplies(),plan:'pro',env});
  assert.equal(response.status,200);assert.ok(!state.calls.some(c=>/jarvis/.test(String(c.url))));
});
test('runner recovery cannot enable configured VPS execution without release acceptance', async () => {
  for (const enabled of [undefined, '', 'off', 'true', 'ON']) {
    const {state,response}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
      chatReplies:serverReplies(),plan:'pro',env:{...serverEnv,FIRBO_SERVER_EXECUTION_ENABLED:enabled}});
    assert.equal(response.status,200);
    assert.ok(!state.calls.some(c=>/jarvis/.test(String(c.url))));
    assert.ok(!state.rpcs.some(r=>r.fn==='firbo_reserve_runner_inference'&&String(r.args.p_route).startsWith('openjarvis:')));
    const first=state.calls.find(c=>String(c.url).endsWith('/chat/completions'));
    assert.doesNotMatch(JSON.parse(first.init.body).messages[0].content,/\"action\": \"server_task\"/);
  }
});
test('enabled VPS execution rejects zero or invalid billed pricing before any server call', async () => {
  for (const changed of [
    {FIRBO_SERVER_PRICE_IN_PER_M:'0'}, {FIRBO_SERVER_PRICE_OUT_PER_M:'0'},
    {FIRBO_SERVER_PRICE_IN_PER_M:'-1'}, {FIRBO_SERVER_PRICE_OUT_PER_M:'NaN'},
    {FIRBO_SERVER_MAX_OUTPUT_TOKENS:'0'},
  ]) {
    const {state,response}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
      chatReplies:serverReplies(),plan:'pro',env:{...serverEnv,...changed}});
    assert.equal(response.status,200);
    assert.ok(!state.calls.some(c=>/jarvis/.test(String(c.url))));
  }
});
test('agent-runner feeds actual server tool failures back to the employee', async () => {
  const execution={contract:'openjarvis-execution/v1',mode:'agent',tool_count:1,failed_count:1,
    tools:[{name:'code_interpreter',success:false,output:'Sandbox execution failed',truncated:false}],truncated:false};
  const {state,response}=await invoke('agent-runner',{tools:[{tool_name:'code_interpreter',enabled:true,policy:'allow'}],
    chatReplies:serverReplies(),plan:'pro',env:serverEnv,serverExecution:execution});
  assert.equal(response.status,200);
  const server=state.calls.find(c=>String(c.url).startsWith('https://box-jarvis.example/jarvis-box/v1/chat'));
  assert.equal(JSON.parse(server.init.body).firbo_include_execution,true);
  const final=state.calls.filter(c=>String(c.url).includes('gateway')&&String(c.url).endsWith('/chat/completions')).at(-1);
  assert.match(JSON.stringify(JSON.parse(final.init.body).messages),/Sandbox execution failed/);
  assert.match(JSON.stringify(JSON.parse(final.init.body).messages),/1 failed/);
});
test('agent-runner: the platform admin company uses the full server agent; a plan without the power gets none', async () => {
  const tools=[{tool_name:'code_interpreter',enabled:true,policy:'allow'}];
  const own=await invoke('agent-runner',{tools,chatReplies:serverReplies(),plan:'free',adminMember:true,platform_admins:[{user_id:USER}],env:serverEnv});
  assert.equal(own.response.status,200);
  assert.ok(own.state.calls.some(c=>String(c.url).startsWith('https://admin-jarvis.example/jarvis/v1/chat/completions')));
  const starter=await invoke('agent-runner',{tools,plan:'starter',env:serverEnv});
  assert.equal(starter.response.status,503,'unknown unpurchased plan is denied before inference');
  assert.equal(starter.state.calls.length,0,'no provider or VPS work for unrecognized plan');
  assert.equal(starter.state.writes.length,0,'unknown plan cannot publish a task');
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
test('agent-runner: an economy reply that is neither a tool call nor an answer moves the run up to the quality route (paid plans only)', async () => {
  const tools=[{tool_name:'weather',enabled:true,policy:'allow'}];
  const final=JSON.stringify({summary:'Sunny',report:'Sunny in Thessaloniki',actions:[]});
  const {state,response}=await invoke('agent-runner',{tools,plan:'pro',chatReplies:['Step 1: mcp_weather_weather Thessaloniki',final,final]});
  assert.equal(response.status,200);
  const chats=state.calls.filter(c=>String(c.url).endsWith('/chat/completions')).map(c=>JSON.parse(c.init.body).model);
  assert.deepEqual(chats.slice(0,2),['firbo-economy','firbo-quality']);
  assert.ok(!chats.slice(1).includes('firbo-economy'));
  assert.equal(state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result.routed_up,'invalid_reply');
  const free=await invoke('agent-runner',{tools,plan:'free',chatReplies:['Step 1: mcp_weather_weather Thessaloniki',final,final,final]});
  assert.ok(!free.state.calls.some(c=>String(c.url).endsWith('/chat/completions')&&JSON.parse(c.init.body).model==='firbo-quality'));
});
test('agent-runner: the quality route works even when the per-agent allowlist leaves it out', async () => {
  const env={FIRBO_GATEWAY_ALLOWED_MODELS:'firbo-economy'};
  const tools=[{tool_name:'weather',enabled:true,policy:'allow'}];
  const final=JSON.stringify({summary:'Sunny',report:'Sunny in Thessaloniki',actions:[]});
  const up=await invoke('agent-runner',{env,tools,plan:'pro',chatReplies:['{"action":"get_package_price","input":{}}',final,final]});
  assert.equal(up.response.status,200);
  assert.deepEqual(up.state.calls.filter(c=>String(c.url).endsWith('/chat/completions')).map(c=>JSON.parse(c.init.body).model).slice(0,2),['firbo-economy','firbo-quality']);
  const liked=await invoke('agent-runner',{env,feedback:[{rating:-1,note:null},{rating:-1,note:null}],plan:'pro'});
  assert.equal(liked.response.status,200);
  assert.equal(JSON.parse(liked.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).model,'firbo-quality');
});
test('agent-runner: the direct OmniRoute route (no gateway mode) also moves up to quality, on a bad reply and on two 👎', async () => {
  const env={FIRBO_TEXT_ROUTING_MODE:'legacy'};
  const tools=[{tool_name:'weather',enabled:true,policy:'allow'}];
  const final=JSON.stringify({summary:'Sunny',report:'Sunny in Thessaloniki',actions:[]});
  const up=await invoke('agent-runner',{env,model:'omniroute:firbo-economy',tools,plan:'pro',chatReplies:['{"action":"get_company_pricing","input":{}}',final,final]});
  assert.equal(up.response.status,200);
  assert.deepEqual(up.state.calls.filter(c=>String(c.url).endsWith('/chat/completions')).map(c=>JSON.parse(c.init.body).model).slice(0,2),['firbo-economy','firbo-quality']);
  assert.equal(up.state.writes.find(w=>w.table==='tasks'&&w.payload.result?.summary).payload.result.routed_up,'invalid_reply');
  const liked=await invoke('agent-runner',{env,model:'omniroute:firbo-economy',feedback:[{rating:-1,note:null},{rating:-1,note:null}],plan:'pro'});
  assert.equal(JSON.parse(liked.state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).model,'firbo-quality');
  const other=await invoke('agent-runner',{env,model:'openai:gpt-5-mini',tools,plan:'pro',chatReplies:['{"action":"get_company_pricing","input":{}}',final,final,final]});
  assert.ok(!other.state.calls.some(c=>String(c.url).endsWith('/chat/completions')&&JSON.parse(c.init.body).model==='firbo-quality'));
});

test('employees use native worker goals for app work, with shell reserved for explicit requests', async () => {
  const { readFile: read } = await import('node:fs/promises');
  const src = await read(new URL('../../supabase/functions/agent-runner/index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /run osascript -e/);
  assert.match(src, /Use native desktop goals for full app work/);
  assert.match(src, /a final actions proposal does not execute computer work/);
});

for (const [lane,options] of [
  ['model',{gatewayFailure:true}],
  ['search',{tools:[{tool_name:'web_search',enabled:true,policy:'allow'}],gatewaySearchFailure:true}],
]) {
  test(`agent-runner: ${lane} ambiguity exposes review state without clearing claim or liability`,async()=>{
    const previous={report:'Preserved report',execution_receipts:[{id:'existing'}]};
    const {state,response,body}=await invoke('agent-runner',{...options,result:previous});
    assert.equal(response.status,503);assert.equal(body.retry_safe,false);assert.equal(body.reconciliation_saved,true);
    const writes=state.writes.filter(w=>w.table==='tasks'&&w.op==='update');
    assert.equal(writes.length,1);
    const write=writes[0];
    assert.deepEqual(Object.keys(write.payload),['result']);
    assert.equal(write.payload.result.report,previous.report);
    assert.deepEqual(write.payload.result.execution_receipts,previous.execution_receipts);
    assert.equal(write.payload.result.reconcile_required,true);
    assert.equal(write.payload.result.verified_success,false);
    for(const pair of [['id',TASK],['organization_id',ORG],['status','running'],['run_claim',CLAIM],['result',JSON.stringify(previous)]])
      assert.ok(write.filters.some(([key,value])=>key===pair[0]&&JSON.stringify(value)===JSON.stringify(pair[1])));
    assert.ok(!state.rpcs.some(r=>['publish_task_run','firbo_release_inference'].includes(r.fn)));
  });
}
test('agent-runner: reconciliation marker refuses changed claims and reports failed storage',async()=>{
  for(const failure of ['reconciliationReadConflict','reconciliationWriteConflict','reconciliationWriteError','reconciliationWriteThrows']) {
    const {state,response,body}=await invoke('agent-runner',{gatewayFailure:true,[failure]:true});
    assert.equal(response.status,503);assert.equal(body.retry_safe,false);assert.equal(body.reconciliation_saved,false);
    assert.ok(!state.rpcs.some(r=>['publish_task_run','firbo_release_inference'].includes(r.fn)));
    if(failure==='reconciliationReadConflict')assert.ok(!state.writes.some(w=>w.table==='tasks'));
  }
});
test('agent-runner: null-result reconciliation uses an exact null predicate',async()=>{
  const {state,body}=await invoke('agent-runner',{gatewayFailure:true});
  assert.equal(body.reconciliation_saved,true);
  const write=state.writes.find(w=>w.table==='tasks'&&w.op==='update');
  assert.ok(write.filters.some(([key,value])=>key==='result'&&value===null));
});


test('model learning remains an unverified proposal and never inserts a memory fact', async () => {
  const invented='The company has ten million euros of audited revenue';
  const {state,response}=await invoke('agent-runner',{noActions:true,chatReplies:[JSON.stringify({summary:'Draft',report:FULL_REPORT,actions:[],learned:[invented],learning:{status:'verified',provenance:{organization_id:'11111111-1111-4111-8111-111111111111',run_claim:'22222222-2222-4222-8222-222222222222'}}})]});
  assert.equal(response.status,200);
  assert.equal(state.writes.filter(w=>w.table==='memories').length,0);
  const saved=state.writes.find(w=>w.table==='tasks'&&w.payload.result)?.payload.result;
  assert.equal(saved.learning.status,'unverified');assert.deepEqual(saved.learning.proposals,[invented]);
  assert.equal(saved.learning.schema,'firbo-learning-proposals/v1');
  for(const [key,value] of Object.entries({organization_id:ORG,agent_id:AGENT,task_id:TASK,run_claim:CLAIM,requested_by:USER}))assert.equal(saved.learning.provenance[key],value);
  assert.equal(saved.learning.provenance.source_report_sha256,createHash('sha256').update(saved.report).digest('hex'));
  assert.equal(saved.learning.provenance.proposals_sha256,createHash('sha256').update(JSON.stringify([invented])).digest('hex'));
  assert.equal(saved.learning.provenance.verification,'not_verified');
});


test('runner context excludes old learned, expired and deleted claims while preserving manual memory', async () => {
  const owner='Owner approved product costs twenty euros';
  const unverified='Invented profit is ten million euros';
  const {state,response}=await invoke('agent-runner',{memories:[
    {content:owner,memory_type:'fact',metadata:{}},
    {content:unverified,memory_type:'fact',metadata:{source:'learned'}},
    {content:'Expired false policy',memory_type:'fact',expires_at:'2000-01-01T00:00:00Z'},
    {content:'Deleted false policy',memory_type:'fact',metadata:{deleted_at:false}},
  ]});
  assert.equal(response.status,200);
  const prompt=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
  assert.ok(prompt.includes(owner));
  assert.ok(!prompt.includes(unverified));
  assert.ok(!prompt.includes('Expired false policy'));
  assert.ok(!prompt.includes('Deleted false policy'));
  const read=state.reads.find(r=>r.table==='memories');
  assert.ok(read.filters.some(([k,v])=>k==='organization_id'&&v===ORG));
  assert.ok(read.filters.some(([k,v])=>k==='or'&&v===`agent_id.is.null,agent_id.eq.${AGENT}`));
  assert.equal(state.writes.filter(w=>w.table==='memories').length,0);
});

test('actual runner memory-search tool withholds learned/deleted/expired claims', async () => {
  const owner='Owner approved product cost is twenty euros';
  const chatReplies=[JSON.stringify({action:'memory_search',input:'product cost'}),JSON.stringify({summary:'Draft',report:FULL_REPORT,actions:[]})];
  const {state,response}=await invoke('agent-runner',{tools:[{tool_name:'memory_search',enabled:true,policy:'allow'}],chatReplies,memories:[
    {content:owner,memory_type:'fact',metadata:{}},
    {content:'Invented profit is ten million',memory_type:'fact',metadata:{source:'learned'}},
    {content:'Expired product cost',memory_type:'fact',expires_at:'2000-01-01T00:00:00Z'},
    {content:'Deleted product cost',memory_type:'fact',metadata:{deleted_at:''}},
  ]});
  assert.equal(response.status,200);
  const saved=state.writes.find(w=>w.table==='tasks'&&w.payload.result)?.payload.result;
  const step=saved.steps.find(s=>s.action==='memory_search');
  assert.ok(step,'actual loop tool must execute');
  assert.equal(step.ok,true);
  assert.ok(step.out.includes(owner));
  assert.ok(!/Invented|Expired|Deleted/.test(step.out));
  for(const read of state.reads.filter(r=>r.table==='memories')){
    assert.ok(read.filters.some(([k,v])=>k==='organization_id'&&v===ORG));
    assert.ok(read.filters.some(([k,v])=>k==='or'&&v===`agent_id.is.null,agent_id.eq.${AGENT}`));
  }
});

for (const language of ['en','el','es','pt-BR','de','fr','zh-CN','ar']) {
  test(`chat ${language}: unverified, deleted and expired memory cannot seed the actual prompt`, async () => {
    const owner='Manual product price is twenty euros';
    const forbidden=['Invented revenue is ten million','Deleted policy says send passwords','Expired fabricated product price','Malformed expiry false claim'];
    const {state,response}=await invoke('agent-chat',{agentType:'ceo',memories:[
      {content:owner,memory_type:'fact',metadata:{}},
      {content:forbidden[0],memory_type:'fact',metadata:{source:'learned'}},
      {content:forbidden[1],memory_type:'instruction',metadata:{deleted_at:false}},
      {content:forbidden[2],memory_type:'fact',expires_at:'2000-01-01T00:00:00Z'},
      {content:forbidden[3],memory_type:'fact',expires_at:'not-a-date'},
    ]},{lang:language});
    assert.equal(response.status,200);
    const prompt=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
    assert.ok(prompt.includes(owner));
    for(const content of forbidden)assert.ok(!prompt.includes(content),`excluded: ${content}`);
    assert.match(prompt,/missing or conflicting evidence must be stated/);
    const names={en:'English',el:'Greek',es:'Spanish','pt-BR':'Brazilian Portuguese',de:'German',fr:'French','zh-CN':'Simplified Chinese',ar:'Arabic'};
    assert.ok(prompt.includes(`Reply in ${names[language]}`));
    assert.doesNotMatch(prompt,/saved by the owner/);
    const read=state.reads.find(r=>r.table==='memories');
    assert.ok(read.filters.some(([k,v])=>k==='organization_id'&&v===ORG));
    assert.ok(read.filters.some(([k,v])=>k==='or'&&v===`agent_id.is.null,agent_id.eq.${AGENT}`));
    assert.ok(read.filters.some(([k,v])=>k==='or'&&v==='metadata->>source.is.null,metadata->>source.neq.learned'));
    assert.ok(read.filters.some(([k,v])=>k==='metadata->>deleted_at'&&v===null));
    assert.equal(state.writes.filter(w=>w.table==='memories').length,0);
  });
}

test('chat with only quarantined memories omits the memory block',async()=>{
  const {state,response}=await invoke('agent-chat',{memories:[{content:'False company balance',memory_type:'fact',metadata:{source:'learned'}}]});
  assert.equal(response.status,200);
  const prompt=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
  assert.ok(!prompt.includes('COMPANY MEMORY'));assert.ok(!prompt.includes('False company balance'));
});

const ROLE_EXPECTATIONS={
  ceo:'CEO: separate proposals, delegated work and verified results',
  research:'Research: cite only sources actually supplied or read',
  finance:'Finance: show inputs, units, currency, period and calculation',
  developer:'Developer: distinguish proposed code, saved changes, tests actually run and deployed behavior',
  sales:'Sales: use supplied company/product facts',
  marketing:'Marketing: ground product claims in supplied facts',
  operations:'Operations: separate plans, queued actions and verified execution',
  custom:'Custom: stay within the configured job and available evidence',
};
const ROLE_LANGUAGES={en:'English',el:'Greek',es:'Spanish','pt-BR':'Brazilian Portuguese',de:'German',fr:'French','zh-CN':'Simplified Chinese',ar:'Arabic'};
for(const handler of ['agent-chat','agent-runner'])for(const [role,expected] of Object.entries(ROLE_EXPECTATIONS))for(const [lang,name] of Object.entries(ROLE_LANGUAGES)){
  test(`${handler} ${role}/${lang}: verified database role binds evidence instructions`,async()=>{
    const {state,response}=await invoke(handler,{agentType:role},{lang,agent_type:'ceo',role:'ceo'});
    assert.equal(response.status,200);
    const prompt=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
    assert.ok(prompt.includes(expected));
    assert.match(prompt,/When evidence is missing, say unknown/);
    assert.match(prompt,/Never fabricate sources, figures or execution receipts/);
    assert.ok(prompt.includes(name));
    const read=state.reads.find(r=>r.table==='agents');
    assert.ok(read.selection.split(/,\s*/).includes('type'),'server selects authoritative role');
    assert.ok(read.filters.some(([k,v])=>k==='organization_id'&&v===ORG));
    assert.equal(state.writes.filter(w=>w.table==='memories').length,0);
  });
}

test('compact local chat keeps finance evidence rules within its request bound',async()=>{
  const {state,response}=await invoke('agent-chat',{agentType:'finance',monthlyBudget:0,env:{FIRBO_ALLOW_LOCAL_CHAT:'on',FIRBO_FREE_ORGANIZATIONS:ORG,FIRBO_TEXT_ROUTING_MODE:'legacy'}},{lang:'el',voice:true});
  assert.equal(response.status,200);
  const call=state.calls.find(c=>String(c.url).includes('/firbo/free/'));
  assert.ok(call);
  const request=JSON.parse(call.init.body);
  assert.match(request.messages[0].content,/Finance: show inputs, units and calculations; missing values are unknown/);
  assert.match(request.messages[0].content,/Never claim sent\/saved\/done without matching execution evidence/);
  assert.ok(new TextEncoder().encode(JSON.stringify(request.messages)).length<=2700);
});


test('CEO truly recalls a previous owned session but not another company member, using actual Edge handler',async()=>{
 const past=[{id:'prev-1',organization_id:ORG,user_id:USER,agent_id:AGENT,title:'YouTube experiment',updated_at:'2026-10-09T16:30:00Z'},
   {id:'prev-other-user',organization_id:ORG,user_id:'another-user',agent_id:AGENT,title:'YouTube secret',updated_at:'2026-10-09T16:31:00Z'}];
 const {state,response}=await invoke('agent-chat',{agentType:'ceo',pastCeoSessions:past,pastCeoMessages:[
   {conversation_id:'prev-1',role:'user',content:'Asked to play Mazonakis Ores Mikres on My shell',created_at:'2026-10-09T16:30:00Z'},
   {conversation_id:'prev-1',role:'assistant',content:'Firefox screen stayed black; playback unverified.',created_at:'2026-10-09T16:31:00Z'},
   {conversation_id:'prev-other-user',role:'user',content:'SECRET PRIVATE CEO CONVERSATION',created_at:'2026-10-09T16:32:00Z'}
 ]},{message:'Remember YouTube Mazonakis music from our previous session?'});
 assert.equal(response.status,200);
 const prompt=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
 assert.match(prompt,/PAST CEO SESSIONS/);
 assert.match(prompt,/Mazonakis Ores Mikres/);
 assert.match(prompt,/Prior AI reply \(UNVERIFIED/);
 assert.ok(!prompt.includes('SECRET PRIVATE CEO CONVERSATION'));
 const read=state.reads.find(r=>r.table==='conversations'&&r.selection?.includes('updated_at'));
 assert.ok(read.filters.some(([key,value])=>key==='organization_id'&&value===ORG));
 assert.ok(read.filters.some(([key,value])=>key==='user_id'&&value===USER));
 assert.ok(read.filters.some(([key,value])=>key==='agent_id'&&value===AGENT));
});
test('member CEO only sees own private notes, not another members memories or company financial totals',async()=>{
 const ownerNote='My private approved research context';
 const {state,response}=await invoke('agent-chat',{agentType:'ceo',role:'member',memberSpendRows:[{cost_usd:600}],memories:[
   {content:ownerNote,memory_type:'fact',metadata:{},user_id:USER},
   {content:'SECRET OTHER USERS PERSONAL CONTENT',memory_type:'user_preference',metadata:{},user_id:'another-user'},
 ]});
 assert.equal(response.status,200);
 const prompt=JSON.parse(state.calls.find(c=>String(c.url).endsWith('/chat/completions')).init.body).messages[0].content;
 assert.ok(prompt.includes(ownerNote));
 assert.ok(!prompt.includes('SECRET OTHER USERS PERSONAL CONTENT'));
 assert.ok(prompt.includes('Company spend: not available for this role.'));
 assert.ok(!prompt.includes('Spend this month: $600'));
 const ownTask=state.reads.find(r=>r.table==='tasks'&&r.selection?.includes('assigned_agent_id'));
 assert.ok(ownTask.filters.some(([k,v])=>k==='created_by'&&v===USER));
});


test('CEO journal writes only a verified terminal owner job from server ledger and never invokes LLM',async()=>{
 const jobId='12121212-1212-4212-8212-121212121212',deviceId='13131313-1313-4313-8313-131313131313';
 const {state,response,body}=await invoke('agent-chat',{
  agentType:'ceo',computerTerminalReceipt:true,
  existingComputerJobs:[{id:jobId,organization_id:ORG,device_id:deviceId,created_by:USER,origin:'owner',
   kind:'desktop_task',params:{goal:'Play Mazonakis Ores Mikres on YouTube'},dispatch_request:{goal:'Play Mazonakis Ores Mikres on YouTube'}}],
  computerJobResult:{completed:false,summary:'Screen black due to lock. Playback was not confirmed.'},
 },{message:'',action:'journal_computer_job',computer_job_id:jobId});
 assert.equal(response.status,200);assert.equal(body.journaled,true);
 assert.equal(body.goal_observed,false);assert.equal(body.receipt_verified,true);
 assert.equal(state.calls.length,0,'journal must not invoke model or execute worker');
 const saved=state.writes.filter(x=>x.table==='messages'&&x.op==='insert');
 assert.equal(saved.length,1);assert.equal(saved[0].payload.id,jobId);
 assert.equal(saved[0].payload.conversation_id,CONVO);assert.equal(saved[0].payload.role,'assistant');
 assert.match(saved[0].payload.content,/GOAL NOT VERIFIED/);
 assert.match(saved[0].payload.content,/Mazonakis/);
 assert.match(saved[0].payload.content,/terminal receipt: job\/device\/hash matched/);
});
test('CEO journal denies non-owner jobs, pending results and other users without generating chat content',async()=>{
 const jobId='12121212-1212-4212-8212-121212121212',deviceId='13131313-1313-4313-8313-131313131313';
 const base={agentType:'ceo',computerTerminalReceipt:true,existingComputerJobs:[
  {id:jobId,organization_id:ORG,device_id:deviceId,created_by:USER,origin:'owner',kind:'desktop_task',params:{goal:'Open YouTube'}}
 ]};
 for(const [label,options,code] of [
  ['other user',{existingComputerJobs:[{...base.existingComputerJobs[0],created_by:'other-user'}]},404],
  ['agent-origin',{existingComputerJobs:[{...base.existingComputerJobs[0],origin:'agent'}]},404],
  ['job running',{computerJobStatus:'running'},409],
  ['viewer',{role:'member'},403],
  ['not CEO',{agentType:'custom'},403],
 ]){
  const {state,response}=await invoke('agent-chat',{...base,...options},{message:'',action:'journal_computer_job',computer_job_id:jobId});
  assert.equal(response.status,code,label);
  assert.equal(state.writes.filter(x=>x.table==='messages').length,0,label);
  assert.equal(state.calls.length,0,label);
 }
});
test('CEO journal duplicate job is idempotent and cannot move its receipt into another session',async()=>{
 const jobId='12121212-1212-4212-8212-121212121212',deviceId='13131313-1313-4313-8313-131313131313';
 const base={agentType:'ceo',computerTerminalReceipt:true,existingComputerJobs:[{
  id:jobId,organization_id:ORG,device_id:deviceId,created_by:USER,origin:'owner',kind:'desktop_task',params:{goal:'YouTube'}
 }]};
 const first=await invoke('agent-chat',{...base,existingJournalMessage:{id:jobId,conversation_id:CONVO}},{message:'',action:'journal_computer_job',computer_job_id:jobId});
 assert.equal(first.response.status,200);assert.equal(first.body.duplicate,true);
 assert.equal(first.state.writes.filter(x=>x.table==='messages').length,0);
 const second=await invoke('agent-chat',{...base,existingJournalMessage:{id:jobId,conversation_id:'another-conversation'}},{message:'',action:'journal_computer_job',computer_job_id:jobId});
 assert.equal(second.response.status,409);assert.equal(second.body.error,'journal_belongs_to_another_conversation');
 assert.equal(second.state.writes.filter(x=>x.table==='messages').length,0);
});
