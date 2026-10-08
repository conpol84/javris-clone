import {test} from 'node:test';
import assert from 'node:assert/strict';
import {memoryIndexReference,resolveMem0Search} from '../../supabase/functions/_shared/mem0-retrieval-boundary.ts';
const id=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const base={id:id(401),organization_id:id(201),agent_id:null,content:'Exact owner text 😀',updated_at:'2026-10-08T09:00:00.123456Z',expires_at:'2030-05-01T10:15:30.654321+03:00',metadata:{}};
test('timestamp offset and fractional spelling do not invalidate the same instant',async()=>{
 const a=await memoryIndexReference(base),b=await memoryIndexReference({...base,updated_at:'2026-10-08T12:00:00.123+03:00',expires_at:'2030-05-01T07:15:30.654Z'});
 assert.equal(a.firbo_revision,b.firbo_revision);
 assert.notEqual(a.firbo_revision,(await memoryIndexReference({...base,updated_at:'2026-10-08T09:00:00.124Z'})).firbo_revision);
});
test('canonical instant still binds exact content, tenant, agent, and expiry',async()=>{
 const original=await memoryIndexReference(base);
 for(const change of [{content:base.content+' '},{organization_id:id(202)},{agent_id:id(301)},{expires_at:null}])
  assert.notEqual(original.firbo_revision,(await memoryIndexReference({...base,...change})).firbo_revision);
});
test('wire format change resolves authoritative current text; correction remains stale',async()=>{
 const metadata=await memoryIndexReference(base);const scope={organizationId:id(201),agentId:id(301)};
 const options={now:()=>Date.parse('2026-10-08T09:01:00Z')};
 assert.equal((await resolveMem0Search(scope,{results:[{metadata}]},async()=>[{...base,updated_at:'2026-10-08T12:00:00.123+03:00'}],options))[0].content,base.content);
 assert.deepEqual(await resolveMem0Search(scope,{results:[{metadata}]},async()=>[{...base,content:'Correction'}],options),[]);
});
test('timestamps outside the database interoperability range fail closed',async()=>{
 for(const updated_at of ['0000-01-01T00:00:00Z','+010000-01-01T00:00:00Z'])
  await assert.rejects(memoryIndexReference({...base,updated_at}),/timestamp_invalid/);
});
