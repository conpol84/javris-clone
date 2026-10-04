// Fake data reuses the existing page harness. Only these three fixture endpoints
// may represent voice calls. Real Supabase/provider traffic is blocked by the browser test.
import { companyClient as base } from '../pages/mock-client';
import { FunctionsHttpError } from '@supabase/supabase-js';
export const COMPANY_ENABLED = true;
export const companyClient = {...base, functions:{invoke: async (name:string, options?:{body?:unknown;signal?:AbortSignal})=>{
 if (!['agent-chat','agent-speak','agent-listen'].includes(name)) return base.functions.invoke(name, options as never);
 const body = options?.body instanceof FormData ? options.body : JSON.stringify(options?.body ?? {});
 try {
  const response=await fetch('/__firbo_voice_fixture/'+name,{method:'POST',body,signal:options?.signal});
  if(!response.ok)return {data:null,error:new FunctionsHttpError(response)};
  return {data:name==='agent-speak'?await response.blob():await response.json(),error:null};
 } catch(error){return {data:null,error};}
}}};
export const requireClient=()=>companyClient as never;
