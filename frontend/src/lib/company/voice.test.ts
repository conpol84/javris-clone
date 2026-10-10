import { setVoiceProfile } from './voiceProfile';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), getSession: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => ({ functions:{ invoke:mocks.invoke }, auth:{ getSession:mocks.getSession } }) }));
import { listenOnce, listenSmart, recordAndTranscribe, speak, stopSpeaking, unlockAudio } from './voice';
import { beginVoiceTurn, getVoiceSnapshot, getServerVoiceSnapshot, hologramState, subscribeVoice, voiceDeadline, voiceLevel } from './voiceActivity';
import { voiceMessageLocales } from './voiceMessages';
const flush = async () => { for(let n=0;n<12;n++)await Promise.resolve(); };
const blob = () => new Blob(['synthetic audio'],{type:'audio/mpeg'});
const localWav = () => { const b=new Uint8Array(48); for(const [at,t] of [[0,'RIFF'],[8,'WAVE']] as const) for(let i=0;i<t.length;i++) b[at+i]=t.charCodeAt(i); return b; };
let playMode:'normal'|'blocked' = 'normal';
class AudioMock {
 static instances:AudioMock[]=[]; paused=true; onplaying:(()=>void)|null=null;onwaiting:(()=>void)|null=null;onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 pause=vi.fn(()=>{this.paused=true;}); removeAttribute=vi.fn(); load=vi.fn();
 constructor(public src:string){AudioMock.instances.push(this);}
 play=vi.fn(()=>playMode==='blocked'?Promise.reject(new Error('blocked')):Promise.resolve());
 start(){this.paused=false;this.onplaying?.();} end(){this.onended?.();} error(){this.onerror?.();}
}
class ContextMock {
 state='running'; resume=vi.fn(async()=>{}); close=vi.fn(async()=>{this.state='closed';});
 createMediaElementSource=vi.fn(()=>({connect:vi.fn(),disconnect:vi.fn()}));
 createMediaStreamSource=vi.fn(()=>({connect:vi.fn(),disconnect:vi.fn()}));
 createAnalyser=vi.fn(()=>({fftSize:256,connect:vi.fn(),disconnect:vi.fn(),getByteTimeDomainData:(b:Uint8Array)=>b.fill(128)}));
 destination={};
}
class RecorderMock {
 static instances:RecorderMock[]=[]; static fail=false;
 static isTypeSupported=()=>true;
 state='inactive';mimeType='audio/webm';onstop:(()=>void)|null=null;onerror:(()=>void)|null=null;ondataavailable:((e:{data:Blob})=>void)|null=null;
 constructor(){if(RecorderMock.fail)throw new Error('codec_failure');RecorderMock.instances.push(this);}
 start=vi.fn(()=>{this.state='recording';});
 stop=vi.fn(()=>{this.state='inactive';this.ondataavailable?.({data:new Blob(['voice'],{type:this.mimeType})});this.onstop?.();});
}
class UtteranceMock { onstart:(()=>void)|null=null;onend:(()=>void)|null=null;onerror:(()=>void)|null=null;lang='';rate=0;pitch=0;constructor(public text:string){} }
let utterance:UtteranceMock|undefined;
const synth={speak:vi.fn((u:UtteranceMock)=>{utterance=u;}),cancel:vi.fn(),getVoices:()=>[]};
let track:{stop:ReturnType<typeof vi.fn>;onended:(()=>void)|null};
let getUserMedia:ReturnType<typeof vi.fn>;
const callbacks=()=>({interim:vi.fn(),final:vi.fn(),end:vi.fn(),error:vi.fn(),status:vi.fn()});
beforeEach(()=>{
 // Retain the original Natural/fallback regression cases; Dark-specific tests follow.
 setVoiceProfile('natural-v1');
 vi.useFakeTimers();vi.clearAllMocks();mocks.invoke.mockReset();mocks.getSession.mockReset();mocks.getSession.mockResolvedValue({data:{session:{access_token:'synthetic-local-session'}}});AudioMock.instances=[];RecorderMock.instances=[];RecorderMock.fail=false;playMode='normal';utterance=undefined;
 track={stop:vi.fn(),onended:null};getUserMedia=vi.fn(async()=>({getTracks:()=>[track]}));
 vi.stubGlobal('window',{...globalThis,location:{hostname:'firboai.app'},AudioContext:ContextMock,speechSynthesis:synth});
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});vi.stubGlobal('Audio',AudioMock);vi.stubGlobal('AudioContext',ContextMock);
 vi.stubGlobal('SpeechSynthesisUtterance',UtteranceMock);vi.stubGlobal('MediaRecorder',RecorderMock);
 vi.stubGlobal('requestAnimationFrame',vi.fn(()=>1));vi.stubGlobal('cancelAnimationFrame',vi.fn());
 vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:synthetic');vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
});
afterEach(()=>{stopSpeaking();vi.clearAllTimers();vi.useRealTimers();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe('owned hologram state',()=>{
 it('fences stale turns and clears measured levels on cancellation',()=>{
  const a=beginVoiceTurn();a.phase('speaking','server');a.level(.8);
  const b=beginVoiceTurn();b.phase('listening','microphone');a.level(1);a.finish();
  expect(a.signal.aborted).toBe(true);expect(getVoiceSnapshot().phase).toBe('listening');expect(voiceLevel.value).toBe(0);
  b.level(.7);b.cancel();expect(voiceLevel.value).toBe(0);expect(getVoiceSnapshot().phase).toBe('idle');
 });
 it('maps actual phase to the existing hologram states',()=>{
  expect(hologramState('preparing')).toBe('thinking');expect(hologramState('transcribing')).toBe('thinking');expect(hologramState('speaking')).toBe('speaking');expect(hologramState('error')).toBe('idle');
 });
 it('does not notify React for every loudness sample',()=>{
  const cb=vi.fn();const off=subscribeVoice(cb);const turn=beginVoiceTurn();turn.phase('listening','microphone');turn.level(.1);const count=cb.mock.calls.length;turn.level(.5);expect(cb).toHaveBeenCalledTimes(count);off();
 });
 it('nonfinite and unavailable amplitude are zero, never random',()=>{
  const turn=beginVoiceTurn();turn.level(NaN);expect(voiceLevel.value).toBe(0);turn.level(.8,false);expect(voiceLevel.value).toBe(0);turn.level(3);expect(voiceLevel.value).toBe(1);
 });
 it('server rendering snapshot stays idle',()=>{const t=beginVoiceTurn();t.phase('speaking');expect(getServerVoiceSnapshot().phase).toBe('idle');});
 it('cancels a hung SDK promise even if transport ignores its signal',async()=>{
  const t=beginVoiceTurn();const p=voiceDeadline(()=>new Promise(()=>{}),t.signal,5000).catch(e=>e.name);t.cancel();expect(await p).toBe('AbortError');
 });
 it('deadlines clean up and abort the actual supplied transport signal',async()=>{
  const t=beginVoiceTurn();let signal:AbortSignal|undefined;const p=voiceDeadline(s=>{signal=s;return new Promise(()=>{});},t.signal,5000).catch(e=>e.message);
  await flush();await vi.advanceTimersByTimeAsync(5001);expect(await p).toBe('voice_timeout');expect(signal?.aborted).toBe(true);
 });
 it('all eight UI dictionaries have matching nonempty labels',()=>{
  expect(Object.keys(voiceMessageLocales)).toHaveLength(8);for(const m of Object.values(voiceMessageLocales)){expect(Object.keys(m).sort()).toEqual(Object.keys(voiceMessageLocales.en).sort());expect(Object.values(m).every(s=>s.trim())).toBe(true);}
 });
});
describe('speech output',()=>{
 it('enters speaking only on actual media start and completes on ended',async()=>{
  mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en',{allowBrowserFallback:false});await flush();
  expect(getVoiceSnapshot().phase).toBe('preparing');const el=AudioMock.instances[0];el.start();expect(getVoiceSnapshot().phase).toBe('speaking');el.end();
  expect((await p).status).toBe('completed');expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:synthetic');expect(el.pause).toHaveBeenCalled();
 });
 it('stop before TTS returns prevents all later playback',async()=>{
  let resolve:(v:unknown)=>void=()=>{};mocks.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));const p=speak('org','Hello','en');await flush();stopSpeaking();
  expect((await p).status).toBe('cancelled');resolve({data:blob(),error:null});await flush();expect(AudioMock.instances).toHaveLength(0);expect(synth.speak).not.toHaveBeenCalled();
 });
 it('stop settles an active playback without waiting for ended',async()=>{
  mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en');await flush();AudioMock.instances[0].start();stopSpeaking();expect((await p).status).toBe('cancelled');expect(getVoiceSnapshot().phase).toBe('idle');
 });
 it('a rejected play is not reported as completed',async()=>{
  playMode='blocked';mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en',{allowBrowserFallback:false});await flush();expect((await p).status).toBe('failed');
 });
 it('does not replay the whole answer via fallback after partially speaking',async()=>{
  mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en');await flush();AudioMock.instances[0].start();AudioMock.instances[0].error();expect((await p).status).toBe('failed');expect(synth.speak).not.toHaveBeenCalled();
 });
 it('browser synthesis is unmetered and only starts on onstart',async()=>{
  mocks.invoke.mockResolvedValue({data:null,error:new Error('unavailable')});const p=speak('org','Hello','en');await flush();expect(getVoiceSnapshot().phase).toBe('preparing');utterance!.onstart?.();expect(getVoiceSnapshot()).toMatchObject({phase:'speaking',source:'browser',measured:false});expect(voiceLevel.value).toBe(0);utterance!.onend?.();expect(await p).toMatchObject({status:'completed',source:'browser'});
 });
 it('browser synthesis error is failed, not completed',async()=>{
  mocks.invoke.mockResolvedValue({data:null,error:new Error('unavailable')});const p=speak('org','Hello','en');await flush();utterance!.onerror?.();expect((await p).status).toBe('failed');
 });
 it('stop cancels browser synthesis even if the engine never sends onend',async()=>{
  mocks.invoke.mockResolvedValue({data:null,error:new Error('unavailable')});const p=speak('org','Hello','en');await flush();utterance!.onstart?.();stopSpeaking();expect((await p).status).toBe('cancelled');expect(synth.cancel).toHaveBeenCalled();
 });
 it.each([401,402,403])('does not bypass authorization or plan status %s with another voice service',async(status)=>{
  mocks.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(new Response('{}',{status}))});const p=speak('org','Hello','en');await flush();expect((await p).status).toBe('failed');expect(synth.speak).not.toHaveBeenCalled();
 });
 it('recovers cloud TTS 429 via labeled zero-cost browser speech, with no provider retry',async()=>{
  setVoiceProfile('firbo-dark-v1');
  mocks.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(new Response('{"error":"rate_limited"}',{status:429}))});
  const p=speak('org','Cloud voice at limit','en');
  await flush();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(synth.speak).toHaveBeenCalledTimes(1);
  expect(getVoiceSnapshot().source).toBe('browser');
  utterance!.onstart?.();utterance!.onend?.();
  expect(await p).toMatchObject({status:'completed',source:'browser'});
 });
 it('respects explicit no-local-fallback on rate limit',async()=>{
  setVoiceProfile('firbo-dark-v1');
  mocks.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(new Response('{"error":"rate_limited"}',{status:429}))});
  const result=await speak('org','Rate limited','en',{allowBrowserFallback:false});
  expect(result.status).toBe('failed');
  expect(synth.speak).not.toHaveBeenCalled();
 });
 it('rejects nonaudio data rather than playing an HTML fallback',async()=>{
  mocks.invoke.mockResolvedValue({data:new Blob(['html'],{type:'text/html'}),error:null});const p=speak('org','Hello','en',{allowBrowserFallback:false});await flush();expect((await p).status).toBe('failed');expect(AudioMock.instances).toHaveLength(0);
 });
 it('a replaced speech turn cannot reset the new one',async()=>{
  let resolve:(v:unknown)=>void=()=>{};mocks.invoke.mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValueOnce({data:blob(),error:null});
  const first=speak('org','First','en');await flush();const second=speak('org','Second','en');await flush();const el=AudioMock.instances[0];el.start();resolve({data:blob(),error:null});await flush();expect((await first).status).toBe('cancelled');expect(getVoiceSnapshot().phase).toBe('speaking');expect(AudioMock.instances).toHaveLength(1);el.end();expect((await second).status).toBe('completed');
 });
 it('has a bounded wait for a silent media element',async()=>{
  mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en',{allowBrowserFallback:false});await flush();await vi.advanceTimersByTimeAsync(12001);expect((await p).status).toBe('failed');expect(URL.revokeObjectURL).toHaveBeenCalled();
 });
 it('reports truncation and retains the server text limit',async()=>{
  mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','x'.repeat(800),'en');await flush();AudioMock.instances[0].start();AudioMock.instances[0].end();expect((await p).truncated).toBe(true);expect(mocks.invoke.mock.calls[0][1].body.text.length).toBe(700);
 });
 it('uses a real analyser when available and disconnects on cancellation',async()=>{
  unlockAudio();mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en');await flush();AudioMock.instances[0].start();stopSpeaking();await p;expect(voiceLevel.value).toBe(0);expect(cancelAnimationFrame).toHaveBeenCalled();
 });
});
describe('Talk to CEO local Piper recovery (no paid TTS replay)',()=>{
  const limited=()=>new FunctionsHttpError(new Response('{"error":"rate_limited"}',{status:429}));
  it('tries the authorized fixed local Piper service once after cloud 429 before device speech',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:limited()});
    const localFetch=vi.fn(async(_input:RequestInfo|URL,_options?:RequestInit)=>new Response(localWav(),{status:200,headers:{'content-type':'audio/wav'}}));
    vi.stubGlobal('fetch',localFetch);
    const result=speak('owner-org','Γεια σου','el',{allowLocalFallback:true});
    await vi.advanceTimersByTimeAsync(1); await flush();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(String(localFetch.mock.calls[0]?.[0])).toContain('/v1/firbo/free/speech');
    const opts=localFetch.mock.calls[0]?.[1] as RequestInit;
    expect(opts.method).toBe('POST');
    expect(opts.redirect).toBe('error');
    expect((opts.headers as Record<string,string>).Authorization).toBe('Bearer synthetic-local-session');
    expect(JSON.parse(String(opts.body))).toMatchObject({organization_id:'owner-org',lang:'el'});
    expect(synth.speak).not.toHaveBeenCalled();
    expect(AudioMock.instances).toHaveLength(1);
    AudioMock.instances[0].start();AudioMock.instances[0].end();
    expect(await result).toMatchObject({status:'completed',source:'server'});
  });
  it('unavailable local Piper uses browser voice without a second cloud TTS request',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:limited()});
    const localFetch=vi.fn(async()=>new Response('unavailable',{status:503}));
    vi.stubGlobal('fetch',localFetch);
    const result=speak('owner-org','Local is offline','en',{allowLocalFallback:true});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(localFetch).toHaveBeenCalledTimes(1);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    utterance!.onstart?.();utterance!.onend?.();
    expect(await result).toMatchObject({status:'completed',source:'browser'});
  });
  it('hard auth denial never tries local Piper or browser voice',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(new Response('{}',{status:403}))});
    const localFetch=vi.fn();vi.stubGlobal('fetch',localFetch);
    const result=await speak('owner-org','Protected','en',{allowLocalFallback:true});
    expect(result.status).toBe('failed');
    expect(localFetch).not.toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
  });
  it('Stop cancels a pending local Piper request without late audio or fallback',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:limited()});
    let release:(res:Response)=>void=()=>{};
    const localFetch=vi.fn(()=>new Promise<Response>(resolve=>{release=resolve;}));
    vi.stubGlobal('fetch',localFetch);
    const result=speak('owner-org','Stop','en',{allowLocalFallback:true});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(localFetch).toHaveBeenCalledTimes(1);
    stopSpeaking();
    expect((await result).status).toBe('cancelled');
    release(new Response(localWav(),{headers:{'content-type':'audio/wav'}}));await flush();
    expect(AudioMock.instances).toHaveLength(0);expect(synth.speak).not.toHaveBeenCalled();
  });
  it('a partially played local voice cannot be repeated by the browser',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:limited()});
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(localWav(),{headers:{'content-type':'audio/wav'}})));
    const result=speak('owner-org','Only once','en',{allowLocalFallback:true});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(AudioMock.instances).toHaveLength(1);
    AudioMock.instances[0].start();AudioMock.instances[0].error();
    expect((await result).status).toBe('failed');
    expect(synth.speak).not.toHaveBeenCalled();
  });
  it('caps local WAV bytes before allocation and falls back to browser only',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:limited()});
    const tooLarge=new Uint8Array(6_000_001);
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(tooLarge,{headers:{'content-type':'audio/wav'}})));
    const result=speak('owner-org','oversized local audio','en',{allowLocalFallback:true});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(AudioMock.instances).toHaveLength(0);
    expect(synth.speak).toHaveBeenCalledTimes(1);
    utterance!.onstart?.();utterance!.onend?.();
    expect(await result).toMatchObject({status:'completed',source:'browser'});
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('Stop also cancels a pending session lookup before any local request',async()=>{
    setVoiceProfile('firbo-dark-v1');
    mocks.invoke.mockResolvedValue({data:null,error:limited()});
    mocks.getSession.mockImplementationOnce(()=>new Promise(()=>{}));
    const localFetch=vi.fn();vi.stubGlobal('fetch',localFetch);
    const result=speak('owner-org','pending session','en',{allowLocalFallback:true});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
    stopSpeaking();
    expect((await result).status).toBe('cancelled');
    expect(localFetch).not.toHaveBeenCalled();
    expect(synth.speak).not.toHaveBeenCalled();
  });
  it('manual local voice cannot replay a partially spoken sentence after playback error',async()=>{
    setVoiceProfile('firbo-local-dark-v1');
    vi.stubGlobal('fetch',vi.fn(async()=>new Response(localWav(),{headers:{'content-type':'audio/wav'}})));
    const result=speak('owner-org','Once in Local mode','en');
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(AudioMock.instances).toHaveLength(1);
    AudioMock.instances[0].start();AudioMock.instances[0].error();
    expect((await result).status).toBe('failed');
    expect(synth.speak).not.toHaveBeenCalled();
  });
});

