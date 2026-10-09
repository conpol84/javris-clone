// Test-only adapter: executes the actual Edge handler, with auth/PostgREST replaced.
// It does not claim to implement PostgreSQL transactions or Supabase RLS.
import fs from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, webcrypto, randomUUID } from 'node:crypto';
import * as desktopPlanner from '../../../supabase/functions/_shared/desktop-planner.ts';
import * as computerPolicy from '../../../supabase/functions/_shared/computer-policy.ts';
export const TOKEN = 'a'.repeat(64), ORG = '22222222-2222-4222-8222-222222222222', DEVICE = '33333333-3333-4333-8333-333333333333';
export async function makeHandler() {
 const state = { rows: {
  connector_secrets: [{device_id:DEVICE,token_hash:createHash('sha256').update(TOKEN).digest('hex')}],
  connector_devices: [{id:DEVICE,organization_id:ORG,name:'Synthetic laptop',platform:'test',paired:true,capabilities:{},revoked_at:null}],
  organizations:[{id:ORG,plan:'enterprise',plan_status:'active',status:'active'}], connector_jobs: [], organization_members: [], audit_log: [],
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
 const sdk={from:builder,auth:{getUser:async()=>({data:{user:state.user},error:null})},
  rpc:async(name,args)=>{
    if(name==='connector_claim_next_job'){
      state.claims=[...(state.claims??[]),args];
      const row=state.rows.connector_jobs
        .filter(r=>r.organization_id===args.p_org&&r.device_id===args.p_device&&r.status==='queued'&&r.created_at>=args.p_min_created)
        .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)))[0];
      if(!row)return{data:null,error:null};
      row.status='running';row.started_at=new Date().toISOString();
      return{data:{id:row.id,kind:row.kind,params:structuredClone(row.params)},error:null};
    }
    if(name==='connector_finish_execution'){
      const row=state.rows.connector_jobs.find(r=>r.id===args.p_job&&r.device_id===args.p_device&&r.organization_id===args.p_org);
      if(!row)return{data:null,error:{message:'job_not_found'}};
      if(row.status==='running'){
        const fail=state.failures.findIndex(f=>f.table==='connector_jobs'&&f.type==='update');
        if(fail>=0){state.failures.splice(fail,1);return{data:null,error:{message:'synthetic database error'}};}
        row.status=args.p_ok?'done':'error';row.result=args.p_result;row.error=args.p_error;row.report_sha256=args.p_digest;
        row.finished_at=new Date().toISOString();row.receipt={digest:args.p_digest};
        state.writes.push({table:'connector_jobs',matched:1,keys:['status','result','error','report_sha256','finished_at','receipt']});
        return{data:{duplicate:false,receipt:row.receipt},error:null};
      }
      const readFail=state.failures.findIndex(f=>f.table==='connector_jobs'&&f.type==='read');
      if(readFail>=0){state.failures.splice(readFail,1);return{data:null,error:{message:'synthetic database error'}};}
      if(row.status===(args.p_ok?'done':'error')&&row.report_sha256===args.p_digest)return{data:{duplicate:true,receipt:row.receipt},error:null};
      return{data:null,error:{message:'state_conflict'}};
    }
    if(name==='connector_decide_execution'){(state.decisions??=[]).push(args);return{data:null,error:{message:'state_conflict'}};}
    return{data:null,error:{message:'unexpected_rpc'}};
  }};

 const source=await fs.readFile(new URL('../../../supabase/functions/connector/index.ts',import.meta.url),'utf8');
 const original="import { createClient } from 'npm:@supabase/supabase-js@2';";
 if(!source.includes(original))throw new Error('test adapter must be reviewed after SDK import changes');
 const policyImport="import { APP_NAME, browserTaskParams, cleanPolicy } from '../_shared/computer-policy.ts';";
 if(!source.includes(policyImport))throw new Error('test adapter must be reviewed after policy import changes');
 const desktopImport="import { advancedComputerKind, desktopEntitled, desktopAuthorization, planDesktopStep } from '../_shared/desktop-planner.ts';";
 const code=stripTypeScriptTypes(source.replace(original,'').replace(policyImport,'').replace(desktopImport,'').replace(/\bexport\s+(?=(?:const|function)\s)/g,''));let handler;
 const deno={env:{get:key=>({FIRBO_DESKTOP_VISION_MODEL:'synthetic',FIRBO_DESKTOP_PRICE_IN_PER_M:'1',FIRBO_DESKTOP_PRICE_OUT_PER_M:'2',SUPABASE_URL:'https://synthetic.invalid',SUPABASE_ANON_KEY:'synthetic-public',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[key]},serve:fn=>handler=fn};
 new Function('Deno','createClient','crypto','APP_NAME','browserTaskParams','cleanPolicy','advancedComputerKind','desktopEntitled','desktopAuthorization','planDesktopStep',code)(deno,()=>sdk,webcrypto,computerPolicy.APP_NAME,computerPolicy.browserTaskParams,computerPolicy.cleanPolicy,desktopPlanner.advancedComputerKind,desktopPlanner.desktopEntitled,desktopPlanner.desktopAuthorization,desktopPlanner.planDesktopStep);
 const invoke=body=>handler(new Request('https://synthetic.invalid/connector',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));
 return {state,handler,invoke};
}
