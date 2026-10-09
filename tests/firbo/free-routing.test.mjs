import {test} from 'node:test';import assert from 'node:assert/strict';
import {freeForOrganization,completeViaFree} from '../../supabase/functions/_shared/free-routing.ts';
const ORG='11111111-1111-4111-8111-111111111111',RID='22222222-2222-4222-8222-222222222222';
const messages=[{role:'user',content:'Test'}];
const value=()=>({model:'ollama:qwen3:1.7b',choices:[{message:{content:'Test result'},finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3},firbo:{contract:'firbo-free-text/v1',policy:'no-paid-fallback',request_id:RID,provider_fee_usd:0,cost_basis:'self_hosted_no_metered_fee',infrastructure_cost_excluded:true}});
const call=(fetcher,extra={})=>completeViaFree(ORG,'Bearer test-caller',RID,messages,{fetcher,...extra});
test('pilot off by default and only named orgs enter',()=>{assert.equal(freeForOrganization(ORG,()=>undefined),false);assert.equal(freeForOrganization(ORG,()=>ORG),true);assert.equal(freeForOrganization(ORG,()=>RID),false);});
test('invalid server list fails closed',()=>assert.throws(()=>freeForOrganization(ORG,()=>'*')));
test('one exact native request forwards caller, never provider keys',async()=>{let calls=0;const r=await call(async(url,init)=>{calls++;assert.equal(url,'https://api.firboai.app/v1/firbo/free/chat/completions');assert.equal(init.headers.authorization,'Bearer test-caller');assert.equal(init.redirect,'error');assert.deepEqual(JSON.parse(init.body),{organization_id:ORG,request_id:RID,messages});return Response.json(value());});assert.equal(calls,1);assert.equal(r.cost,0);assert.equal(r.trace.infrastructure_cost_excluded,true);});
for(const [name,edit] of [
 ['paid model',v=>v.model='openai:gpt-paid'],['wrong request',v=>v.firbo.request_id=ORG],['nonzero charge',v=>v.firbo.provider_fee_usd=1],['missing policy',v=>delete v.firbo],['missing usage',v=>delete v.usage],['tools',v=>v.choices[0].message.tool_calls=[{}]],['refusal',v=>v.choices[0].finish_reason='content_filter'],['incompatible cost evidence',v=>v.firbo.cost_basis='verified_free_api']]){
 test(name+' never accepted as verified free',async()=>{let calls=0;const v=value();edit(v);await assert.rejects(call(async()=>{calls++;return Response.json(v)}));assert.equal(calls,1);});
}
for(const status of [401,403,429,503])test('native '+status+' has no paid fallback',async()=>{let n=0;await assert.rejects(call(async()=>{n++;return new Response('secret upstream text',{status})}),e=>e.message===`free_http_${status}`);assert.equal(n,1);});
test('abort before network',async()=>{const c=new AbortController();c.abort();await assert.rejects(call(()=>{throw Error('must not call')},{signal:c.signal}),/free_request_cancelled/);});
test('stalled connection is bounded without retry',async()=>{let n=0;await assert.rejects(call(()=>{n++;return new Promise(()=>{})},{timeoutMs:10}),/free_request_cancelled/);assert.equal(n,1);});
test('oversize content denied before inference',async()=>{await assert.rejects(completeViaFree(ORG,'Bearer test',RID,[{role:'user',content:'a'.repeat(3000)}],{fetcher:()=>{throw Error('must not call')}}),/free_context_too_large/);});
