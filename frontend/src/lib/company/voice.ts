import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';
import { beginVoiceTurn, stopVoiceActivity, voiceDeadline, type VoiceTurn } from './voiceActivity';
import { voiceMessages } from './voiceMessages';
import { getVoiceProfile, type VoiceProfile } from './voiceProfile';
import { speechAudioBlob } from './speechAudio';
import { getBase } from '../gateway-api';
export { voiceLevel } from './voiceActivity';

const SR_LANG: Record<string, string> = { en:'en-US', el:'el-GR', es:'es-ES', 'pt-BR':'pt-BR', de:'de-DE', fr:'fr-FR', 'zh-CN':'zh-CN', ar:'ar-SA' };
export type VoiceError = 'denied' | 'no_speech' | 'network' | 'other';
export interface VoiceHandle { cancel: () => void; send: () => void }
export interface VoiceCallbacks {
  interim: (text: string) => void; final: (text: string) => void; end: () => void;
  error?: (code: VoiceError | 'server') => void; status?: (message: string) => void;
}
export type SpeechResult = { status:'completed'|'cancelled'|'failed'; source:'server'|'browser'|'none'; truncated:boolean };
interface Options { turn?: VoiceTurn; allowBrowserFallback?: boolean; voiceProfile?: VoiceProfile }
interface RecognitionLike {
  lang:string; interimResults:boolean; continuous:boolean;
  onstart:(() => void)|null; onresult:((e:{results:ArrayLike<ArrayLike<{transcript:string}>&{isFinal:boolean}>})=>void)|null;
  onend:(()=>void)|null; onerror:((e:{error?:string})=>void)|null; onspeechstart?:(()=>void)|null;
  start():void; stop():void; abort?():void;
}
const noop = () => {};
let outputContext: AudioContext | null = null;
function audioContext(): AudioContext {
  const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new Error('audio_unavailable');
  return new Ctor();
}
export function recognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as Record<string, unknown>;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}
/** Call during the user's tap. Failure is handled by playback, never as success. */
export function unlockAudio(): void {
  try { outputContext ??= audioContext(); void outputContext.resume().catch(noop); } catch { /* Text remains available. */ }
}
/** Locally cancel the owned voice turn, including a not-yet-returned audio request. */
export function stopSpeaking(): void { stopVoiceActivity(); }

