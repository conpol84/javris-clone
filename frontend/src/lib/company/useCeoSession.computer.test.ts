import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({index:0,refIndex:0,states:[] as unknown[],refs:[] as {current:any}[],effects:[] as (()=>void|(()=>void))[],setters:[] as ReturnType<typeof vi.fn>[]}));
const prepare=vi.hoisted(()=>vi.fn());const dispatch=vi.hoisted(()=>vi.fn());const sendChat=vi.hoisted(()=>vi.fn());const listen=vi.hoisted(()=>vi.fn());const recover=vi.hoisted(()=>vi.fn());const journal=vi.hoisted(()=>vi.fn());const histories=vi.hoisted(()=>vi.fn());
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:()=>{const i=fixture.index++;const setter=vi.fn();fixture.setters[i]=setter;return[fixture.states[i],setter]},
 useRef:(initial:unknown)=>{const i=fixture.refIndex++;return fixture.refs[i]??(fixture.refs[i]={current:initial})},
 useEffect:(callback:()=>void|(()=>void))=>fixture.effects.push(callback),useCallback:(callback:unknown)=>callback,
}));
vi.mock('./data',()=>({listAgents:async()=>[],createConversation:vi.fn(),loadOrgSummary:vi.fn()}));
vi.mock('./runner',async original=>({...await original<typeof import('./runner')>(),sendChat}));
vi.mock('./voice',()=>({unlockAudio:vi.fn(),speak:async()=>({status:'completed'}),listenSmart:listen}));
vi.mock('./laptop-bridge',async original=>({...await original<typeof import('./laptop-bridge')>(),prepareDirectComputerCommand:prepare,dispatchDirectComputerCommand:dispatch}));
vi.mock('./computer-continuation',async original=>({...await original<typeof import('./computer-continuation')>(),resolveUnlockContinuation:recover}));
vi.mock('./ceo-device-journal',()=>({journalCeoComputerJob:journal}));
vi.mock('./ceo-sessions',()=>({listCeoSessions:histories,readCeoSession:vi.fn()}));
import {useCeoSession} from './useCeoSession';
import {createConversation} from './data';
import {RunError} from './runner';
import {clearCeoLocalBackup} from './ceo-ollama-backup';

function session(canComputer=true){
 fixture.index=0;fixture.refIndex=0;fixture.effects=[];
 fixture.states=[JSON.stringify(['org','owner','el',true,canComputer]),{id:'ceo',type:'ceo',slug:'ceo'},'idle',[],'',true,false,'',[]];
 const hook=useCeoSession('org','owner','el',key=>key,'briefing',true,canComputer);
 fixture.effects[0]();fixture.refs[6].current=true;return hook;
}
beforeEach(()=>{clearCeoLocalBackup('org','owner','ceo');vi.clearAllMocks();fixture.refs=[];prepare.mockResolvedValue({ready:false,status:'upgrade_required',reply:'Δεν μπήκε εργασία στην ουρά.'});histories.mockResolvedValue([]);journal.mockResolvedValue(true)});
afterEach(()=>vi.unstubAllGlobals());
it('Command/Talk incomplete request reads capabilities and never asks an LLM to queue it',async()=>{
 const hook=session();await hook.ask('mporis na anixis to mac kai na valis tragoudia apo youtube ?');
 expect(prepare).toHaveBeenCalledWith('org',{kind:'desktop_task',description:'mporis na anixis to mac kai na valis tragoudia apo youtube ?',params:{goal:'mporis na anixis to mac kai na valis tragoudia apo youtube ?'}},'el',expect.any(AbortSignal));expect(sendChat).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].text).toContain('Δεν μπήκε εργασία');
});
it('sends a VPS artifact read to server chat without requiring a laptop',async()=>{
 vi.mocked(createConversation).mockResolvedValue({id:'server-conversation'} as Awaited<ReturnType<typeof createConversation>>);
 sendChat.mockResolvedValue({message:{content:'Server response'}});
 const message='Διάβασε από τον VPS το αρχείο:\n/home/jarvis/.openjarvis/firbo-acceptance-7e50xgua/report.md\n\nΔείξε το πραγματικό περιεχόμενό του και την απόδειξη εκτέλεσης της ανάγνωσης. Μην δημιουργήσεις ή αλλάξεις αρχεία. Αν δεν έχεις πρόσβαση, ανέφερε ακριβώς τι εμποδίζει την ανάγνωση.';
 const hook=session();await hook.ask(message);
 expect(sendChat).toHaveBeenCalledExactlyOnceWith('server-conversation',message,'el',true,expect.any(AbortSignal));
 expect(prepare).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].text).toBe('Server response');
});
it('after cloud model_error only the NEXT fresh CEO turn opts into Ollama standby',async()=>{
 vi.mocked(createConversation).mockResolvedValue({id:'ceo-standby-conversation'} as Awaited<ReturnType<typeof createConversation>>);
 sendChat.mockRejectedValueOnce(new RunError('model_error','model_error'))
   .mockResolvedValueOnce({message:{content:'Real local Qwen standby answer'}});
 const hook=session();
 await hook.ask('Original cloud question');
 expect(sendChat).toHaveBeenCalledTimes(1);
 expect(sendChat.mock.calls[0]).toHaveLength(5);
 await hook.ask('New question after cloud outage');
 expect(sendChat).toHaveBeenCalledTimes(2);
 expect(sendChat.mock.calls[1].slice(0,4)).toEqual([
   'ceo-standby-conversation','New question after cloud outage','el',true,
 ]);
 expect(sendChat.mock.calls[1][5]).toEqual({preferLocalBackup:true});
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];
 expect(update([]).at(-1).text).toBe('Real local Qwen standby answer');
});
it('failed Ollama standby does not cause automatic paid replay of that request',async()=>{
 vi.mocked(createConversation).mockResolvedValue({id:'new-fresh-conversation'} as Awaited<ReturnType<typeof createConversation>>);
 sendChat.mockRejectedValueOnce(new RunError('model_error','gateway_http_503'))
   .mockRejectedValueOnce(new RunError('model_error','free_http_503'));
 const hook=session();await hook.ask('Cloud question');await hook.ask('New standby question');
 expect(sendChat).toHaveBeenCalledTimes(2);
 expect(sendChat.mock.calls[1][5]).toEqual({preferLocalBackup:true});
 expect(sendChat.mock.calls[0][1]).toBe('Cloud question');
 expect(sendChat.mock.calls[1][1]).toBe('New standby question');
});

