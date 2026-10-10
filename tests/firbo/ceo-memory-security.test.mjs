import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ownerVisibleMemory} from '../../supabase/functions/_shared/memory-visibility.ts';
const src=(p)=>readFile(new URL('../../'+p,import.meta.url),'utf8');
test('ownerless model proposals never become company facts or another user prompt',()=>{
 const entries=[
  {id:'legacy-model',user_id:null,memory_type:'fact',metadata:{source:'learned',visibility:'company'}},
  {id:'other-user',user_id:'bob',memory_type:'company',metadata:{visibility:'company'}},
  {id:'own-project',user_id:'alice',memory_type:'project',metadata:{}},
 ];
 assert.deepEqual(ownerVisibleMemory(entries,'alice').map(x=>x.id),['own-project']);
 assert.deepEqual(ownerVisibleMemory(entries,'bob').map(x=>x.id),['other-user']);
 assert.deepEqual(ownerVisibleMemory(entries,''),[]);
});
test('live CEO inference query is additionally user scoped despite service-role bypassing RLS',async()=>{
 const code=await src('supabase/functions/agent-chat/index.ts');
 assert.match(code,/from\('memories'\)[\s\S]{0,170}\.eq\('organization_id',\s*convo\.organization_id\)\s*\.eq\('user_id',\s*user\.id\)/);
 assert.match(code,/ownerVisibleMemory\(/);
 assert.doesNotMatch(code,/m\.user_id===null\|\|/);
 assert.doesNotMatch(code,/m\.metadata\?\.visibility==='company'/);
});
test('native agent-runner memory prompts and tool search use the same authenticated user scope',async()=>{
 const code=await src('supabase/functions/agent-runner/index.ts');
 const queries=[...code.matchAll(/from\('memories'\)[^\n]*/g)].map(x=>x[0]);
 assert.equal(queries.length,2,'Expected exactly the context and search memory queries');
 for(const query of queries)assert.match(query,/\.eq\('user_id',\s*user\.id\)/);
});
