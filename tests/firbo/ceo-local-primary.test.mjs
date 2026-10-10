import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerCeoLocalPrimaryEnabled, completeViaCeoLocalOnly,
} from '../../supabase/functions/_shared/ceo-model-recovery.ts';

const ORG='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const RID='33333333-3333-4333-8333-333333333333';
const enabled = {FIRBO_FREE_ORGANIZATIONS:ORG,FIRBO_CEO_LOCAL_ONLY_PRIMARY:'on'};
const isEnabled=(changes={})=>ownerCeoLocalPrimaryEnabled({
  organizationId:ORG,isCeo:true,isOwnerOrAdmin:true,isUserSession:true,
  hasOwnKey:false,agentModel:'auto',env:key=>enabled[key],...changes,
});
const LOCAL='https://api.firboai.app/v1/firbo/free/local/chat/completions';
const msgs=[{role:'user',content:'Short owner CEO prompt'}];
const response=(patch={})=>({
  model:'ollama:qwen3:1.7b',choices:[{message:{content:'Local CEO answer'},finish_reason:'stop'}],
  usage:{prompt_tokens:10,completion_tokens:12},
  firbo:{contract:'firbo-free-text/v1',request_id:RID,policy:'no-paid-fallback',
    provider_fee_usd:0,cost_basis:'self_hosted_no_metered_fee',infrastructure_cost_excluded:true},
  ...patch,
});
const send=(fetcher,extra={})=>completeViaCeoLocalOnly(ORG,'Bearer synthetic-owner',RID,msgs,{fetcher,...extra});

test('emergency Ollama primary defaults to OFF, despite existing free org list',()=>{
  assert.equal(isEnabled({env:key=>key==='FIRBO_FREE_ORGANIZATIONS'?ORG:undefined}),false);
  assert.equal(isEnabled({env:key=>({...enabled,FIRBO_CEO_LOCAL_ONLY_PRIMARY:'true'})[key]}),false);
  assert.equal(isEnabled({env:key=>({...enabled,FIRBO_FREE_ORGANIZATIONS:'*'})[key]}),false);
  assert.equal(isEnabled({env:key=>({...enabled,FIRBO_FREE_ORGANIZATIONS:OTHER})[key]}),false);
});
test('only authenticated owner/admin on same company CEO auto model is eligible',()=>{
  assert.equal(isEnabled(),true);
  for(const v of [
    {isCeo:false},{isOwnerOrAdmin:false},{isUserSession:false},{hasOwnKey:true},
    {agentModel:'openai:gpt-5.5'},{organizationId:OTHER},
  ])assert.equal(isEnabled(v),false,JSON.stringify(v));
  assert.equal(isEnabled({agentModel:null}),true);
});
test('native local-only request goes to fixed host and accepts proven Ollama response once',async()=>{
  let n=0;
  const result=await send(async(url,init)=>{
    n++;
    assert.equal(String(url),LOCAL);
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.authorization,'Bearer synthetic-owner');
    assert.deepEqual(JSON.parse(init.body),{organization_id:ORG,request_id:RID,messages:msgs});
    return Response.json(response());
  });
  assert.equal(n,1);
  assert.equal(result.trace.reported_model,'ollama:qwen3:1.7b');
  assert.equal(result.trace.cost_basis,'self_hosted_no_metered_fee');
  assert.equal(result.cost,0);
});
test('no cloud free result can be misrepresented as local even if free-route envelope is valid',async()=>{
  let n=0;
  const cloud=response({
    model:'openrouter:some/free:free',
    firbo:{...response().firbo,cost_basis:'verified_free_api'},
  });
  await assert.rejects(send(async()=>{n++;return Response.json(cloud);}),/local_contract_not_verified/);
  assert.equal(n,1);
});
test('invalid price, contract, request correlation and paid models fail closed',async()=>{
  for(const value of [
    response({firbo:{...response().firbo,provider_fee_usd:0.01}}),
    response({firbo:{...response().firbo,request_id:OTHER}}),
    response({model:'openai:gpt-paid'}),
    response({usage:{prompt_tokens:-1,completion_tokens:3}}),
  ])await assert.rejects(send(async()=>Response.json(value)));
});
test('native refusal or provider outage never makes a second paid/cloud request',async()=>{
  for(const status of [401,403,429,502,503]){
    let calls=0;
    await assert.rejects(send(async(url)=>{calls++;assert.equal(String(url),LOCAL);return new Response('secret body',{status});}),e=>e.message===('free_http_'+status));
    assert.equal(calls,1);
  }
});
test('stopped caller never sends another request',async()=>{
  let calls=0;const signal=new AbortController();signal.abort();
  await assert.rejects(send(()=>{calls++;throw new Error('unexpected paid request')},{signal:signal.signal}),/free_request_cancelled/);
  assert.equal(calls,0);
});
