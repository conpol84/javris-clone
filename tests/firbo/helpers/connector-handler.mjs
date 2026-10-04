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
 const sdk={from:builder,auth:{getUser:async()=>({data:{user:state.user},error:null})}};
 const source=await fs.readFile(new URL('../../../supabase/functions/connector/index.ts',import.meta.url),'utf8');
 const original="import { createClient } from 'npm:@supabase/supabase-js@2';";
 if(!source.includes(original))throw new Error('test adapter must be reviewed after SDK import changes');
 const code=stripTypeScriptTypes(source.replace(original,''));let handler;
 const deno={env:{get:key=>({SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[key]},serve:fn=>handler=fn};
 new Function('Deno','createClient','crypto',code)(deno,()=>sdk,webcrypto);
 const invoke=body=>handler(new Request('https://synthetic.invalid/connector',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 return {state,handler,invoke};
}
