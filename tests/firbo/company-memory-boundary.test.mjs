import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const read=async path=>readFile(new URL('../../'+path,import.meta.url),'utf8');

test('CEO and agents only read tenant-scoped active company publication records',async()=>{
 for(const path of ['supabase/functions/agent-chat/index.ts','supabase/functions/agent-runner/index.ts']){
  const source=await read(path);
  const matches=[...source.matchAll(/from\('company_memory_publications'\)[\s\S]{0,300}?\.is\('revoked_at',null\)/g)];
  assert.ok(matches.length>=1,path+': reviewed publication must check revoked status');
  for(const match of matches)assert.match(match[0],/\.eq\('organization_id',\s*(?:convo|task)\.organization_id\)/);
  assert.match(source,/approvedCompanyMemoryBlock/);
  assert.doesNotMatch(source,/m\.metadata\?\.visibility==='company'/);
 }
});
test('existing personal notes remain scoped to their authenticated user',async()=>{
 const chat=await read('supabase/functions/agent-chat/index.ts');
 const runner=await read('supabase/functions/agent-runner/index.ts');
 assert.match(chat,/from\('memories'\)[\s\S]{0,240}\.eq\('user_id',\s*user\.id\)/);
 const personal=[...runner.matchAll(/from\('memories'\)[\s\S]{0,240}\.eq\('user_id',\s*user\.id\)/g)];
 assert.equal(personal.length,2);
});
test('company-memory schema exposes SELECT to authenticated and no client writes',async()=>{
 const sql=await read('supabase/migrations/20261010011500_company_memory_owner_review.sql');
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/i);
 assert.match(sql,/GRANT SELECT ON TABLE public\.company_memory_publications TO authenticated;/);
 assert.doesNotMatch(sql,/GRANT (?:INSERT|UPDATE|DELETE)[^;]*TO authenticated/i);
 assert.match(sql,/WHERE revoked_at IS NULL/);
 assert.match(sql,/m\.organization_id=NEW\.organization_id/);
});