it('refuses incomplete owner-control requests for a non-admin writer',async()=>{
 const hook=session(false);await hook.ask('run AppleScript on Polis1984');expect(prepare).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
});
it('honours one Go for the same ready device and fences a readiness result after Stop',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Chosen Mac',deviceId:'d8'});dispatch.mockResolvedValue({reply:'confirmed'});
 const hook=session();await hook.ask('open Safari');await hook.ask('go nai kanta');
 expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0][1]).toMatchObject({deviceId:'d8',params:{app:'Safari'}});expect(sendChat).not.toHaveBeenCalled();
 let release!:(value:any)=>void;prepare.mockImplementation(()=>new Promise(resolve=>{release=resolve}));
 const asking=hook.ask('open Safari');await Promise.resolve();await Promise.resolve();hook.stop();release({ready:true,deviceName:'Late Mac',deviceId:'late',ownerFullControl:true});await asking;
 expect(dispatch).toHaveBeenCalledOnce();expect(fixture.refs[9].current).toBeNull();
});
it('spoken final text uses the same control lane',async()=>{
 vi.stubGlobal('MediaRecorder',class{});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia:vi.fn()}});
 listen.mockImplementation((_org,_lang,callbacks)=>{callbacks.final('Μπορείς να ανοίξεις το Mac και να βάλεις τραγούδια από YouTube;');return{cancel:vi.fn(),send:vi.fn()}});
 const hook=session();hook.listen();await Promise.resolve();await Promise.resolve();await Promise.resolve();
 expect(prepare).toHaveBeenCalledOnce();expect(sendChat).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();
});

it('native Full Control runs a simple app request without a duplicate approval',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d8',nativeDesktop:true,ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});dispatch.mockResolvedValue({reply:'Observed opened app'});
 const hook=session();await hook.ask('open Microsoft Word');
 expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0][1]).toEqual({kind:'open_app',description:'Open Microsoft Word',params:{app:'Microsoft Word'},deviceId:'d8',requestId:'11111111-1111-4111-8111-111111111111',ownerFullControlRequired:true});expect(sendChat).not.toHaveBeenCalled();
});

it.each(['open browser','Open YouTube and play Μαζωνάκης Ώρες Μικρές'])('owner Full Control runs %s once without an approval prompt',async message=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});dispatch.mockResolvedValue({reply:'Observed result'});
 const hook=session();await hook.ask(message);
 expect(prepare).toHaveBeenCalledOnce();expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0][1]).toMatchObject({deviceId:'d8',requestId:'11111111-1111-4111-8111-111111111111',ownerFullControlRequired:true});expect(sendChat).not.toHaveBeenCalled();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].text).toBe('Observed result');expect(fixture.refs[9].current).toBeNull();
});