describe('microphone lifecycle',()=>{
 it('records, stops hardware, transcribes once and returns the final text',async()=>{
  mocks.invoke.mockResolvedValue({data:{text:'Synthetic transcript'},error:null});const on=callbacks();const h=recordAndTranscribe('org','en',on);await flush();expect(getVoiceSnapshot().phase).toBe('listening');h.send();h.send();await flush();expect(track.stop).toHaveBeenCalled();expect(mocks.invoke).toHaveBeenCalledTimes(1);expect(on.final).toHaveBeenCalledExactlyOnceWith('Synthetic transcript');expect(on.end).not.toHaveBeenCalled();
 });
 it('cancel during microphone permission discards the late grant',async()=>{
  let resolve:(v:unknown)=>void=()=>{};getUserMedia.mockImplementation(()=>new Promise(r=>{resolve=r;}));const on=callbacks();const h=recordAndTranscribe('org','en',on);await flush();h.cancel();resolve({getTracks:()=>[track]});await flush();expect(track.stop).toHaveBeenCalled();expect(RecorderMock.instances).toHaveLength(0);expect(mocks.invoke).not.toHaveBeenCalled();expect(on.final).not.toHaveBeenCalled();expect(on.error).not.toHaveBeenCalled();
 });
 it('permission timeout releases a later grant',async()=>{
  let resolve:(v:unknown)=>void=()=>{};getUserMedia.mockImplementation(()=>new Promise(r=>{resolve=r;}));const on=callbacks();recordAndTranscribe('org','en',on);await flush();await vi.advanceTimersByTimeAsync(15001);expect(on.error).toHaveBeenCalledExactlyOnceWith('other');resolve({getTracks:()=>[track]});await flush();expect(track.stop).toHaveBeenCalled();
 });
 it('denied microphone never invokes an alternate provider',async()=>{
  getUserMedia.mockRejectedValue(new DOMException('No','NotAllowedError'));const on=callbacks();listenSmart('org','en',on);await flush();expect(on.error).toHaveBeenCalledExactlyOnceWith('denied');expect(on.end).toHaveBeenCalledTimes(1);expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('recorder construction failure closes the already acquired stream',async()=>{
  RecorderMock.fail=true;const on=callbacks();recordAndTranscribe('org','en',on);await flush();expect(track.stop).toHaveBeenCalled();expect(on.error).toHaveBeenCalledTimes(1);expect(getVoiceSnapshot().phase).toBe('error');
 });
 it('cancel during transcription suppresses a late transcript and all follow-up actions',async()=>{
  let resolve:(v:unknown)=>void=()=>{};mocks.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));const on=callbacks();const h=recordAndTranscribe('org','en',on);await flush();h.send();await flush();h.cancel();resolve({data:{text:'Too late'},error:null});await flush();expect(on.final).not.toHaveBeenCalled();expect(on.error).not.toHaveBeenCalled();expect(mocks.invoke.mock.calls[0][1].signal.aborted).toBe(true);
 });
 it('recorder errors release the stream and terminate once',async()=>{
  const on=callbacks();recordAndTranscribe('org','en',on);await flush();const r=RecorderMock.instances[0];const fail=r.onerror;fail?.();fail?.();expect(track.stop).toHaveBeenCalled();expect(on.error).toHaveBeenCalledTimes(1);expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('empty transcription is no speech rather than a fake answer',async()=>{
  mocks.invoke.mockResolvedValue({data:{text:'   '},error:null});const on=callbacks();const h=recordAndTranscribe('org','en',on);await flush();h.send();await flush();expect(on.final).not.toHaveBeenCalled();expect(on.error).toHaveBeenCalledExactlyOnceWith('no_speech');
 });
 it('caps recording bytes before any server upload',async()=>{
  const on=callbacks();recordAndTranscribe('org','en',on);await flush();RecorderMock.instances[0].ondataavailable?.({data:new Blob([new Uint8Array(4_000_001)])});await flush();expect(track.stop).toHaveBeenCalled();expect(mocks.invoke).not.toHaveBeenCalled();expect(on.error).toHaveBeenCalledTimes(1);
 });
 it('silent recordings time out without submitting audio',async()=>{
  const on=callbacks();recordAndTranscribe('org','en',on);await flush();await vi.advanceTimersByTimeAsync(9200);expect(on.error).toHaveBeenCalledExactlyOnceWith('no_speech');expect(mocks.invoke).not.toHaveBeenCalled();
 });
 it('server failure never silently starts browser recognition by default',async()=>{
  const ctor=vi.fn();Object.assign(window,{SpeechRecognition:ctor});mocks.invoke.mockResolvedValue({data:null,error:new Error('failed')});const on=callbacks();const h=listenSmart('org','en',on);await flush();h.send();await flush();expect(on.error).toHaveBeenCalledExactlyOnceWith('server');expect(ctor).not.toHaveBeenCalled();
 });
 it('a stopped recognition ignores final results arriving later',async()=>{
  let rec:any;class Recognition {onresult:any;onstart:any;onend:any;onerror:any;start(){}stop(){}abort(){}constructor(){rec=this;}}
  Object.assign(window,{SpeechRecognition:Recognition});const on=callbacks();const stop=listenOnce('en',on);const late=rec.onresult;stop();late({results:[Object.assign([{transcript:'late'}],{isFinal:true})]});expect(on.final).not.toHaveBeenCalled();
 });
});

describe('deployed speech transport compatibility',()=>{
  it('live octet-stream MP3 parsed by the real SDK uses server playback',async()=>{
    const { createClient } = await import('@supabase/supabase-js');
    // ID3 header is envelope evidence, not an assertion this tiny fixture decodes.
    const bytes = new Uint8Array([73,68,51,4,0,0,0,0,0,0,255,251,144,0]);
    const transport=vi.fn(async(_url:RequestInfo|URL,_options?:RequestInit)=>new Response(bytes,{headers:{'content-type':'application/octet-stream'}}));
    const sdk=createClient('https://voice-contract.invalid','sb_publishable_synthetic',{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:transport}
    });
    mocks.invoke.mockImplementation((name,options)=>sdk.functions.invoke(name,options));
    const result=speak('synthetic-org','Transport contract check','en',{allowBrowserFallback:false});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(AudioMock.instances).toHaveLength(1);
    const delivered=vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(delivered.type).toBe('audio/mpeg');
    expect(new Uint8Array(await delivered.arrayBuffer())).toEqual(bytes);
    AudioMock.instances[0].start();AudioMock.instances[0].end();
    expect(await result).toMatchObject({status:'completed',source:'server'});
    expect(transport).toHaveBeenCalledTimes(1);
    expect(String(transport.mock.calls[0]?.[0])).toContain('/functions/v1/agent-speak');
    expect(synth.speak).not.toHaveBeenCalled();
  });
  it('raw MPEG frame with octet-stream type retains server playback',async()=>{
    mocks.invoke.mockResolvedValue({data:new Blob([new Uint8Array([255,251,144,0,1,2,3,4])],{type:'application/octet-stream'}),error:null});
    const result=speak('org','Test','en',{allowBrowserFallback:false});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect(AudioMock.instances).toHaveLength(1);
    AudioMock.instances[0].start();AudioMock.instances[0].end();
    expect(await result).toMatchObject({status:'completed',source:'server'});
  });
  it('HTML hidden in an octet-stream body is not audio',async()=>{
    mocks.invoke.mockResolvedValue({data:new Blob(['<!DOCTYPE html><html>error</html>'],{type:'application/octet-stream'}),error:null});
    const result=speak('org','Test','en',{allowBrowserFallback:false});
    await vi.advanceTimersByTimeAsync(1);await flush();
    expect((await result).status).toBe('failed');
    expect(AudioMock.instances).toHaveLength(0);expect(synth.speak).not.toHaveBeenCalled();
  });
  it('Stop fences a late binary-envelope read without playing it',async()=>{
    let deliver:(data:ArrayBuffer)=>void=()=>{};
    const data=new Blob([new Uint8Array([255,251,144,0])],{type:'application/octet-stream'});
    vi.spyOn(data,'slice').mockReturnValue({arrayBuffer:()=>new Promise<ArrayBuffer>(r=>{deliver=r;})} as Blob);
    mocks.invoke.mockResolvedValue({data,error:null});
    const result=speak('org','Test','en',{allowBrowserFallback:false});await flush();stopSpeaking();
    expect((await result).status).toBe('cancelled');deliver(new ArrayBuffer(12));await flush();
    expect(AudioMock.instances).toHaveLength(0);expect(synth.speak).not.toHaveBeenCalled();
  });
});


describe('explicit Dark preset',()=>{
 const darkWave=()=>{const b=new Uint8Array(48),v=new DataView(b.buffer);for(const [at,s] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']] as const){for(let i=0;i<s.length;i++)b[at+i]=s.charCodeAt(i);}v.setUint32(4,40,true);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,24000,true);v.setUint32(28,48000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(40,4,true);return new Blob([b],{type:'application/octet-stream'});};
 it('requests the processed preset and plays a valid server WAV',async()=>{setVoiceProfile('firbo-dark-v1');mocks.invoke.mockResolvedValue({data:darkWave(),error:null});const p=speak('org','Hello','en');await flush();expect(mocks.invoke.mock.calls[0][1].body).toMatchObject({voice_profile:'firbo-dark-v1',audio_format:'wav'});const el=AudioMock.instances[0];expect(el).toBeDefined();el.start();el.end();expect((await p).status).toBe('completed');});
 it('does not disguise browser synthesis as Firbo Dark on a server error',async()=>{setVoiceProfile('firbo-dark-v1');mocks.invoke.mockResolvedValue({data:null,error:new Error('down')});const p=speak('org','Hello','en');await flush();expect((await p).status).toBe('failed');expect(synth.speak).not.toHaveBeenCalled();});
 it('falls back to labeled browser speech on server 502, without claiming Dark synthesis',async()=>{setVoiceProfile('firbo-dark-v1');mocks.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(new Response('{}',{status:502}))});const p=speak('org','Hello','en');await flush();expect(synth.speak).toHaveBeenCalledTimes(1);utterance!.onstart?.();utterance!.onend?.();expect(await p).toMatchObject({status:'completed',source:'browser'});});
 it('rejects an old MP3 response instead of calling it the processed Dark voice',async()=>{setVoiceProfile('firbo-dark-v1');mocks.invoke.mockResolvedValue({data:blob(),error:null});const p=speak('org','Hello','en');await flush();expect((await p).status).toBe('failed');expect(AudioMock.instances).toHaveLength(0);expect(synth.speak).not.toHaveBeenCalled();});
 it('can Stop a pending Dark response without late playback',async()=>{setVoiceProfile('firbo-dark-v1');let resolve:(v:unknown)=>void=()=>{};mocks.invoke.mockImplementation(()=>new Promise(r=>{resolve=r;}));const p=speak('org','Hello','en');await flush();stopSpeaking();expect((await p).status).toBe('cancelled');resolve({data:darkWave(),error:null});await flush();expect(AudioMock.instances).toHaveLength(0);});
});
