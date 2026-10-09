/** Actual mission handler; synthetic auth/DB/provider only, no paid calls. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { roleEvidenceInstructions } from '../../supabase/functions/_shared/agent-role-evidence.ts';
const root = new URL('../../', import.meta.url);
const ORG='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CEO='cccccccc-cccc-4ccc-8ccc-cccccccccccc', EMP='dddddddd-dddd-4ddd-8ddd-dddddddddddd', MISSION='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const saved={fetch:globalThis.fetch,Deno:globalThis.Deno};
let state, handler;
globalThis.__missionClient=()=>state.client;
globalThis.Deno={env:{get:k=>state.env[k]},serve:h=>{handler=h;}};
const temp=await mkdtemp(join(tmpdir(),'firbo-mission-role-'));
const original=await readFile(new URL('supabase/functions/mission-runner/index.ts',root),'utf8');
const code=original.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = (..._args: any[]) => (globalThis as any).__missionClient();')
  .replace(/'\.\.\/_shared\/([a-z-]+\.ts)'/g,(_m,f)=>JSON.stringify(new URL(`supabase/functions/_shared/${f}`,root).href));
assert.notEqual(code,original);
const file=join(temp,'mission.ts');await writeFile(file,code);await import(pathToFileURL(file).href);
after(async()=>{globalThis.fetch=saved.fetch;globalThis.Deno=saved.Deno;delete globalThis.__missionClient;await rm(temp,{recursive:true,force:true});});
function fixture(action,role='finance',options={}) {
  state={calls:[],reads:[],rpcs:[],env:{SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'service-test',LLM_DEFAULT:'openai:test',OPENAI_API_KEY:'fixture-key',OPENAI_PRICE_IN_PER_M:'1',OPENAI_PRICE_OUT_PER_M:'2'}};
  const ceo={id:CEO,name:'CEO',slug:'ceo',type:'ceo',model:'auto',owner_instructions:'Preserve owner instructions.'};
  const employee={id:EMP,name:'Employee',slug:'employee',type:role,model:'auto'};
  state.client={auth:{getUser:async()=>({data:{user:options.unsigned?null:{id:USER,email:'owner@example.test'}}})},rpc:async(fn,args)=>{
    state.rpcs.push({fn,args});
    if(fn==='provider_key_for_runtime')return{data:null,error:null};
    if(fn==='plan_limit')return{data:100,error:null};
    if(fn==='firbo_reserve_inference')return{data:options.deny?{ok:false,reason:'budget_exceeded'}:{ok:true,request_id:crypto.randomUUID(),duplicate:false},error:null};
    if(fn==='firbo_settle_inference')return{data:{ok:true,status:'settled'},error:null};
    throw new Error('Unexpected RPC '+fn);
  },from:table=>{
    let op='select',selection, payload;const filters=[];
    const execute=()=>{
      state.reads.push({table,op,selection,filters,payload});
      if(op!=='select')return{data:op==='insert'?[{id:EMP}]:{id:MISSION},error:null};
      if(table==='organization_members')return{data:options.noMembership?null:{role:'owner'},error:null};
      if(table==='agents'){
        assert.ok(filters.some(([k,v])=>k==='organization_id'&&v===ORG));
        assert.ok(filters.some(([k,v])=>k==='enabled'&&v===true));
        assert.ok(selection.includes('type'));
        return{data:[ceo,employee],error:null};
      }
      if(table==='organizations')return{data:{name:'Fixture company',profile:{},plan:'pro'},error:null};
      if(table==='tasks'){
        if(filters.some(([k])=>k==='parent_task_id'))return{data:[{id:EMP,title:'Draft only',status:'completed',result:{report:'Draft proposal, no execution receipt.'},assigned_agent_id:EMP}],error:null};
        if(selection==='title, result, assigned_agent_id')return{data:[],error:null};
        return{data:{id:MISSION,organization_id:ORG,title:'Review',description:'Topic data',kind:'mission',status:action==='synthesize'?'running':'pending',metadata:{meeting:true,participants:[EMP]}},error:null};
      }
      throw new Error('Unexpected table '+table);
    };
    const b={select:s=>{selection=s;return b;},eq:(k,v)=>{filters.push([k,v]);return b;},in:(k,v)=>{filters.push([k,v]);return b;},order:()=>b,limit:()=>b,update:p=>{op='update';payload=p;return b;},insert:p=>{op='insert';payload=p;return b;},maybeSingle:async()=>execute(),then:(resolve,reject)=>Promise.resolve(execute()).then(resolve,reject)};return b;
  }};
  globalThis.fetch=async(url,init)=>{const request=JSON.parse(init.body);state.calls.push({url,request});return Response.json({choices:[{message:{content:JSON.stringify({steps:[{title:'Prepare draft',agent:'employee'}],summary:'Fixture',report:'Draft proposal only.',actions:[]})}}],usage:{prompt_tokens:30,completion_tokens:20}});};
}
async function invoke(action,role,lang='en',options={}) {
  fixture(action,role,options);
  const response=await handler(new Request('https://edge.example.test',{method:'POST',headers:{authorization:'Bearer fixture','content-type':'application/json'},body:JSON.stringify({action,mission_id:MISSION,lang,role:'developer',agent_type:'developer'})}));
  return{response,state};
}
const langs={en:'English',el:'Greek',es:'Spanish','pt-BR':'Brazilian Portuguese',de:'German',fr:'French','zh-CN':'Simplified Chinese',ar:'Arabic'};
for(const [lang,label] of Object.entries(langs)) {
  for(const role of ['ceo','research','finance','developer','sales','marketing','operations','custom'])test(`meeting ${role}/${lang} binds scoped speaker and CEO minutes`,async()=>{
    const{response,state}=await invoke('meet',role,lang);assert.equal(response.status,200);assert.equal(state.calls.length,2);
    const [speaker,minutes]=state.calls.map(c=>c.request.messages[0].content);
    assert.ok(speaker.includes(roleEvidenceInstructions(role)));assert.ok(minutes.includes(roleEvidenceInstructions('ceo')));
    assert.ok(speaker.includes(`Speak in ${label}.`));assert.ok(minutes.includes(`Write in ${label}.`));
    assert.ok(minutes.includes('Preserve owner instructions.'));
    assert.deepEqual(state.rpcs.filter(r=>r.fn==='firbo_reserve_inference').map(r=>r.args.p_agent),[EMP,CEO]);
    assert.equal(state.rpcs.filter(r=>r.fn==='firbo_settle_inference').length,2);
  });
  for(const action of ['plan','synthesize'])test(`${action}/${lang} binds CEO evidence without changing accounting`,async()=>{
    const{response,state}=await invoke(action,'finance',lang);assert.equal(response.status,200);assert.equal(state.calls.length,1);
    assert.ok(state.calls[0].request.messages[0].content.includes(roleEvidenceInstructions('ceo')));
    assert.ok(state.calls[0].request.messages[0].content.includes(label));
    const admission=state.rpcs.find(r=>r.fn==='firbo_reserve_inference');assert.equal(admission.args.p_agent,CEO);assert.equal(admission.args.p_source,'mission-runner');
    assert.equal(state.rpcs.filter(r=>r.fn==='firbo_settle_inference').length,1);
  });
}
test('unknown DB type uses Custom policy, not body role override',async()=>{const{response,state}=await invoke('meet','alien');assert.equal(response.status,200);assert.ok(state.calls[0].request.messages[0].content.includes(roleEvidenceInstructions('custom')));});
for(const options of [{unsigned:true},{noMembership:true},{deny:true}])test(`denied admission makes no provider call ${JSON.stringify(options)}`,async()=>{const{response,state}=await invoke('plan','finance','en',options);assert.notEqual(response.status,200);assert.equal(state.calls.length,0);});
