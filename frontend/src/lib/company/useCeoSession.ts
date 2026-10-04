import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { HoloState } from '../../components/scenes/HologramScene';
import type { TKey } from '../../i18n/locales/en';
import { createConversation, listAgents, loadOrgSummary } from './data';
import { RunError, sendChat } from './runner';
import type { AgentRow } from './types';
import { listenSmart, speak, unlockAudio } from './voice';
import { beginVoiceTurn, hologramState, voiceDeadline, type VoiceSnapshot, type VoiceTurn } from './voiceActivity';
import { voiceMessages } from './voiceMessages';
import { dispatchLaptopBrowserCommand } from './laptop-bridge';

export interface CeoLine { who:'me'|'ceo'; text:string }
/** Voice and typed turns share one conversation. Stop fences late UI/media results;
 * it does not claim that already-started server inference/work was interrupted.
 */
export function useCeoSession(orgId:string,userId:string|undefined,lang:string,t:(key:TKey,vars?:Record<string,string|number>)=>string,briefingText:string,canWrite=true,canComputer=false) {
  const scope=JSON.stringify([orgId,userId,lang,canWrite,canComputer]);
  const scopeRef=useRef(scope); scopeRef.current=scope;
  const [loadedScope,setLoadedScope]=useState(scope);
  const [ceo,setCeo]=useState<AgentRow|null>(null);
  const [state,setState]=useState<HoloState>('idle');
  const [lines,setLines]=useState<CeoLine[]>([]);
  const [interim,setInterim]=useState('');
  const [muted,setMutedValue]=useState(false);
  const [handsFree,setHandsFreeValue]=useState(false);
  const [voiceStatus,setVoiceStatus]=useState('');
  const [voiceLog,setVoiceLog]=useState<string[]>([]);
  const live=useRef(false); const epoch=useRef(0); const turn=useRef<VoiceTurn|null>(null);
  const resumeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const busy=useRef(false);const mutedRef=useRef(false);const handsFreeRef=useRef(false);
  const convo=useRef<string|null>(null);const stopListen=useRef(()=>{});const sendListen=useRef(()=>{});
  const listenRef=useRef(()=>{}); const tRef=useRef(t);tRef.current=t;
  const canTalk=typeof MediaRecorder!=='undefined' && typeof navigator!=='undefined' && !!navigator.mediaDevices?.getUserMedia;
  const valid=(id:number)=>live.current&&scopeRef.current===scope&&epoch.current===id;
  const note=(message:string)=>{setVoiceStatus(message);if(message)setVoiceLog(log=>[...log.slice(-7),message]);};
  const clear = () => {
    epoch.current++;busy.current=false;clearTimeout(resumeTimer.current);
    handsFreeRef.current=false;stopListen.current();turn.current?.cancel();
    stopListen.current=()=>{};sendListen.current=()=>{};
  };
  useEffect(()=>{
    live.current=true;clear();convo.current=null;setLoadedScope(scope);setCeo(null);setLines([]);setInterim('');setVoiceStatus('');setVoiceLog([]);setState('idle');setHandsFreeValue(false);
    const id=epoch.current;
    if(orgId&&userId)void listAgents(orgId).then(agents=>{
      if(valid(id))setCeo(agents.find(a=>a.enabled&&(a.type==='ceo'||a.slug.startsWith('ceo')))??null);
    }).catch(()=>{if(valid(id))toast.error(tRef.current('chat.loadError'));});
    return ()=>{live.current=false;clear();};
    // Translation labels are read via refs; language is part of the explicit scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope]);

  const setHandsFree=useCallback((value:SetStateAction<boolean>)=>{
    const next=typeof value==='function'?value(handsFreeRef.current):value;
    handsFreeRef.current=next;setHandsFreeValue(next);
    if(!next)clearTimeout(resumeTimer.current);
  },[]);
  const setMuted=useCallback((value:SetStateAction<boolean>)=>{
    const next=typeof value==='function'?value(mutedRef.current):value;
    mutedRef.current=next;setMutedValue(next);
    if(next){
      // Do not cancel a pending text answer. Only prevent/stop speech output.
      if(turn.current&&['speaking','preparing'].includes(phaseRef.current)) {
        epoch.current++;turn.current.cancel();busy.current=false;setState('idle');setVoiceStatus(voiceMessages(lang).stopped);
        handsFreeRef.current=false;setHandsFreeValue(false);clearTimeout(resumeTimer.current);
      }
    }
  },[lang]);
  const phaseRef=useRef<VoiceSnapshot['phase']>('idle');
  const newTurn=(id:number)=>{
    const next=beginVoiceTurn(s=>{
      if(!valid(id))return;
      phaseRef.current=s.phase;setState(hologramState(s.phase));
      const words=voiceMessages(lang);
      if(s.phase==='error')return; // Caller provides the actionable error text.
      if(s.phase==='idle'){setVoiceStatus('');return;}
      note(s.source==='browser'?(s.phase==='speaking'?words.browserVoice:words.browserListening):words[s.phase]);
    });
    turn.current=next;return next;
  };
  const resume=(id:number,delay:number)=>{
    clearTimeout(resumeTimer.current);
    if(!handsFreeRef.current||!canTalk)return;
    resumeTimer.current=setTimeout(()=>{if(valid(id)&&handsFreeRef.current&&!busy.current)listenRef.current();},delay);
  };
  const stop=()=>{
    clear();setHandsFreeValue(false);setState('idle');setInterim('');note(voiceMessages(lang).stopped);
  };
  const ask=async(message:string)=>{
    if(!ceo||!userId||!canWrite||!message.trim()||busy.current||loadedScope!==scope)return;
    clearTimeout(resumeTimer.current);stopListen.current();
    const id=++epoch.current;busy.current=true;unlockAudio();
    const active=newTurn(id);active.phase('thinking');
    setInterim('');setLines(lines=>[...lines,{who:'me',text:message}]);
    try{
      if(canComputer){
        const remote=await voiceDeadline(signal=>dispatchLaptopBrowserCommand(orgId,message,lang,signal),active.signal,24_000);
        if(!valid(id)||!active.current())return;
        if(remote.handled){
          const content=remote.reply??voiceMessages(lang).server;
          setLines(lines=>[...lines,{who:'ceo',text:content}]);
          if(mutedRef.current){active.finish();busy.current=false;resume(id,600);return;}
          const spoken=await speak(orgId,content,lang,{turn:active});
          if(!valid(id))return;
          busy.current=false;
          if(spoken.status==='completed'){setState('idle');resume(id,300);}
          else{
            handsFreeRef.current=false;setHandsFreeValue(false);clearTimeout(resumeTimer.current);setState('idle');
            if(spoken.status==='failed'){note(voiceMessages(lang).playback);toast.error(voiceMessages(lang).playback);}
          }
          return;
        }
      }
      if(!convo.current){
        const created=await voiceDeadline(()=>createConversation(orgId,userId,ceo.id),active.signal,30_000);
        if(!valid(id)||!active.current())return;convo.current=created.id;
      }
      const response=await voiceDeadline(signal=>sendChat(convo.current!,message,lang,true,signal),active.signal,95_000);
      if(!valid(id)||!active.current())return;
      const content=response?.message?.content;
      if(typeof content!=='string'||!content.trim())throw new Error('invalid_chat_response');
      setLines(lines=>[...lines,{who:'ceo',text:content}]);
      if(mutedRef.current){active.finish();busy.current=false;resume(id,600);return;}
      const result=await speak(orgId,content,lang,{turn:active});
      if(!valid(id))return;
      busy.current=false;
      if(result.status==='completed'){setState('idle');resume(id,300);}
      else {
        handsFreeRef.current=false;setHandsFreeValue(false);clearTimeout(resumeTimer.current);setState('idle');
        if(result.status==='failed'){note(voiceMessages(lang).playback);toast.error(voiceMessages(lang).playback);}
      }
    }catch(error){
      if(!valid(id))return;
      busy.current=false;handsFreeRef.current=false;setHandsFreeValue(false);setState('idle');
      if(active.signal.aborted){note(voiceMessages(lang).stopped);return;}
      active.finish(true);note(voiceMessages(lang).server);
      toast.error(t(`run.err.${error instanceof RunError?error.code:'unknown'}` as TKey));
    }
  };
  const listen=()=>{
    if(!ceo||!userId||!canWrite||!canTalk||loadedScope!==scope)return;
    clearTimeout(resumeTimer.current);stopListen.current();
    const id=++epoch.current;busy.current=true;setInterim('');unlockAudio();
    const active=newTurn(id);let heard=false;let failed=false;
    const handle=listenSmart(orgId,lang,{
      status:message=>{if(valid(id))note(message);},
      interim:text=>{if(valid(id))setInterim(text);},
      final:text=>{
        if(!valid(id))return;heard=true;busy.current=false;setInterim('');
        if(text)void ask(text);else setState('idle');
      },
      error:code=>{
        if(!valid(id))return;
        // Permission/transport failures must not create an endless microphone loop.
        failed=true;handsFreeRef.current=false;setHandsFreeValue(false);
        if(code!=='no_speech')toast.error(t(`voice.err.${code}` as TKey));
      },
      end:()=>{
        if(!valid(id))return;busy.current=false;setInterim('');setState('idle');
        if(!heard&&!failed)resume(id,350);
      },
    },{turn:active});
    stopListen.current=handle.cancel;sendListen.current=handle.send;
  };
  listenRef.current=listen;
  const briefing=async()=>{
    if(!ceo||!canWrite)return;
    const id=epoch.current;let facts='';
    try{const summary=await loadOrgSummary(orgId,false);if(!valid(id))return;facts=`Facts: ${summary.agents} active AI employees, ${summary.openTasks} open tasks, ${summary.approvals} approvals waiting for me.`;}catch{/* Keep the existing greeting; never fabricate facts. */}
    if(valid(id))await ask(`${briefingText}. ${facts}`);
  };
  const scoped=loadedScope===scope;
  return {ceo:scoped?ceo:null,state:scoped?state:'idle' as HoloState,lines:scoped?lines:[],interim:scoped?interim:'',voiceStatus:scoped?voiceStatus:'',voiceLog:scoped?voiceLog:[],
    sendNow:()=>sendListen.current(),muted,setMuted,handsFree:scoped&&handsFree,setHandsFree,canTalk,ask,listen,stop,briefing};
}
