import { useCallback, useEffect, useRef, useState } from 'react';
import { requireClient } from './client';
import { JARVIS_SERVER_MODE } from './jarvis-server-mode';
import { jarvisPreferenceKey, readJarvisAutopilot, writeJarvisAutopilot } from './jarvis-autopilot';

/** The OLD browser-only mode remains for pre-release compatibility. In the
 * new server-owned mode the real authenticated DB setting is authoritative.
 * No localStorage grant can turn on the hosted server.
 */
export function useJarvisMode(orgId:string,userId:string|undefined):{
 enabled:boolean;saving:boolean;loading:boolean;setEnabled:(on:boolean)=>void;
}{
 const key=jarvisPreferenceKey(orgId,userId??'');
 const [state,setState]=useState({
   key,enabled:!JARVIS_SERVER_MODE&&readJarvisAutopilot(orgId,userId??''),
   loading:JARVIS_SERVER_MODE&&!!key,saving:false,
 });
 const alive=useRef(0);
 useEffect(()=>{
   const current=++alive.current;
   const active=()=>current===alive.current;
   setState({key,enabled:!JARVIS_SERVER_MODE&&readJarvisAutopilot(orgId,userId??''),
     loading:JARVIS_SERVER_MODE&&!!key,saving:false});
   if(JARVIS_SERVER_MODE && key&&userId){
     void requireClient().from('jarvis_autopilot_settings')
       .select('enabled').eq('organization_id',orgId).eq('user_id',userId).maybeSingle()
       .then(({data,error})=>{
         if(active())setState({key,enabled:!error&&data?.enabled===true,loading:false,saving:false});
       }).catch(()=>{if(active())setState({key,enabled:false,loading:false,saving:false});});
     return()=>{alive.current++;};
   }
   const listen=(event:StorageEvent)=>{
     if(event.key===key&&active()){
       setState({key,enabled:readJarvisAutopilot(orgId,userId??''),loading:false,saving:false});
     }
   };
   if(typeof window!=='undefined')window.addEventListener('storage',listen);
   return()=>{
     alive.current++;
     if(typeof window!=='undefined')window.removeEventListener('storage',listen);
   };
 },[key,orgId,userId]);
 const setEnabled=useCallback((on:boolean)=>{
   if(!key||!userId||state.key!==key||state.loading||state.saving)return;
   if(!JARVIS_SERVER_MODE){
     if(writeJarvisAutopilot(orgId,userId,on))
       setState({key,enabled:on,loading:false,saving:false});
     return;
   }
   // Never claim enabled until Supabase confirms the exact user's write.
   // Failed or stale RPCs keep the mode OFF rather than silently falling back.
   setState(prev=>({...prev,saving:true}));
   const epoch=alive.current;
   void requireClient().from('jarvis_autopilot_settings')
     .upsert({organization_id:orgId,user_id:userId,enabled:on},
       {onConflict:'organization_id,user_id'})
     .select('enabled').single()
     .then(({data,error})=>{
       if(epoch!==alive.current)return;
       setState({key,enabled:!error&&data?.enabled===true,loading:false,saving:false});
     }).catch(()=>{
       if(epoch===alive.current)setState({key,enabled:false,loading:false,saving:false});
     });
 },[key,orgId,userId,state.key,state.loading,state.saving]);
 const scoped=!!key&&state.key===key;
 return{
   enabled:scoped&&!state.loading&&state.enabled,
   loading:!scoped||state.loading,saving:scoped&&state.saving,setEnabled,
 };
}
