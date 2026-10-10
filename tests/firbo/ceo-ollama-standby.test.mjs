import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerCeoOllamaBackupEnabled, completeViaCeoLocalOnly,
} from '../../supabase/functions/_shared/ceo-model-recovery.ts';

const ORG='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const envValues={FIRBO_FREE_ORGANIZATIONS:ORG,FIRBO_CEO_OLLAMA_BACKUP:'on'};
const permitted=(override={})=>ownerCeoOllamaBackupEnabled({
  requested:true,organizationId:ORG,isCeo:true,isOwnerOrAdmin:true,
  isUserSession:true,hasOwnKey:false,agentModel:'auto',
  env:key=>envValues[key],...override,
});

test('Ollama is NOT the primary model and is default-off without explicit server approval',()=>{
  assert.equal(permitted(),true);
  assert.equal(permitted({requested:false}),false);
  assert.equal(permitted({env:key=>key==='FIRBO_FREE_ORGANIZATIONS'?ORG:undefined}),false);
  assert.equal(permitted({env:key=>({...envValues,FIRBO_CEO_OLLAMA_BACKUP:'true'})[key]}),false);
  assert.equal(permitted({env:key=>({...envValues,FIRBO_FREE_ORGANIZATIONS:'*'})[key]}),false);
  assert.equal(permitted({env:key=>({...envValues,FIRBO_FREE_ORGANIZATIONS:OTHER})[key]}),false);
});
test('backup is forbidden for nonowner users, BYOK, scheduled workers or other tenants',()=>{
  for (const denied of [
    {isCeo:false},{isOwnerOrAdmin:false},{isUserSession:false},{hasOwnKey:true},
    {agentModel:'omniroute:firbo-quality'},{organizationId:OTHER},
  ]) assert.equal(permitted(denied),false,JSON.stringify(denied));
});
test('allowed standby sends one new request only to the protected native Ollama endpoint',async()=>{
  const RID='33333333-3333-4333-8333-333333333333';
  const messages=[{role:'user',content:'This is a fresh user prompt, not the failed request.'}];
  let calls=0;
  const response=await completeViaCeoLocalOnly(ORG,'Bearer synthetic-owner',RID,messages,{
    fetcher:async (url,init)=>{
      calls++;
      assert.equal(String(url),'https://api.firboai.app/v1/firbo/free/local/chat/completions');
      assert.deepEqual(JSON.parse(init.body),{organization_id:ORG,request_id:RID,messages});
      return Response.json({
        model:'ollama:qwen3:1.7b',
        choices:[{message:{content:'Local answer'},finish_reason:'stop'}],
        usage:{prompt_tokens:12,completion_tokens:2},
        firbo:{contract:'firbo-free-text/v1',request_id:RID,policy:'no-paid-fallback',
          provider_fee_usd:0,cost_basis:'self_hosted_no_metered_fee',
          infrastructure_cost_excluded:true},
      });
    },
  });
  assert.equal(calls,1);
  assert.equal(response.trace.reported_model,'ollama:qwen3:1.7b');
  assert.equal(response.trace.provider_fee_usd,0);
});
test('local unavailable cannot automatically replay or invoke paid cloud',async()=>{
  const RID='44444444-4444-4444-8444-444444444444';
  let calls=0;
  await assert.rejects(completeViaCeoLocalOnly(
    ORG,'Bearer synthetic-owner',RID,[{role:'user',content:'fresh'}],
    {fetcher:async url=>{calls++;assert.equal(String(url),'https://api.firboai.app/v1/firbo/free/local/chat/completions');return new Response('unavailable',{status:503});}},
  ),/free_http_503/);
  assert.equal(calls,1);
});
