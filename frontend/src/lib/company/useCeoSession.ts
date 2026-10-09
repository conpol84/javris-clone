import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { toast } from 'sonner';
import type { HoloState } from '../../components/scenes/HologramScene';
import type { TKey } from '../../i18n/locales/en';
import { createConversation, listAgents, loadOrgSummary } from './data';
import { listCeoSessions, readCeoSession, type CeoSessionPreview } from './ceo-sessions';
import { journalCeoComputerJob } from './ceo-device-journal';
import { RunError, runErrorText, sendChat } from './runner';
import type { AgentRow } from './types';
import { listenSmart, speak, unlockAudio } from './voice';
import { beginVoiceTurn, hologramState, voiceDeadline, type VoiceSnapshot, type VoiceTurn } from './voiceActivity';
import { voiceMessages } from './voiceMessages';
import { isUnlockContinuation, resolveUnlockContinuation } from './computer-continuation';
import { dispatchDirectComputerCommand, dispatchLaptopBrowserCommand, incompleteComputerReply, isComputerControlRequest, parseDirectComputerCommand, parseOwnerDecision, prepareDirectComputerCommand, type DirectComputerProposal } from './laptop-bridge';
import { parseHandoff, type Handoff, type MeetingOffer, type TaskOffer, type WorkSourceOffer } from './handoff';

