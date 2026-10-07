import { describe, expect, it } from 'vitest';
import { chooseVoiceLaptop, dispatchDirectComputerCommand, dispatchLaptopBrowserCommand, isComputerControlRequest, parseDirectComputerCommand, parseLaptopBrowserCommand, parseOwnerDecision, prepareDirectComputerCommand, setVoiceLaptop } from './laptop-bridge';
import type { DeviceRow, JobRow } from './computers';

const now=Date.parse('2026-10-04T10:00:00Z');
const device=(id:string,name='Laptop',full=false):DeviceRow=>({id,name,platform:'darwin x64',paired:true,last_seen_at:new Date(now-1000).toISOString(),capabilities:full?{job_kinds:['browser_open','browser_task','open_app'],full_control:true}:{job_kinds:['browser_open']},agent_policy:full?{enabled:true,control:'full',apps:['Microsoft Word'],shortcuts:[],writes:'auto',commands:'safe',hours:null}:null,revoked_at:null,created_at:''});
const memory=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)}};
const vpsRead='Διάβασε από τον VPS το αρχείο:\n/home/jarvis/.openjarvis/firbo-acceptance-7e50xgua/report.md\n\nΔείξε το πραγματικό περιεχόμενό του και την απόδειξη εκτέλεσης της ανάγνωσης. Μην δημιουργήσεις ή αλλάξεις αρχεία. Αν δεν έχεις πρόσβαση, ανέφερε ακριβώς τι εμποδίζει την ανάγνωση.';

describe('website to laptop browser bridge',()=>{
 it.each([
  vpsRead,
  'Read /home/jarvis/.openjarvis/firbo-acceptance-7e50xgua/report.md from the VPS',
  'Open /home/jarvis/.openjarvis/report.md on the VPS',
  'open ./reports/report.md',
  'open C:\\reports\\report.md',
  'open report.md',
  'Read https://example.com/open/report.md and summarize it',
  'Research example.com',
 ])('does not interpret file paths or embedded verbs as browser commands: %s',input=>{
  expect(parseLaptopBrowserCommand(input)).toBeNull();
 });
 it('leaves the actual VPS request for server chat without device discovery or queueing',async()=>{
  let discovered=0,queued=0;
  const out=await dispatchLaptopBrowserCommand('org',vpsRead,'en',undefined,{
   loadDevices:async()=>{discovered++;return[]},queue:async()=>{queued++;return{job_id:'unexpected'}},
  });
  expect(out).toEqual({handled:false});expect(discovered).toBe(0);expect(queued).toBe(0);
 });
 it.each([
  ['open example.com','https://example.com/'],
  ['open https://example.com/report.md','https://example.com/report.md'],
  ['Άνοιξε το https://example.com/open/report.md','https://example.com/open/report.md'],
  ['browse "example.com/news"','https://example.com/news'],
 ])('preserves explicit browser destinations: %s',(input,url)=>expect(parseLaptopBrowserCommand(input)?.url).toBe(url));
 it('parses an explicit Greek browser command without an LLM',()=>expect(parseLaptopBrowserCommand('Άνοιξε το browser στο example.com')?.url).toBe('https://example.com/'));
 it('keeps ordinary conversation as chat',()=>expect(parseLaptopBrowserCommand('Πες μου τι έγινε σήμερα')).toBeNull());
 it('uses a public start page when browser is requested without a destination',()=>expect(parseLaptopBrowserCommand('άνοιξε το browser εδώ')?.url).toBe('https://www.google.com/'));
 it('auto-selects one ready laptop but requires a stored choice when several are ready',()=>{
  expect(chooseVoiceLaptop([device('d1')],null,now)?.id).toBe('d1');
  expect(chooseVoiceLaptop([device('d1'),device('d2')],null,now)).toBeNull();
 });
 it('routes to the stored Voice laptop and reports success only after the device receipt',async()=>{
  const store=memory();setVoiceLaptop('org','d2',store);let queued:unknown;
  const out=await dispatchLaptopBrowserCommand('org','open browser to example.com','en',undefined,{
   storage:store,now:()=>now,loadDevices:async()=>[device('d1'),device('d2','Work laptop')],
   queue:async(deviceId,kind,params)=>(queued={deviceId,kind,params},{job_id:'j1'}),
   loadJobs:async()=>[{id:'j1',device_id:'d2',kind:'browser_open',params:{url:'https://example.com/'},status:'done',result:{launched:true},error:null,created_at:'',finished_at:''} as JobRow],
   sleep:async()=>{},
  });
  expect(queued).toEqual({deviceId:'d2',kind:'browser_open',params:{url:'https://example.com/'}});
  expect(out.status).toBe('done');expect(out.reply).toContain('Work laptop');
 });
 it('never calls an unconfirmed launch a success',async()=>{
  let clock=now;
  const out=await dispatchLaptopBrowserCommand('org','άνοιξε το browser','el',undefined,{
   storage:memory(),now:()=>clock,loadDevices:async()=>[device('d1')],queue:async()=>({job_id:'j1'}),loadJobs:async()=>[],sleep:async()=>{clock+=20_000},
  });
  expect(out.status).not.toBe('done');expect(out.reply).not.toContain('Άνοιξα');
 });
});

