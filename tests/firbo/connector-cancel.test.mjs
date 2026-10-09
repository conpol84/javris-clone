/** Actual connector cancellation handler; mocked DB/auth, not a live RLS test. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=await mkdtemp(join(tmpdir(),'firbo-connector-test-'));
const originalDeno=globalThis.Deno;let handler,options,calls;
globalThis.Deno={env:{get:()=> 'test-only'},serve:fn=>handler=fn};
globalThis.__connectorTestClient=()=>({auth:{getUser:async()=>({data:{user:options.unsigned?null:{id:'user1'}}})},from:table=>{
 const q={op:'read',filters:[],select:()=>q,eq:(k,v)=>{q.filters.push([k,v]);return q;},update:p=>{q.op='update';return q;},maybeSingle:async()=>{
  calls.push({table,op:q.op,filters:q.filters});
  if(table==='organization_members')return {data:options.denied?null:{role:options.role??'owner'},error:null};
  if(table==='connector_jobs'&&q.op==='read')return {data:options.missing?null:{id:'job1',organization_id:'org1',status:'queued'},error:null};
  if(table==='connector_jobs'&&q.op==='update')return {data:options.race?null:{id:'job1'},error:options.dbError?{message:'private db error'}:null};
  throw Error('Unexpected fixture query');
 }};return q;
}});
const source=(await readFile(new URL('../../supabase/functions/connector/index.ts',import.meta.url),'utf8')).replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = (...args: any[]) => (globalThis as any).__connectorTestClient(...args);').replace("from '../_shared/desktop-planner.ts'",`from '${new URL('../../supabase/functions/_shared/desktop-planner.ts',import.meta.url).href}'`).replace("from '../_shared/computer-policy.ts'",`from '${new URL('../../supabase/functions/_shared/computer-policy.ts',import.meta.url).href}'`);
const path=join(dir,'handler.ts');await writeFile(path,source);await import(pathToFileURL(path).href);
after(async()=>{globalThis.Deno=originalDeno;delete globalThis.__connectorTestClient;await rm(dir,{recursive:true,force:true});});
for(const [name,opt,status] of [['queued',{},200],['already claimed',{race:true},409],['failed persistence',{dbError:true},503],['anonymous',{unsigned:true},401],['wrong company',{denied:true},403],['viewer',{role:'viewer'},403],['missing',{missing:true},404]]){
 test('cancel: '+name,async()=>{options=opt;calls=[];const r=await handler(new Request('https://test.invalid/connector',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'cancel_job',job_id:'job1'})}));const data=await r.json();assert.equal(r.status,status);if(status!==200)assert.notEqual(data.ok,true);const update=calls.find(c=>c.op==='update');if(update){assert.ok(update.filters.some(([k,v])=>k==='status'&&v==='queued'));}if([401,403,404].includes(status))assert.equal(update,undefined);assert.ok(!JSON.stringify(data).includes('private db error'));});
}
