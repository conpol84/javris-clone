// Test-only adapter: executes the actual Edge handler, with auth/PostgREST replaced.
// It does not claim to implement PostgreSQL transactions or Supabase RLS.
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, webcrypto, randomUUID } from 'node:crypto';
export const TOKEN = 'a'.repeat(64), ORG = '22222222-2222-4222-8222-222222222222', DEVICE = '33333333-3333-4333-8333-333333333333';
export async function makeHandler() {
 const state = { rows: {
  connector_secrets: [{device_id:DEVICE,token_hash:createHash('sha256').update(TOKEN).digest('hex')}],
  connector_devices: [{id:DEVICE,organization_id:ORG,paired:true,revoked_at:null}],
  connector_jobs: [], organization_members: [], audit_log: [],
 }, writes:[], reads:[], failures:[], user:null };
 function builder(table) {
  const filters=[];let update=null,select=null,limit=Infinity,insert=null;
  const b={
   select(v){select=v;return b;},eq(k,v){filters.push(row=>row[k]===v);return b;},
   in(k,v){filters.push(row=>v.includes(row[k]));return b;},is(k,v){filters.push(row=>row[k]===v);return b;},
   gte(k,v){filters.push(row=>row[k]>=v);return b;},order(){return b;},limit(v){limit=v;return b;},
   update(v){update=v;return b;},insert(v){insert=v;return b;},
   maybeSingle(){return Promise.resolve(run(true));},single(){return Promise.resolve(run(true));},
   then(resolve,reject){return Promise.resolve(run(false)).then(resolve,reject);}
  };
  function run(single) {
   const index=state.failures.findIndex(f=>f.table===table&&f.type===(update?'update':insert?'insert':'read'));
   if(index>=0){state.failures.splice(index,1);return {data:null,error:{message:'synthetic database error'},count:null};}
   let rows=(state.rows[table]||[]).filter(row=>filters.every(f=>f(row))).slice(0,limit);
   if(update){for(const row of rows)Object.assign(row,structuredClone(update));state.writes.push({table,matched:rows.length,keys:Object.keys(update)});}
   else if(insert){rows=(Array.isArray(insert)?insert:[insert]).map(row=>({id:randomUUID(),...structuredClone(row)}));(state.rows[table]??=[]).push(...rows);}
   else state.reads.push({table,select});
   return {data:structuredClone(single?(rows[0]??null):rows),error:null,count:rows.length};
  }
  return b;
 }
 // Test double for the SQL function connector_finish_execution (migration 20261004032400): same
 // duplicate/conflict/state rules for the job row; it does not model task rollups, audit rows or locking.
 function rpc(name,args){
  const fail=type=>{const i=state.failures.findIndex(f=>f.table==='connector_jobs'&&f.type===type);if(i<0)return false;state.failures.splice(i,1);return true;};
  if(name!=='connector_finish_execution')return Promise.resolve({data:null,error:{message:'unknown_rpc'}});
  if(fail('read')||fail('update'))return Promise.resolve({data:null,error:{message:'synthetic database error'}});
  const err=message=>Promise.resolve({data:null,error:{message}});
  if(!/^[a-f0-9]{64}$/.test(args.p_digest))return err('bad_digest');
  const row=state.rows.connector_jobs.find(r=>r.id===args.p_job&&r.device_id===args.p_device&&r.organization_id===args.p_org);
  if(!row)return err('job_not_found');
  if(row.status==='done'||row.status==='error'){
   if(row.report_sha256===args.p_digest&&row.status===(args.p_ok?'done':'error'))return Promise.resolve({data:{duplicate:true,receipt:row.receipt??null,task_id:row.task_id??null},error:null});
   return err('report_conflict');
  }
  if(row.status!=='running')return err('state_conflict');
  const receipt={contract:'firbo-execution-receipt/v1',job_id:row.id,task_id:row.task_id??null,approval_id:row.approval_id??null,device_id:row.device_id,kind:row.kind??null,ok:args.p_ok,report_sha256:args.p_digest,finished_at:new Date().toISOString()};
  const patch={status:args.p_ok?'done':'error',result:args.p_ok?structuredClone(args.p_result):null,error:args.p_ok?null:String(args.p_error??'failed').slice(0,500),finished_at:receipt.finished_at,report_sha256:args.p_digest,receipt};
  Object.assign(row,patch);state.writes.push({table:'connector_jobs',matched:1,keys:Object.keys(patch)});
  return Promise.resolve({data:{duplicate:false,receipt,task_id:row.task_id??null},error:null});
 }
 const sdk={from:builder,rpc,auth:{getUser:async()=>({data:{user:state.user},error:null})}};
 const source=await fs.readFile(new URL('../../../supabase/functions/connector/index.ts',import.meta.url),'utf8');
 const original="import { createClient } from 'npm:@supabase/supabase-js@2';";
 if(!source.includes(original))throw new Error('test adapter must be reviewed after SDK import changes');
 const code=stripTypeScriptTypes(source.replace(original,'').replace(/^export\s+/gm,''));let handler;
 const deno={env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[key]},serve:fn=>handler=fn};
 new Function('Deno','createClient','crypto',code)(deno,()=>sdk,webcrypto);
 const invoke=body=>handler(new Request('https://synthetic.invalid/connector',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 return {state,handler,invoke};
}