describe('CEO direct Full Control',()=>{
 it('recognises YouTube search/play and app-open commands without an LLM',()=>{
  const y=parseDirectComputerCommand('anikse to youtube kai vale mazonaki sto serchto proto tragoudi kane play');
  expect(y?.kind).toBe('browser_task');expect(JSON.stringify(y?.params)).toContain('Mazonaki'.toLowerCase().slice(0,4));
  const liveWording=parseDirectComputerCommand('anixeto youtube vale oikonomopoulo sto serch vr to proto tragoudi varto na pezi');
  expect(liveWording?.kind).toBe('browser_task');expect(JSON.stringify(liveWording?.params)).toContain('oikonomopoulo');
  expect(parseDirectComputerCommand('Άνοιξε το Microsoft Word')?.kind).toBe('open_app');
 });
 it('treats one natural owner reply as approval or rejection',()=>{
  expect(parseOwnerDecision('ναι το εγκρίνω')).toBe('approve');
  expect(parseOwnerDecision('kanto esi, egkrino')).toBe('approve');
  expect(parseOwnerDecision('ksekina')).toBe('approve');
  expect(parseOwnerDecision('ξεκίνα')).toBe('approve');
  expect(parseOwnerDecision('όχι, μην το κάνεις')).toBe('reject');
  expect(parseOwnerDecision('oxi kanto esi')).toBe('approve');
  expect(parseOwnerDecision('όχι, κάν’ το εσύ')).toBe('approve');
  expect(parseOwnerDecision('no, do it yourself')).toBe('approve');
  expect(parseOwnerDecision('μην το κάνεις, κάντο εσύ')).toBe('reject');
  expect(parseOwnerDecision('do not do it yourself')).toBe('reject');
 });
 it('does not delegate when the Mac is online but still runs the old connector',async()=>{
  const out=await dispatchDirectComputerCommand('org',{kind:'open_app',params:{app:'Microsoft Word'},description:'Open Word'},'el',undefined,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984')],queue:async()=>{throw new Error('must not queue')},loadJobs:async()=>[],sleep:async()=>{},
  });
  expect(out.status).toBe('upgrade_required');expect(out.reply).toContain('Catalina 10.15');expect(out.reply).toContain('Δεν μπήκε εργασία');
 });
 it('queues one owner-confirmed browser_task and reports done from its durable row',async()=>{
  let queued:any;
  const proposal=parseDirectComputerCommand('YouTube search Mazonaki and play first result')!;
  const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984',true)],
   queue:async(deviceId,kind,params,confirm)=>(queued={deviceId,kind,params,confirm},{job_id:'j2'}),
   loadJobs:async()=>[{id:'j2',device_id:'d1',kind:'browser_task',params:proposal.params,status:'done',result:{completed:true},error:null,created_at:'',finished_at:''} as JobRow],
   sleep:async()=>{},
  });
  expect(queued.kind).toBe('browser_task');expect(queued.confirm).toBe(true);expect(out.status).toBe('done');
 });
 it('requests remote Stop if the owner stops a running direct action',async()=>{
  const ac=new AbortController();let cancelled='';let cancels=0;
  const proposal=parseDirectComputerCommand('YouTube search Mazonaki and play first result')!;
  const running=dispatchDirectComputerCommand('org',proposal,'en',ac.signal,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984',true)],
   queue:async()=>({job_id:'j3'}),loadJobs:async()=>{ac.abort();return[{id:'j3',device_id:'d1',kind:'browser_task',params:proposal.params,status:'done',result:{completed:true},error:null,created_at:'',finished_at:''} as JobRow]},cancel:async id=>{cancelled=id;cancels++},sleep:async()=>{},
  });
  await expect(running).rejects.toMatchObject({name:'AbortError'});expect(cancelled).toBe('j3');expect(cancels).toBe(1);
 });
 it('rejects done rows without the matching operation result',async()=>{
  for(const kind of ['browser_task','open_app'] as const){
   const proposal={kind,params:{app:'Microsoft Word'},description:'command'};
   const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
    storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984',true)],queue:async()=>({job_id:'j4'}),
    loadJobs:async()=>[{id:'j4',device_id:'d1',kind,params:proposal.params,status:'done',result:{},error:null,created_at:'',finished_at:''} as JobRow],sleep:async()=>{},
   });
   expect(out.status).toBe('failed');expect(out.reply).not.toContain('Done on');
  }
 });
 it('accepts an app launch only for the requested app on the selected device',async()=>{
  const proposal={kind:'open_app' as const,params:{app:'Microsoft Word'},description:'Open Word'};
  for(const [deviceId,app,status] of [['d1','Microsoft Word','done'],['d2','Microsoft Word','failed'],['d1','Safari','failed']]){
   const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
    storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984',true)],queue:async()=>({job_id:'j5'}),
    loadJobs:async()=>[{id:'j5',device_id:deviceId,kind:'open_app',params:proposal.params,status:'done',result:{opened:true,app},error:null,created_at:'',finished_at:''} as JobRow],sleep:async()=>{},
   });expect(out.status).toBe(status);
  }
 });
});