it.each(['open browser','open Microsoft Word','Open YouTube and play Μαζωνάκης Ώρες Μικρές'])('guarded native readiness asks before %s and one approval executes the bound request',async message=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d8',nativeDesktop:true,ownerFullControl:false,requestId:'11111111-1111-4111-8111-111111111111'});dispatch.mockResolvedValue({reply:'Observed result'});
 const hook=session();await hook.ask(message);
 expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].text).toContain('Το εγκρίνεις;');
 await hook.ask('approve');expect(prepare).toHaveBeenCalledOnce();expect(dispatch).toHaveBeenCalledOnce();expect(dispatch.mock.calls[0][1]).toMatchObject({deviceId:'d8',requestId:'11111111-1111-4111-8111-111111111111'});expect(dispatch.mock.calls[0][1]).not.toHaveProperty('ownerFullControlRequired');
});

it('keeps a missing central Full Control marker guarded even with native desktop capability',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Debian',deviceId:'d8',nativeDesktop:true});
 const hook=session();await hook.ask('Open YouTube and play Μαζωνάκης Ώρες Μικρές');
 expect(dispatch).not.toHaveBeenCalled();const update=fixture.setters[3].mock.calls.slice(-1)[0][0];expect(update([]).slice(-1)[0].text).toContain('Το εγκρίνεις;');
});

it('passes the explicit Mac target through Talk readiness and the bound approval',async()=>{
 prepare.mockResolvedValue({ready:true,deviceName:'Polis1984',deviceId:'mac'});dispatch.mockResolvedValue({reply:'confirmed'});
 const hook=session();await hook.ask('from mac open chrome');await hook.ask('approve');
 expect(prepare).toHaveBeenCalledWith('org',{kind:'open_app',description:'Open Google Chrome',params:{app:'Google Chrome'},target:'mac'},'el',expect.any(AbortSignal));
 expect(dispatch.mock.calls[0][1]).toMatchObject({target:'mac',deviceId:'mac',params:{app:'Google Chrome'}});expect(sendChat).not.toHaveBeenCalled();
});

it('passes positive Debian command with negative guardrails to dispatcher',async()=>{
 const goal='Εκτέλεσε αποκλειστικά στον υπολογιστή My shell (Debian). Άνοιξε browser. Μην αλλάξεις σε Mac.';
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({reply:'Pending verification'});
 const hook=session();await hook.ask(goal);
 expect(prepare).toHaveBeenCalledOnce();
 expect(dispatch).toHaveBeenCalledOnce();
 expect(dispatch.mock.calls[0][1]).toMatchObject({target:'my shell',deviceId:'d8'});
 expect(sendChat).not.toHaveBeenCalled();
});

it('owner unlock follow-up resumes only latest verified Debian goal through central dispatcher',async()=>{
 const goal='open website youtube and search mazonakis and play the song ores mikres';
 recover.mockResolvedValue({recognized:true,proposal:{kind:'desktop_task',description:goal,params:{goal},target:'My shell',deviceId:'d8'},reply:'resume'});
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({reply:'Job queued; outcome pending'});
 const hook=session();await hook.ask('ok tora einai unlock');
 expect(recover).toHaveBeenCalledWith('org','owner','ok tora einai unlock','el',expect.any(AbortSignal));
 expect(prepare).toHaveBeenCalledOnce();expect(dispatch).toHaveBeenCalledOnce();
 expect(dispatch.mock.calls[0][1]).toMatchObject({kind:'desktop_task',target:'My shell',deviceId:'d8',params:{goal},ownerFullControlRequired:true});
 expect(sendChat).not.toHaveBeenCalled();
});
it('no confirmed owner job after unlock remains in the computer lane, never CEO market sizing',async()=>{
 recover.mockResolvedValue({recognized:true,proposal:null,reply:'Δεν βρέθηκε προηγούμενη εργασία. Δεν μπήκε νέα εργασία στην ουρά.'});
 const hook=session();await hook.ask('ok tora einai unlock');
 expect(recover).toHaveBeenCalledOnce();expect(prepare).not.toHaveBeenCalled();expect(dispatch).not.toHaveBeenCalled();expect(sendChat).not.toHaveBeenCalled();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];expect(update([]).at(-1).text).toContain('Δεν μπήκε');
});
it('Greeklish direct playback after unlock keeps named My shell instead of Mac fallback',async()=>{
 const goal='re to shell einai unlock pexe to tragoudi tou mazonaki ores mikres sto youtube browser';
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({reply:'Queued'});
 const hook=session();await hook.ask(goal);
 expect(recover).not.toHaveBeenCalled();expect(prepare).toHaveBeenCalledOnce();expect(dispatch).toHaveBeenCalledOnce();
 expect(dispatch.mock.calls[0][1]).toMatchObject({target:'my shell',deviceId:'d8',params:{goal}});
 expect(sendChat).not.toHaveBeenCalled();
});