export interface CeoLine { who:'me'|'ceo'; text:string; ask?:Handoff|null; task?:TaskOffer|null; meet?:MeetingOffer|null; app?:WorkSourceOffer|null }
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
  const [sessions,setSessions]=useState<CeoSessionPreview[]>([]);
  const [activeSessionId,setActiveSessionId]=useState<string|null>(null);
  const [historyLoading,setHistoryLoading]=useState(false);
  const [historyError,setHistoryError]=useState(false);
  const live=useRef(false); const epoch=useRef(0); const turn=useRef<VoiceTurn|null>(null);
  const resumeTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  const busy=useRef(false);const mutedRef=useRef(false);const handsFreeRef=useRef(false);
  const convo=useRef<string|null>(null);const pendingComputer=useRef<DirectComputerProposal|null>(null);const stopListen=useRef(()=>{});const sendListen=useRef(()=>{});
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
    live.current=true;clear();convo.current=null;pendingComputer.current=null;setLoadedScope(scope);setCeo(null);setLines([]);setInterim('');setVoiceStatus('');setVoiceLog([]);setState('idle');setHandsFreeValue(false);
    setSessions([]);setActiveSessionId(null);setHistoryError(false);setHistoryLoading(true);
    const id=epoch.current;
    if(orgId&&userId)void listAgents(orgId).then(async agents=>{
      const found=agents.find(a=>a.enabled&&(a.type==='ceo'||a.slug.startsWith('ceo')))??null;
      if(!valid(id))return;
      if(!found){setHistoryLoading(false);setCeo(null);return;}
      try{
        const previews=await listCeoSessions(orgId,userId,found.id);
        if(!valid(id))return;
        if(previews.length){
          const recovered=await readCeoSession(orgId,userId,found.id,previews[0].id);
          if(!valid(id))return;
          convo.current=previews[0].id;setActiveSessionId(previews[0].id);setLines(recovered);
        }
        setSessions(previews);setHistoryError(false);setCeo(found);
      }catch{
        if(valid(id)){setHistoryError(true);setCeo(found);toast.error(tRef.current('chat.loadError'));}
      }finally{if(valid(id))setHistoryLoading(false);}
    }).catch(()=>{if(valid(id)){setHistoryError(true);setHistoryLoading(false);toast.error(tRef.current('chat.loadError'));}});
    else setHistoryLoading(false);
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
    pendingComputer.current=null;clear();setHandsFreeValue(false);setState('idle');setInterim('');note(voiceMessages(lang).stopped);
  };
  const newSession=()=>{
    if(busy.current||historyLoading||historyError)return;
    pendingComputer.current=null;clear();convo.current=null;setActiveSessionId(null);
    setLines([]);setState('idle');setInterim('');setHistoryError(false);
  };
  const openSession=async(conversationId:string)=>{
    if(!ceo||!userId||busy.current||historyLoading||!sessions.some(x=>x.id===conversationId))return;
    pendingComputer.current=null;clear();setState('idle');setHistoryLoading(true);
    const id=epoch.current;
    try{
      const recovered=await readCeoSession(orgId,userId,ceo.id,conversationId);
      if(!valid(id))return;
      convo.current=conversationId;setActiveSessionId(conversationId);setLines(recovered);setHistoryError(false);
    }catch{if(valid(id)){setHistoryError(true);toast.error(tRef.current('chat.loadError'));}}
    finally{if(valid(id))setHistoryLoading(false);}
  };
  const retryHistory=()=>{
    if(busy.current||historyLoading)return;
    // Reinitialize this personal scope without bypassing the scoped load.
    setHistoryError(false);
    if(!ceo||!userId)return;
    setHistoryLoading(true);
    const id=epoch.current;
    void listCeoSessions(orgId,userId,ceo.id).then(async previews=>{
      if(!valid(id))return;
      if(previews.length){
        const recovered=await readCeoSession(orgId,userId,ceo.id,previews[0].id);
        if(!valid(id))return;
        convo.current=previews[0].id;setActiveSessionId(previews[0].id);setLines(recovered);
      }else{convo.current=null;setActiveSessionId(null);setLines([]);}
      setSessions(previews);
    }).catch(()=>{if(valid(id))setHistoryError(true);}).finally(()=>{if(valid(id))setHistoryLoading(false);});
  };
  const ask=async(message:string)=>{
    if(!ceo||!userId||!canWrite||!message.trim()||busy.current||historyLoading||historyError||loadedScope!==scope)return;
    clearTimeout(resumeTimer.current);stopListen.current();
    const id=++epoch.current;busy.current=true;unlockAudio();
    const active=newTurn(id);active.phase('thinking');
    setInterim('');setLines(lines=>[...lines,{who:'me',text:message}]);
    const sayDirect=async(content:string)=>{
      setLines(lines=>[...lines,{who:'ceo',text:content}]);
      if(mutedRef.current){active.finish();busy.current=false;resume(id,600);return;}
      const spoken=await speak(orgId,content,lang,{turn:active});
      if(!valid(id))return;
      busy.current=false;
      if(spoken.status==='completed'){setState('idle');resume(id,300);}
      else{handsFreeRef.current=false;setHandsFreeValue(false);clearTimeout(resumeTimer.current);setState('idle');if(spoken.status==='failed'){note(voiceMessages(lang).playback);toast.error(voiceMessages(lang).playback);}}
    };
    const sayComputer=async(remote:{reply:string;status?:string;job_id?:string})=>{
      let narrative=remote.reply;
      if(remote.job_id&&['done','failed'].includes(remote.status??'')){
        try{
          if(!convo.current){
            const created=await createConversation(orgId,userId,ceo.id);
            if(!valid(id)||!active.current())return;
            convo.current=created.id;setActiveSessionId(created.id);
          }
          await journalCeoComputerJob(convo.current,remote.job_id,active.signal);
          if(!valid(id)||!active.current())return;
          const items=await listCeoSessions(orgId,userId,ceo.id);
          if(valid(id))setSessions(items);
        }catch{
          narrative+=lang==='el'?' (Η εργασία υπάρχει στους Υπολογιστές, αλλά δεν καταγράφηκε στο ιστορικό CEO.)'
            :' (The job remains in Computers, but CEO chat history could not record it.)';
        }
      }
      await sayDirect(narrative);
    };
    try{
      const unlockNotice=isUnlockContinuation(message);
      const recovered=unlockNotice&&canComputer
        ?await voiceDeadline(signal=>resolveUnlockContinuation(orgId,userId,message,lang,signal),active.signal,24_000)
        :null;
      if(!valid(id)||!active.current())return;
      const proposal=recovered?.recognized&&recovered.proposal?recovered.proposal:parseDirectComputerCommand(message);
      // "ok now unlocked" is NOT a blanket approval for any older pending job.
      const decision=unlockNotice?null:parseOwnerDecision(message);
      const computerRequest=!!proposal||isComputerControlRequest(message)||unlockNotice;
      if(computerRequest&&!canComputer){
        pendingComputer.current=null;
        await sayDirect(lang==='el'?'Ο έλεγχος υπολογιστή απαιτεί Owner/Admin. Δεν μπήκε εργασία στην ουρά.':'Computer control requires Owner/Admin. No job was queued.');return;
      }
      if(canComputer){
        if(unlockNotice&&recovered?.recognized&&!recovered.proposal){
          pendingComputer.current=null;
          await sayDirect(recovered.reply);return;
        }
        if(computerRequest&&decision==='reject'){
          pendingComputer.current=null;await sayDirect(lang==='el'?'Εντάξει, δεν θα το εκτελέσω.':'Okay, I will not run it.');return;
        }
        if(computerRequest&&(!proposal||decision!=='approve')){
          const readiness=await voiceDeadline(signal=>prepareDirectComputerCommand(orgId,proposal??'browser_task',lang,signal),active.signal,24_000);
          if(!valid(id)||!active.current())return;
          if(!readiness.ready||!proposal){
            pendingComputer.current=null;await sayDirect(readiness.ready?incompleteComputerReply(lang):readiness.reply);return;
          }
          if(readiness.ownerFullControl===true){
            pendingComputer.current=null;
            const remote=await dispatchDirectComputerCommand(orgId,{...proposal,deviceId:readiness.deviceId,requestId:readiness.requestId,ownerFullControlRequired:true},lang,active.signal);
            if(!valid(id)||!active.current())return;
            await sayComputer(remote);return;
          }
          pendingComputer.current={...proposal,deviceId:readiness.deviceId,requestId:readiness.requestId};
          await sayDirect(lang==='el'?`Θα εκτελέσω στο ${readiness.deviceName}: ${proposal.description}. Το εγκρίνεις;`:`I will run this on ${readiness.deviceName}: ${proposal.description}. Do you approve?`);return;
        }
        if(proposal&&decision==='approve'){
          pendingComputer.current=null;
          const remote=await dispatchDirectComputerCommand(orgId,proposal,lang,active.signal);
          if(!valid(id)||!active.current())return;
          await sayComputer(remote);return;
        }
        if(pendingComputer.current&&decision){
          const pending=pendingComputer.current;pendingComputer.current=null;
          if(decision==='reject'){await sayDirect(lang==='el'?'Εντάξει, δεν θα το εκτελέσω.':'Okay, I will not run it.');return;}
          const remote=await dispatchDirectComputerCommand(orgId,pending,lang,active.signal);
          if(!valid(id)||!active.current())return;
          await sayComputer(remote);return;
        }
        const remote=await voiceDeadline(signal=>dispatchLaptopBrowserCommand(orgId,message,lang,signal),active.signal,24_000);
        if(!valid(id)||!active.current())return;
        if(remote.handled){await sayComputer({reply:remote.reply??voiceMessages(lang).server,status:remote.status,job_id:remote.job_id});return;}
      }
      if(!convo.current){
        const created=await voiceDeadline(()=>createConversation(orgId,userId,ceo.id),active.signal,30_000);
        if(!valid(id)||!active.current())return;convo.current=created.id;setActiveSessionId(created.id);
      }
      const response=await voiceDeadline(signal=>sendChat(convo.current!,message,lang,true,signal),active.signal,95_000);
      if(!valid(id)||!active.current())return;
      const raw=response?.message?.content;
      if(typeof raw!=='string'||!raw.trim())throw new Error('invalid_chat_response');
      const {text:content,ask:handoff,task,meet,app}=parseHandoff(raw);
      setLines(lines=>[...lines,{who:'ceo',text:content,ask:handoff,task,meet,app}]);
      // Refresh only this user's CEO previews after the server has persisted
      // the completed chat turn. This never turns unverified device claims into memory.
      void listCeoSessions(orgId,userId,ceo.id).then(items=>{if(valid(id))setSessions(items);}).catch(()=>{});
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
      toast.error(runErrorText(t, error));
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
    sendNow:()=>sendListen.current(),muted,setMuted,handsFree:scoped&&handsFree,setHandsFree,canTalk,ask,listen,stop,briefing,
    sessions:scoped?sessions:[],activeSessionId:scoped?activeSessionId:null,historyLoading,historyError,
    openSession,newSession,retryHistory};
}
