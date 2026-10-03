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
const custom: Record<string, unknown[]> = {
  organization_members:orgs.map(organizations=>({role,user_id:'u1',organization_id:organizations.id,organizations})),
  organizations:orgs, profiles:[{id:'u1',display_name:'Demo owner',locale}],
  conversations, messages,
};
const writes: string[] = [];
Object.assign(window,{__firboM2:{synthetic:true,writes}});
function response(table: string, single: boolean, source: any) {
  if (state === 'loading' && !['organization_members','profiles','organizations'].includes(table)) return new Promise(()=>{});
  if (state === 'error' && !['organization_members','profiles','organizations'].includes(table)) return {data:null,error:{message:'Synthetic read failure'},count:null};
  const rows = state === 'empty' && !['organization_members','profiles','organizations'].includes(table) ? [] : (custom[table] ?? source.data ?? []);
  // Clean old demo labels; never read private company data.
  const safe = JSON.parse(JSON.stringify(rows).replaceAll('Trade Athletes','Demo Company').replaceAll('Constantinos','Demo Owner').replaceAll('owner@tradeathletes.com',email));
  return {data:single ? safe[0] ?? null : safe,error:null,count:safe.length};
}
function from(table:string) {
  let single=false;
  const q: any = {then: (yes:any,no:any) => Promise.resolve(base.from(table)).then(data=>response(table,single,data)).then(yes,no)};
  for (const method of ['select','eq','neq','in','gte','lte','gt','lt','order','limit','is','not','or','range','match','filter','contains','ilike','like','textSearch']) q[method]=()=>q;
  q.single=q.maybeSingle=()=>{single=true;return q;};
  for (const method of ['update','insert','upsert','delete']) q[method]=()=>{writes.push(`${table}.${method}`);return q;};
  return q;
}
const adminCompanies=orgs.map(o=>({...o,status:'active',created_at:date,members:12,agents:28,open_tasks:54,cost30d:1234567890.12,tokens30d:987654321012,runs30d:1234567}));
const totals={companies:2,users:12,agents:28,open_tasks:54,cost30d:1234567890.12,tokens30d:987654321012,runs30d:1234567};
export const COMPANY_ENABLED=true;
export const companyClient={...base,from,
  rpc: (name:string,...args:any[])=>name==='is_platform_admin' ? Promise.resolve({data:role==='owner',error:null}) : (base.rpc as any)(name,...args),
  functions:{invoke:async(name:string)=>{
    if(name!=='admin-overview') {writes.push(`function:${name}`);return {data:null,error:new Error('Execution disabled in fixture')};}
    if(state==='loading') return new Promise(()=>{});
    if(state==='error'||role==='member') return {data:null,error:new FunctionsHttpError(new Response(JSON.stringify({error:role==='member'?'forbidden':'unknown'}),{status:role==='member'?403:500}))};
    return {data:{totals:state==='empty'?Object.fromEntries(Object.keys(totals).map(k=>[k,0])):totals,companies:state==='empty'?[]:adminCompanies,users:state==='empty'?[]:[{id:'u1',email,created_at:date,last_sign_in_at:date}]},error:null};
  }},
  auth:{...base.auth,getSession:async()=>({data:{session:{access_token:'synthetic-not-a-real-token',user:{id:'u1',email}}},error:null}),getUser:async()=>({data:{user:{id:'u1',email}},error:null})},
};
export const requireClient=()=>companyClient as never;
