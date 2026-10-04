import {companyClient as base} from '../pages/mock-client';
import {FunctionsHttpError} from '@supabase/supabase-js';
const q=new URLSearchParams(location.search),mode=q.get('world')??'linked';
const calls:Record<string,unknown>[]=[];Object.assign(window,{__firboWorld:{calls,synthetic:true}});
const row=(id:string,kind:string,name:string)=>({id,kind,name,organization_id:'org-1',status:'active',config:{read_only:true},last_used_at:'2026-10-03T10:00:00Z',created_at:'2026-10-03T10:00:00Z',last_error:null});
const rows=mode==='empty'?[]:[row('ha-1','homeassistant_devices','Home Assistant · Office'),row('car-1','traccar','Traccar · Family car'),row('yt-1','youtube','YouTube · Creator channel')];
const dataKinds=['youtube','tiktok','salesforce','quickbooks'];
export const COMPANY_ENABLED=true;
export const companyClient={...base,from:(table:string)=>{
 if(table!=='integrations')return base.from(table);
 let org='';const b:any={select:()=>b,order:()=>b,eq:(_key:string,value:string)=>{org=value;return b;},then:(yes:any,no:any)=>Promise.resolve({data:org==='org-1'?rows:[],error:mode==='error'?{message:'Synthetic read failure'}:null}).then(yes,no)};return b;
},functions:{invoke:async(name:string,options?:{body?:Record<string,any>})=>{
 if(name!=='integrations')return base.functions.invoke(name,options);
 const body=options?.body??{};calls.push({action:body.action,id:body.id,kind:body.kind});
 if(body.action==='connection_manifest')return{data:{contract:'firbo-connections/v1',enabled:mode!=='setup',redirect_uri:'https://database.invalid/functions/v1/integrations',server_error:null,providers:dataKinds.map(kind=>({kind,configured:mode!=='setup',enabled:mode!=='setup',scope:'synthetic-scope',environment:['salesforce','quickbooks'].includes(kind)?'sandbox':'production',secret_names:[],read_only:true,broad_provider_scope:['salesforce','quickbooks'].includes(kind)})),bridges:['homeassistant_devices','traccar'].map(kind=>({kind,configured:mode!=='setup',enabled:mode!=='setup',read_only:true}))},error:null};
 if(body.action==='connection_snapshot'){
  await new Promise(r=>setTimeout(r,Number(q.get('read_delay')??0)));
  if(mode==='failure')return{data:null,error:new FunctionsHttpError(new Response('{"error":"provider_failed"}',{status:422}))};
  return{data:{snapshot:{account:'Synthetic allowed source',read_only:true,observed_at:'2026-10-03T10:00:00Z',rows:[{id:'sensor.office',label:'Office temperature',state:'22',unit:'°C',observed_at:'2026-10-03T09:59:55Z',available:true}]}},error:null};
 }
 if(body.action==='connection_start')return{data:{url:'https://accounts.google.com/o/oauth2/v2/auth?state=synthetic'},error:null};
 return{data:null,error:new Error('External changes disabled in this fixture')};
}}};
export const requireClient=()=>companyClient as never;