it('durably journals a terminal owner desktop result in the same CEO session',async()=>{
 const jobId='12121212-1212-4212-8212-121212121212',convId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
 vi.mocked(createConversation).mockResolvedValue({id:convId} as Awaited<ReturnType<typeof createConversation>>);
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({status:'failed',job_id:jobId,reply:'Screen locked, goal NOT achieved'});
 const hook=session();await hook.ask('open browser on my shell');
 expect(journal).toHaveBeenCalledExactlyOnceWith(convId,jobId,expect.any(AbortSignal));
 expect(sendChat).not.toHaveBeenCalled();expect(dispatch).toHaveBeenCalledOnce();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];
 expect(update([]).at(-1).text).toBe('Screen locked, goal NOT achieved');
});
it('truthfully discloses when a device job is durable but the separate CEO journal fails',async()=>{
 const jobId='12121212-1212-4212-8212-121212121212';
 vi.mocked(createConversation).mockResolvedValue({id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'} as Awaited<ReturnType<typeof createConversation>>);
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockResolvedValue({status:'done',job_id:jobId,reply:'Device returned observed result'});
 journal.mockRejectedValue(new Error('journal unavailable'));
 const hook=session();await hook.ask('open browser');
 expect(journal).toHaveBeenCalledOnce();expect(sendChat).not.toHaveBeenCalled();
 const update=fixture.setters[3].mock.calls.slice(-1)[0][0];
 expect(update([]).at(-1).text).toContain('δεν καταγράφηκε');
});

it('AI CEO shows genuine worker stage while awaiting the physical result',async()=>{
 const stage={jobId:'15992c52-e6c3-4623-8e71-21206d863175',deviceName:'My shell',stage:'running' as const,elapsedSeconds:8};
 prepare.mockResolvedValue({ready:true,deviceName:'My shell',deviceId:'d8',ownerFullControl:true,requestId:'11111111-1111-4111-8111-111111111111'});
 dispatch.mockImplementation(async(_org,_proposal,_lang,_signal,deps)=>{
  deps.onProgress(stage);
  return{reply:'The worker has not confirmed completion.',status:'queued',job_id:stage.jobId};
 });
 const hook=session();
 await hook.ask('open browser');
 expect(dispatch).toHaveBeenCalledOnce();
 expect(fixture.setters[9]).toHaveBeenCalledWith(stage);
 expect(sendChat).not.toHaveBeenCalled();
});


it('mobile voice/typed CEO keeps Mac failure unqueued and retargets ONLY after owner explicitly says Sto shell',async()=>{
 const id='33333333-3333-4333-8333-333333333333';
 prepare.mockResolvedValueOnce({ready:false,status:'target_unavailable',reply:'Mac connector cannot open Chrome yet; no job queued'})
  .mockResolvedValueOnce({ready:true,deviceId:'linux-device',deviceName:'My shell',ownerFullControl:true,requestId:id});
 dispatch.mockResolvedValue({status:'done',reply:'My shell verified Chrome launch'});
 const hook=session();
 await hook.ask('Sto mac anice ton browse tou chrome');
 expect(prepare).toHaveBeenCalledTimes(1);
 expect(prepare.mock.calls[0][1]).toMatchObject({kind:'open_app',target:'mac',params:{app:'Google Chrome'}});
 expect(dispatch).not.toHaveBeenCalled();
 expect(sendChat).not.toHaveBeenCalled();
 await hook.ask('Sto shell');
 expect(prepare).toHaveBeenCalledTimes(2);
 expect(prepare.mock.calls[1][1]).toEqual({kind:'open_app',description:'Open Google Chrome',params:{app:'Google Chrome'},target:'my shell'});
 expect(dispatch).toHaveBeenCalledTimes(1);
 expect(dispatch.mock.calls[0][1]).toMatchObject({target:'my shell',deviceId:'linux-device',requestId:id,ownerFullControlRequired:true,params:{app:'Google Chrome'}});
 expect(sendChat).not.toHaveBeenCalled();
});

it('Stop clears a failed computer request so bare Sto shell cannot replay older work',async()=>{
 vi.mocked(createConversation).mockResolvedValue({id:'new-regular-chat'} as Awaited<ReturnType<typeof createConversation>>);
 sendChat.mockResolvedValue({message:{content:'Please specify the goal'}});
 prepare.mockResolvedValue({ready:false,status:'target_unavailable',reply:'Mac unavailable'});
 const hook=session();await hook.ask('Sto mac anice ton browse tou chrome');
 hook.stop();
 await hook.ask('Sto shell');
 expect(prepare).toHaveBeenCalledTimes(1);
 expect(dispatch).not.toHaveBeenCalled();
});