function outputMeter(el: HTMLAudioElement, turn: VoiceTurn): () => void {
  let source: MediaElementAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let frame = 0;
  const cleanup = () => { cancelAnimationFrame(frame); source?.disconnect(); analyser?.disconnect(); turn.level(0, false); };
  try {
    // Do not reroute an otherwise playable element into a suspended context.
    if (!outputContext || outputContext.state !== 'running') return cleanup;
    analyser = outputContext.createAnalyser(); analyser.fftSize = 256;
    analyser.connect(outputContext.destination);
    source = outputContext.createMediaElementSource(el); source.connect(analyser);
    const bytes = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!turn.current()) return;
      analyser!.getByteTimeDomainData(bytes);
      const rms = Math.sqrt(bytes.reduce((sum, v) => sum + ((v - 128) / 128) ** 2, 0) / bytes.length);
      turn.level(el.paused ? 0 : rms * 7);
      frame = requestAnimationFrame(tick);
    };
    tick();
  } catch { cleanup(); /* No random substitute for a real measurement. */ }
  return cleanup;
}
async function playAudio(blob: Blob, turn: VoiceTurn): Promise<void> {
  const url = URL.createObjectURL(blob);
  const el = new Audio(url);
  let meterStop = noop;
  let started = false;
  try {
    await new Promise<void>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => finish(new Error('audio_timeout')), 100_000);
      const startTimer = setTimeout(() => finish(new Error('audio_start_timeout')), 12_000);
      const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
      function finish(error?: Error) {
        if (done) return;
        done = true; clearTimeout(timer); clearTimeout(startTimer);
        turn.signal.removeEventListener('abort', abort);
        el.onplaying = el.onwaiting = el.onended = el.onerror = null;
        meterStop(); el.pause(); el.removeAttribute('src'); el.load();
        if (error) reject(Object.assign(error, { playbackStarted: started })); else resolve();
      }
      turn.signal.addEventListener('abort', abort, { once:true });
      el.onplaying = () => {
        if (done || !turn.current()) return;
        started = true; clearTimeout(startTimer); turn.phase('speaking', 'server');
      };
      el.onwaiting = () => { if (!done && turn.current()) turn.phase('preparing', 'server'); };
      el.onended = () => finish(started ? undefined : new Error('audio_never_started'));
      el.onerror = () => finish(new Error('audio_playback_failed'));
      if (!turn.current()) return abort();
      meterStop = outputMeter(el, turn);
      try { void el.play().catch(() => finish(new Error('audio_playback_blocked'))); }
      catch { finish(new Error('audio_playback_blocked')); }
    });
  } finally { meterStop(); URL.revokeObjectURL(url); }
}
async function browserSpeech(text: string, lang: string, turn: VoiceTurn): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const synth = window.speechSynthesis;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return reject(new Error('speech_unavailable'));
    let done = false; let started = false;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SR_LANG[lang] ?? 'en-US';
    const want = u.lang.toLowerCase();
    const voices = synth.getVoices();
    const voice = voices.find(v => v.lang.toLowerCase() === want) ?? voices.find(v => v.lang.toLowerCase().startsWith(want.slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 0.96; u.pitch = 0.8;
    const timer = setTimeout(() => finish(new Error('speech_timeout')), 100_000);
    const startTimer = setTimeout(() => finish(new Error('speech_start_timeout')), 12_000);
    const abort = () => finish(new DOMException('Cancelled', 'AbortError'));
    function finish(error?: Error) {
      if (done) return; done = true;
      clearTimeout(timer); clearTimeout(startTimer); turn.signal.removeEventListener('abort', abort);
      u.onstart = u.onend = u.onerror = null;
      if (error) synth.cancel();
      if (error) reject(error); else resolve();
    }
    u.onstart = () => { if (!done && turn.current()) { started = true; clearTimeout(startTimer); turn.phase('speaking', 'browser'); turn.level(0, false); } };
    u.onend = () => finish(started ? undefined : new Error('speech_never_started'));
    u.onerror = () => finish(new Error('speech_playback_failed'));
    turn.signal.addEventListener('abort', abort, { once:true });
    if (!turn.current()) return abort();
    try { synth.speak(u); } catch { finish(new Error('speech_playback_failed')); }
  });
}
/** Result is explicit. A cancelled/failed playback never masquerades as a spoken reply. */
export async function speak(orgId: string, text: string, lang: string, options: Options = {}): Promise<SpeechResult> {
  const turn = options.turn ?? beginVoiceTurn();
  const profile = options.voiceProfile ?? getVoiceProfile();
  const dark = profile === 'firbo-dark-v1';
  const local = profile === 'firbo-local-dark-v1';
  const full = text.replace(/[*_`#>]/g, '').trim(); const clean = full.slice(0, 700);
  const truncated = full.length > clean.length;
  let source: SpeechResult['source'] = 'none';
  if (!turn.current()) return { status:'cancelled', source, truncated };
  if (!orgId || !clean) { turn.finish(true); return { status:'failed', source, truncated }; }
  turn.phase('preparing', 'server');
  try {
    try {
      if (local) {
        try {
          const session=(await requireClient().auth.getSession()).data.session;
          if(!session) throw new Error('sign_in_required');
          const res=await voiceDeadline(signal=>fetch(getBase()+'/v1/firbo/free/speech',{method:'POST',redirect:'error',signal,headers:{Authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},body:JSON.stringify({organization_id:orgId,text:clean,lang})}),turn.signal,35_000);
          if(!res.ok) throw Object.assign(new Error('local_voice_unavailable'),{localStatus:res.status});
          const bytes=new Uint8Array(await res.arrayBuffer());
          if(bytes.length<44||bytes.length>6_000_000||new TextDecoder().decode(bytes.slice(0,4))!=='RIFF'||new TextDecoder().decode(bytes.slice(8,12))!=='WAVE') throw new Error('invalid_local_audio');
          source='server'; await playAudio(new Blob([bytes],{type:'audio/wav'}),turn);
          if (!turn.current()) return { status:'cancelled', source, truncated };
          turn.finish(); return { status:'completed', source, truncated };
        } catch(error) {
          if(!turn.current()) return {status:'cancelled',source,truncated};
          // Zero-API-cost device speech is the only fallback for Local profile.
          // Arabic uses this deliberately until a commercial-safe server model is approved.
          source='browser';turn.phase('preparing','browser');await browserSpeech(clean,lang,turn);
          if(!turn.current()) return {status:'cancelled',source,truncated};
          turn.finish();return {status:'completed',source,truncated};
        }
      }
      const out = await voiceDeadline(signal => requireClient().functions.invoke('agent-speak', { body:{organization_id:orgId,text:clean,voice_profile:profile,...(dark?{audio_format:'wav'}:{})}, signal }), turn.signal, 35_000);
      if (!turn.current()) return { status:'cancelled', source, truncated };
      if (out.error) throw out.error;
      const audio = await voiceDeadline(() => speechAudioBlob(out.data,dark), turn.signal, 3000);
      if (!turn.current()) return { status:'cancelled', source, truncated };
      source = 'server'; await playAudio(audio, turn);
    } catch (error) {
      if (!turn.current()) return { status:'cancelled', source, truncated };
      const status = error instanceof FunctionsHttpError ? error.context.status : 0;
      // Do not bypass authentication/budget/rate limits or repeat a partially spoken reply.
      // A failed server (5xx) must not leave the CEO silent when local browser
      // speech is available. Preserve explicit no-fallback, auth/budget/rate
      // denials and the never-repeat-a-partially-spoken-answer guarantee.
      const serverUnavailable = status >= 500 && status <= 599;
      if ((dark && !serverUnavailable) || options.allowBrowserFallback === false ||
          [401,402,403,429].includes(status) ||
          (error as {playbackStarted?:boolean})?.playbackStarted) throw error;
      source = 'browser'; turn.phase('preparing', 'browser'); await browserSpeech(clean, lang, turn);
    }
    if (!turn.current()) return { status:'cancelled', source, truncated };
    turn.finish(); return { status:'completed', source, truncated };
  } catch {
    if (!turn.current()) return { status:'cancelled', source, truncated };
    turn.finish(true); return { status:'failed', source, truncated };
  }
}

function browserListen(lang: string, on: VoiceCallbacks & { spoke?:()=>void }, turn: VoiceTurn): VoiceHandle {
  const w = window as unknown as Record<string, new () => RecognitionLike>;
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
  let rec: RecognitionLike | undefined;
  let ended = false;
  const timer = setTimeout(() => finish('no_speech'), 30_000);
  const detach = () => {
    clearTimeout(timer); turn.signal.removeEventListener('abort', cancel);
    if (rec) { rec.onresult = rec.onstart = rec.onend = rec.onerror = rec.onspeechstart = null; }
  };
  function cancel() {
    if (ended) return; ended = true; detach();
    try { if (rec?.abort) rec.abort(); else rec?.stop(); } catch { /* Already inactive. */ }
    turn.cancel();
  }
  function finish(error?: VoiceError, text?: string) {
    if (ended || !turn.current()) return;
    ended = true; detach();
    try { rec?.stop(); } catch { /* Already stopped. */ }
    turn.finish(!!error && error !== 'no_speech');
    if (text) on.final(text); else { if (error) on.error?.(error); on.end(); }
  }
  turn.signal.addEventListener('abort', cancel, { once:true });
  if (!turn.current()) { cancel(); return {cancel,send:noop}; }
  if (!Ctor) { finish('other'); return {cancel,send:noop}; }
  try {
    rec = new Ctor(); rec.lang = SR_LANG[lang] ?? 'en-US'; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { if (turn.current()) { turn.phase('listening','browser'); on.status?.(voiceMessages(lang).browserListening); } };
    rec.onspeechstart = () => { if (turn.current()) on.spoke?.(); };
    rec.onresult = event => {
      if (ended || !turn.current()) return;
      let final = ''; let interim = '';
      for (const result of Array.from(event.results)) { if (result.isFinal) final += result[0].transcript; else interim += result[0].transcript; }
      if (final.trim()) finish(undefined, final.trim()); else on.interim(interim);
    };
    rec.onerror = event => finish(['not-allowed','service-not-allowed'].includes(event.error ?? '') ? 'denied' : ['no-speech','aborted'].includes(event.error ?? '') ? 'no_speech' : event.error === 'network' ? 'network' : 'other');
    rec.onend = () => finish();
    rec.start();
  } catch { finish('other'); }
  return {cancel,send:()=>{ if (turn.current() && !ended) { try { rec?.stop(); } catch { finish('other'); } } }};
}
/** Cancellation discards late recognition results; send is available through listenSmart. */
export function listenOnce(lang: string, on: Omit<VoiceCallbacks,'error'> & {error?:(c:VoiceError)=>void;spoke?:()=>void}): () => void {
  const turn = beginVoiceTurn();
  return browserListen(lang, on as VoiceCallbacks, turn).cancel;
}
function pickMime(): string {
  return ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg;codecs=opus'].find(m=>MediaRecorder.isTypeSupported(m)) ?? '';
}
/** Bounded recorded turn. Permission/constructor/stop/upload failures all release the microphone. */
export function recordAndTranscribe(orgId: string, lang: string, on: VoiceCallbacks, options: Options = {}): VoiceHandle {
  const turn = options.turn ?? beginVoiceTurn(); const words = voiceMessages(lang);
  let stream:MediaStream|undefined; let ac:AudioContext|undefined; let input:MediaStreamAudioSourceNode|undefined;
  let rec:MediaRecorder|undefined; let timer:ReturnType<typeof setInterval>|undefined; let stopTimer:ReturnType<typeof setTimeout>|undefined;
  let finished = false; let stopping = false; let sendWanted = false; let forced = false; let spoke = false; let bytes = 0;
  const chunks:Blob[]=[];
  const release = () => {
    clearInterval(timer); input?.disconnect();
    stream?.getTracks().forEach(track=>{track.onended=null;track.stop();});
    if (ac && ac.state !== 'closed') void ac.close().catch(noop);
    turn.level(0, false);
  };
  const detach = () => { clearTimeout(stopTimer); turn.signal.removeEventListener('abort', cancel); if (rec) rec.onstop=rec.onerror=rec.ondataavailable=null; };
  const cancel = () => {
    if (finished) return; finished=true; stopping=true; detach();
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* Release below. */ }
    release(); chunks.length=0; turn.cancel();
  };
  function fail(code:VoiceError|'server') {
    if (finished || !turn.current()) return;
    finished=true; detach(); try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* Release below. */ }
    release(); chunks.length=0; turn.finish(code!=='no_speech');
    on.status?.(code==='denied'?words.permission:code==='no_speech'?words.noSpeech:words.server);
    on.interim(''); on.error?.(code); on.end();
  }
  const finishCapture = (send:boolean) => {
    if (finished || stopping || !rec || !turn.current()) return;
    stopping=true; sendWanted=send; clearInterval(timer);
    stopTimer=setTimeout(()=>fail('other'),3000);
    try { rec.stop(); } catch { fail('other'); }
    release();
  };
  turn.signal.addEventListener('abort',cancel,{once:true});
  void (async()=>{
    if (!turn.current()) return cancel();
    if (!orgId || typeof MediaRecorder==='undefined' || !navigator.mediaDevices?.getUserMedia) return fail('other');
    turn.phase('opening','microphone'); on.status?.(words.opening);
    try {
      const permission=navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});
      // getUserMedia has no abort parameter: release a late grant after cancel/timeout.
      void permission.then(s=>{if(finished||!turn.current())s.getTracks().forEach(t=>t.stop());},noop);
      stream=await voiceDeadline(()=>permission,turn.signal,15_000);
      if(finished||!turn.current()){stream.getTracks().forEach(t=>t.stop());return;}
    } catch(error) {
      if (!turn.current()) return;
      return fail((error as {name?:string})?.name==='NotAllowedError'?'denied':'other');
    }
    try {
      let analyser:AnalyserNode|undefined;
      try { ac=audioContext(); analyser=ac.createAnalyser(); analyser.fftSize=512; input=ac.createMediaStreamSource(stream); input.connect(analyser); void ac.resume().catch(noop); }
      catch { input?.disconnect(); if(ac)void ac.close().catch(noop); ac=undefined; analyser=undefined; }
      const mime=pickMime(); rec=new MediaRecorder(stream,mime?{mimeType:mime}:undefined);
      // Install these BEFORE start/stop, including synchronous failure paths.
      rec.ondataavailable=event=>{ if(finished||!turn.current())return;bytes+=event.data.size;if(bytes>4_000_000)return fail('other');if(event.data.size)chunks.push(event.data); };
      rec.onerror=()=>fail('other');
      rec.onstop=()=>{
        clearTimeout(stopTimer); release();
        if(finished||!turn.current())return;
        if(!sendWanted||(!spoke&&!forced)||!bytes)return fail('no_speech');
        turn.phase('transcribing','server'); on.status?.(words.transcribing);on.interim('…');
        const blob=new Blob(chunks,{type:rec!.mimeType||'audio/webm'});chunks.length=0;
        const form=new FormData();form.append('organization_id',orgId);form.append('lang',lang);
        form.append('audio',blob,blob.type.includes('mp4')?'speech.mp4':blob.type.includes('ogg')?'speech.ogg':'speech.webm');
        void voiceDeadline(signal=>requireClient().functions.invoke('agent-listen',{body:form,signal}),turn.signal,45_000).then(({data,error})=>{
          if(finished||!turn.current())return;
          if(error)throw error;
          const text=typeof data?.text==='string'?data.text.trim():'';
          if(!text)return fail('no_speech');
          finished=true;detach();turn.finish();on.interim('');on.status?.('');on.final(text);
        }).catch(error=>{
          if(finished||!turn.current())return;
          const status=error instanceof FunctionsHttpError?error.context.status:0;
          fail([401,402,403,429].includes(status)?'other':'server');
        });
      };
      stream.getTracks().forEach(track=>{track.onended=()=>{if(!stopping)fail('other');};});
      rec.start(250); turn.phase('listening','microphone');on.status?.(words.listening);
      const start=Date.now();let lastVoice=0;let frames=0;let floor=0.02;let voiced=0;
      const wave=analyser?new Uint8Array(analyser.fftSize):null;
      timer=setInterval(()=>{
        if(finished||stopping||!turn.current())return;
        const now=Date.now();
        if(analyser&&wave&&ac?.state==='running'){
          try { analyser.getByteTimeDomainData(wave); } catch { return fail('other'); }
          const rms=Math.sqrt(wave.reduce((sum,v)=>sum+((v-128)/128)**2,0)/wave.length);frames++;
          if(frames<=8)floor=frames===1?rms:floor*0.7+rms*0.3;
          else if(!spoke)floor=floor*0.98+rms*0.02;
          turn.level(rms*7);
          if(frames>8&&rms>Math.max(0.025,floor*2.8)){lastVoice=now;if(++voiced>=3)spoke=true;}
        }
        if((spoke&&now-lastVoice>1200)||now-start>20_000||(!!analyser&&!spoke&&now-start>9000))finishCapture(true);
      },80);
    } catch { fail('other'); }
  })();
  return {cancel,send:()=>{forced=true;finishCapture(true);}};
}
/** Browser recognition fallback is explicit and opt-in; no silent change of speech service. */
export function listenSmart(orgId:string,lang:string,on:VoiceCallbacks,options:Options={}):VoiceHandle {
  const turn=options.turn??beginVoiceTurn();let handle:VoiceHandle={cancel:noop,send:noop};let off=false;
  const browser=()=>{if(off)return;const next=beginVoiceTurn();handle=browserListen(lang,on,next);};
  const canRecord=typeof MediaRecorder!=='undefined'&&!!navigator.mediaDevices?.getUserMedia;
  if(!canRecord){
    if(options.allowBrowserFallback&&recognitionSupported())browser();
    else {turn.finish(true);on.status?.(voiceMessages(lang).unsupported);on.error?.('other');on.end();}
  } else {
    let error:VoiceError|'server'|undefined;
    handle=recordAndTranscribe(orgId,lang,{...on,error:c=>{error=c;},end:()=>{
      if(off)return;
      if(error==='server'&&options.allowBrowserFallback&&recognitionSupported())browser();
      else {if(error)on.error?.(error);on.end();}
    }},{turn});
  }
  return {cancel:()=>{off=true;handle.cancel();turn.cancel();},send:()=>handle.send()};
}
