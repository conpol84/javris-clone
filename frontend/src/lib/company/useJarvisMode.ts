import { useCallback, useEffect, useState } from 'react';
import { jarvisPreferenceKey, readJarvisAutopilot, writeJarvisAutopilot } from './jarvis-autopilot';

/** One per authenticated company member. Old org or account state cannot leak
 * through an in-flight React render or a second tab.
 */
export function useJarvisMode(orgId:string,userId:string|undefined):{
 enabled:boolean;setEnabled:(on:boolean)=>boolean;
}{
 const key=jarvisPreferenceKey(orgId,userId??'');
 const [state,setState]=useState({key,enabled:readJarvisAutopilot(orgId,userId??'')});
 useEffect(()=>{
  setState({key,enabled:readJarvisAutopilot(orgId,userId??'')});
  const listen=(event:StorageEvent)=>{
   if(event.key===key)setState({key,enabled:readJarvisAutopilot(orgId,userId??'')});
  };
  if(typeof window!=='undefined')window.addEventListener('storage',listen);
  return()=>{if(typeof window!=='undefined')window.removeEventListener('storage',listen);};
 },[key,orgId,userId]);
 const setEnabled=useCallback((on:boolean)=>{
  if(!key||!userId||!writeJarvisAutopilot(orgId,userId,on))return false;
  setState({key,enabled:on});return true;
 },[key,orgId,userId]);
 return{enabled:!!key&&state.key===key&&state.enabled,setEnabled};
}
