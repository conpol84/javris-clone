// Test-only adapter; never imported by the production Vite config or entrypoint.
import { companyClient as base } from '../../../frontend/preview/mock-client';
import { FunctionsHttpError } from '@supabase/supabase-js';
const params = new URLSearchParams(location.search);
const state = params.get('state') ?? 'loaded';
const locale = params.get('lang') ?? 'en';
const role = params.get('role') === 'member' ? 'member' : 'owner';
const date = '2026-10-01T09:00:00Z';
export const SAMPLE_NAME = 'DemonstrationOrganisationWithAVeryLongUnbrokenNameForReflowTesting';
const email = 'demonstration.account.with.long.label@isolated-example.invalid';
const orgs = [1,2].map(n => ({id:`org-${n}`,name:`${SAMPLE_NAME}${n}`,slug:`demo-${n}`,profile:{onboarded:true},plan:'free'}));
const conversations = Array.from({length:8},(_,n)=>({id:`c${n}`,agent_id:'a1',title:`Demonstration conversation ${n}: ${SAMPLE_NAME}`,created_at:date,updated_at:date}));
const messages = [
  {id:'m1',role:'user',content:'Synthetic UI test. No actual agent was invoked.',created_at:date},
  {id:'m2',role:'assistant',content:'Report: https://example.invalid/' + 'long-unbroken-'.repeat(24) + '\n\n' + 'Sample report text. '.repeat(80),created_at:date},
];
const device = (id:string,paired:boolean,last_seen_at:string|null) => ({id,name:`${SAMPLE_NAME}-${id}`,organization_id:'org-1',platform:'Windows 11 x64',paired,last_seen_at,revoked_at:null,created_at:date});
const devices = [device('d1',true,new Date().toISOString()),device('d2',true,new Date().toISOString()),device('offline',true,date),device('unpaired',false,null)];
const jobs = (id:string) => [
 {id:`${id}-j1`,device_id:id,organization_id:'org-1',kind:'list',params:{path:'C:/Demo/'+'selected-folder-'.repeat(16)},status:'done',result:{entries:[{name:`${id}-result-`+'long-file-name-'.repeat(12),type:'file',size:12345}]},error:null,created_at:date,finished_at:date},
 {id:`${id}-j2`,device_id:id,organization_id:'org-1',kind:'read',params:{path:'C:/Demo/test.txt'},status:'queued',result:null,error:null,created_at:date,finished_at:null},
 {id:`${id}-j3`,device_id:id,organization_id:'org-1',kind:'read',params:{path:'C:/Demo/other.txt'},status:'running',result:null,error:null,created_at:date,finished_at:null},
];
const custom: Record<string, unknown[]> = { connector_devices:devices,connector_jobs:[...jobs('d1'),...jobs('d2')],
  organization_members:orgs.map(organizations=>({role,user_id:'u1',organization_id:organizations.id,organizations})),
  organizations:orgs, profiles:[{id:'u1',display_name:'Demo owner',locale}],
  conversations, messages,
};
const writes: string[] = [];
let activeUser='u1';
const authListeners = new Set<(event:string, session:unknown)=>void>();
const session=()=>({access_token:'synthetic-not-a-real-token',user:{id:activeUser,email}});
Object.assign(window,{__firboM2:{synthetic:true,writes,switchUser:()=>{
 activeUser='u2';custom.organization_members=[{role,user_id:'u2',organization_id:'org-2',organizations:orgs[1]}];
 authListeners.forEach(fn=>fn('SIGNED_IN',session()));
}}});
function response(table: string, single: boolean, source: any, filters: Record<string,unknown>) {
  if (state === 'loading' && !['organization_members','profiles','organizations'].includes(table)) return new Promise(()=>{});
  if (state === 'error' && !['organization_members','profiles','organizations'].includes(table)) return {data:null,error:{message:'Synthetic read failure'},count:null};
  let rows = state === 'empty' && !['organization_members','profiles','organizations'].includes(table) ? [] : (custom[table] ?? source.data ?? []);
  if (table.startsWith('connector_')) rows = (rows as Record<string,unknown>[]).filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v));
  // Clean old demo labels; never read private company data.
  const safe = JSON.parse(JSON.stringify(rows).replaceAll('Trade Athletes','Demo Company').replaceAll('Constantinos','Demo Owner').replaceAll('owner@tradeathletes.com',email));
  return {data:single ? safe[0] ?? null : safe,error:null,count:safe.length};
}
function from(table:string) {
  let single=false; const filters:Record<string,unknown> = {};
  const q: any = {then: (yes:any,no:any) => Promise.resolve(base.from(table)).then(data=>response(table,single,data,filters)).then(yes,no)};
  for (const method of ['select','eq','neq','in','gte','lte','gt','lt','order','limit','is','not','or','range','match','filter','contains','ilike','like','textSearch']) q[method]=()=>q;
  q.eq=(k:string,v:unknown)=>{filters[k]=v;return q;};
  const originalThen=q.then;
  q.then=(yes:any,no:any)=>{const delay=table==='connector_jobs' && filters.device_id==='d1' ? Number(params.get('device_delay')??0) : 0;return new Promise(r=>setTimeout(r,delay)).then(()=>originalThen(yes,no));};
  q.single=q.maybeSingle=()=>{single=true;return q;};
  for (const method of ['update','insert','upsert','delete']) q[method]=()=>{writes.push(`${table}.${method}`);return q;};
  return q;
}
const adminCompanies=orgs.map(o=>({...o,status:'active',created_at:date,members:12,agents:28,open_tasks:54,cost30d:1234567890.12,tokens30d:987654321012,runs30d:1234567}));
const totals={companies:2,users:12,agents:28,open_tasks:54,cost30d:1234567890.12,tokens30d:987654321012,runs30d:1234567};
export const COMPANY_ENABLED=true;
export const companyClient={...base,from,
  rpc: (name:string,...args:any[])=>name==='list_members' ? Promise.resolve({data:[{user_id:'u1',role,full_name:SAMPLE_NAME,email,created_at:date},{user_id:'u2',role:'member',full_name:SAMPLE_NAME+'-Second',email:'second.'+email,created_at:date}],error:null}) : name==='is_platform_admin' ? Promise.resolve({data:role==='owner',error:null}) : (base.rpc as any)(name,...args),
  functions:{invoke:async(name:string, options?:{body?:Record<string,any>})=>{
    if(name==='connector' && params.get('computer_actions')==='1') {
      const b=options?.body??{}; writes.push(`connector:${b.action}`);
      if(role!=='owner')return {data:null,error:new Error('Denied synthetic mutation')};
      if(b.action==='create_device') {await new Promise(r=>setTimeout(r,Number(params.get('pair_delay')??0)));devices.push(device('created',false,null)); return {data:{device_id:'created',code:'DEMO2345'},error:null};}
      if(b.action==='new_code')return {data:{code:'DEMO3456'},error:null};
      if(b.action==='cancel_job')return {data:{ok:true},error:null};
      return {data:null,error:new Error('Synthetic execution and revocation disabled')};
    }

    if(name!=='admin-overview') {writes.push(`function:${name}`);return {data:null,error:new Error('Execution disabled in fixture')};}
    if(state==='loading') return new Promise(()=>{});
    if(state==='error'||role==='member') return {data:null,error:new FunctionsHttpError(new Response(JSON.stringify({error:role==='member'?'forbidden':'unknown'}),{status:role==='member'?403:500}))};
    return {data:{totals:state==='empty'?Object.fromEntries(Object.keys(totals).map(k=>[k,0])):totals,companies:state==='empty'?[]:adminCompanies,users:state==='empty'?[]:[{id:'u1',email,created_at:date,last_sign_in_at:date}]},error:null};
  }},
  auth:{...base.auth,getSession:async()=>({data:{session:session()},error:null}),getUser:async()=>({data:{user:session().user},error:null}),onAuthStateChange:(cb:any)=>{authListeners.add(cb);return {data:{subscription:{unsubscribe:()=>authListeners.delete(cb)}}};}},
};
export const requireClient=()=>companyClient as never;
