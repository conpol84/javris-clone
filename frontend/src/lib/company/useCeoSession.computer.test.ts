import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({index:0,refIndex:0,states:[] as unknown[],refs:[] as {current:any}[],effects:[] as (()=>void|(()=>void))[],setters:[] as ReturnType<typeof vi.fn>[]}));
const prepare=vi.hoisted(()=>vi.fn());const dispatch=vi.hoisted(()=>vi.fn());const sendChat=vi.hoisted(()=>vi.fn());const listen=vi.hoisted(()=>vi.fn());
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:()=>{const i=fixture.index++;const setter=vi.fn();fixture.setters[i]=setter;return[fixture.states[i],setter]},
 useRef:(initial:unknown)=>{const i=fixture.refIndex++;return fixture.refs[i]??(fixture.refs[i]={current:initial})},
 useEffect:(callback:()=>void|(()=>void))=>fixture.effects.push(callback),useCallback:(callback:unknown)=>callback,
}));
vi.mock('./data',()=>({listAgents:async()=>[],createConversation:vi.fn(),loadOrgSummary:vi.fn()}));
vi.mock('./runner',async original=>({...await original<typeof import('./runner')>(),sendChat}));
vi.mock('./voice',()=>({unlockAudio:vi.fn(),speak:async()=>({status:'completed'}),listenSmart:listen}));
vi.mock('./laptop-bridge',async original=>({...await original<typeof import('./laptop-bridge')>(),prepareDirectComputerCommand:prepare,dispatchDirectComputerCommand:dispatch}));
import {useCeoSession} from './useCeoSession';
import {createConversation} from './data';

function session(canComputer=true){
 fixture.index=0;fixture.refIndex=0;fixture.effects=[];
 fixture.states=[JSON.stringify(['org','owner','el',true,canComputer]),{id:'ceo',type:'ceo',slug:'ceo'},'idle',[],'',true,false,'',[]];
 const hook=useCeoSession('org','owner','el',key=>key,'briefing',true,canComputer);
 fixture.effects[0]();fixture.refs[6].current=true;return hook;
}
beforeEach(()=>{vi.clearAllMocks();fixture.refs=[];prepare.mockResolvedValue({ready:false,status:'upgrade_required',reply:'Δεν μπήκε εργασία στην ουρά.'})});
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