describe('owner transcript control requests and readiness',()=>{
 it('keeps incomplete Greeklish and spoken Greek actions out of delegated model chat',()=>{
  for(const text of ['mporis na anixis to mac kai na valis tragoudia apo youtube ?', 'Μπορείς να ανοίξεις το Mac και να βάλεις τραγούδια από YouTube;', 'run the prepared AppleScript on Polis1984', 'open Safari'])expect(isComputerControlRequest(text)).toBe(true);
  for(const text of ['Research YouTube music trends', 'How can I run AppleScript on a Mac?', 'Explain Safari automation', 'write a report about computer work', 'what did the company finish?', 'go nai kanta'])expect(isComputerControlRequest(text)).toBe(false);
  expect(parseDirectComputerCommand('mporis na anixis to mac kai na valis tragoudia apo youtube ?')).toBeNull();
  expect(parseDirectComputerCommand('mporis na anixis safari')?.params).toEqual({app:'Safari'});
 });
 it('checks the actual online connector before offering approval and makes no mutation',async()=>{
  const out=await prepareDirectComputerCommand('org','browser_task','en',undefined,{loadDevices:async()=>[device('d1','Polis1984')],storage:memory(),now:()=>now});
  expect(out.ready).toBe(false);expect(out).toMatchObject({status:'upgrade_required'});
  if(!out.ready){expect(out.reply).toContain('No job was queued');expect(out.reply).toContain('Catalina');expect(out.reply).not.toContain('run it once');}
 });
 it('does not switch from the selected unavailable Mac to another ready device',async()=>{
  const store=memory();setVoiceLaptop('org','d1',store);
  const out=await prepareDirectComputerCommand('org','browser_task','en',undefined,{loadDevices:async()=>[device('d1','Polis1984'),device('d2','Another Mac',true)],storage:store,now:()=>now});
  expect(out.ready).toBe(false);
 });
 it('returns the actual device identity for the pending owner confirmation',async()=>{
  const out=await prepareDirectComputerCommand('org','open_app','en',undefined,{loadDevices:async()=>[device('d2','Owner laptop',true)],storage:memory(),now:()=>now});
  expect(out).toEqual({ready:true,deviceId:'d2',deviceName:'Owner laptop'});
 });
 it('rechecks a pending device instead of switching when policy changes before approval',async()=>{
  const store=memory();setVoiceLaptop('org','d2',store);let writes=0;
  const out=await dispatchDirectComputerCommand('org',{kind:'open_app',params:{app:'Safari'},description:'Open Safari',deviceId:'d1'},'en',undefined,{loadDevices:async()=>[device('d1'),device('d2','Other',true)],storage:store,now:()=>now,queue:async()=>{writes++;return{job_id:'never'}}});
  expect(out.status).toBe('upgrade_required');expect(writes).toBe(0);
 });
 it('fences readiness that arrives after Stop or a scope change',async()=>{
  const controller=new AbortController();
  await expect(prepareDirectComputerCommand('org','browser_task','en',controller.signal,{loadDevices:async()=>{controller.abort();return[device('d1','Mac',true)]},storage:memory(),now:()=>now})).rejects.toMatchObject({name:'AbortError'});
 });
 it('does not label a YouTube click plan as verified playback',()=>{
  const proposal=parseDirectComputerCommand('YouTube search Nikos Oikonomopoulos and play first result')!;
  expect(proposal.description).toContain('playback unverified');
 });
});
