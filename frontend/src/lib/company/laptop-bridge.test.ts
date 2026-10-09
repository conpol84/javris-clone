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
  'open http://example.com',
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
 it('keeps the exact approved device, parameters and description across discovery awaits',async()=>{
  const proposal={kind:'open_app' as const,params:{app:'Microsoft Word'},description:'Open Word',deviceId:'d1'};
  let queued:any;
  const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
   storage:memory(),now:()=>now,loadDevices:async()=>{proposal.params.app='Safari';proposal.deviceId='d2';proposal.description='Open Safari';return[device('d1','Approved',true),device('d2','Other',true)]},
   queue:async(deviceId,kind,params)=>(queued={deviceId,kind,params},{job_id:'exact'}),
   loadJobs:async()=>[{id:'exact',device_id:'d1',kind:'open_app',params:{app:'Microsoft Word'},status:'done',result:{opened:true,app:'Microsoft Word'},error:null,created_at:'',finished_at:''} as JobRow],
  });
  expect(queued).toEqual({deviceId:'d1',kind:'open_app',params:{app:'Microsoft Word'}});expect(out.status).toBe('done');expect(out.reply).toContain('Open Word');
 });
 it('rejects completed rows for different parameters or a requested Stop',async()=>{
  const proposal={kind:'browser_task' as const,description:'Legacy browser plan (playback unverified)',params:{steps:[{action:'open',url:'https://www.youtube.com/'}]}};
  for(const mismatch of ['params','stop']){
   const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
    storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Laptop',true)],queue:async()=>({job_id:'exact'}),
    loadJobs:async()=>[{id:'exact',device_id:'d1',kind:'browser_task',params:mismatch==='params'?{steps:[{action:'open',url:'https://example.com/'}]}:proposal.params,cancel_requested_at:mismatch==='stop'?'2026-10-08T00:00:00Z':null,status:'done',result:{completed:true},error:null,created_at:'',finished_at:''} as JobRow],
   });expect(out.status).toBe('failed');expect(out.reply).not.toContain('Done on');
  }
 });
 it('compares JSON objects independently of property order and isolates queue input mutation',async()=>{
  const proposal={kind:'open_app' as const,params:{app:'Microsoft Word',metadata:{a:1,b:2}},description:'Open Word'};
  const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Laptop',true)],queue:async(_d,_k,params)=>{params.app='Safari';return{job_id:'exact'}},
   loadJobs:async()=>[{id:'exact',device_id:'d1',kind:'open_app',params:{metadata:{b:2,a:1},app:'Microsoft Word'},status:'done',result:{opened:true,app:'Microsoft Word'},error:null,created_at:'',finished_at:''} as JobRow],
  });expect(out.status).toBe('done');expect(proposal.params.app).toBe('Microsoft Word');
 });
 it('rejects non-JSON approved parameters before discovery or queueing',async()=>{
  for(const params of [{app:'Word',extra:undefined},{app:'Word',n:NaN},{app:'Word',callback:()=>{}},{app:'Word',value:BigInt(1)}]){
   let discovered=0,queued=0;
   const out=await dispatchDirectComputerCommand('org',{kind:'open_app',params,description:'Open Word'},'en',undefined,{loadDevices:async()=>{discovered++;return[device('d1','Laptop',true)]},queue:async()=>{queued++;return{job_id:'never'}}});
   expect(out.status).toBe('failed');expect(discovered).toBe(0);expect(queued).toBe(0);
  }
 });
 it.each(['win32 x64','linux x64'])('does not misreport a %s capability blocker as Catalina',async platform=>{
  const out=await prepareDirectComputerCommand('org','browser_task','en',undefined,{storage:memory(),now:()=>now,loadDevices:async()=>[{...device('d1','Owner computer'),platform}]});
  expect(out.ready).toBe(false);if(!out.ready){expect(out.reply).toContain('No job was queued');expect(out.reply).not.toMatch(/Catalina|macOS/);}
 });
 it('recognises YouTube search/play and app-open commands without an LLM',()=>{
  const y=parseDirectComputerCommand('anikse to youtube kai vale mazonaki sto serchto proto tragoudi kane play');
  expect(y?.kind).toBe('desktop_task');expect(JSON.stringify(y?.params)).toContain('Mazonaki'.toLowerCase().slice(0,4));
  const liveWording=parseDirectComputerCommand('anixeto youtube vale oikonomopoulo sto serch vr to proto tragoudi varto na pezi');
  expect(liveWording?.kind).toBe('desktop_task');expect(JSON.stringify(liveWording?.params)).toContain('oikonomopoulo');
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
  expect(out.status).toBe('upgrade_required');expect(out.reply).toContain('Polis1984');expect(out.reply).not.toContain('Catalina 10.15');expect(out.reply).toContain('Δεν μπήκε εργασία');
 });
 it('queues one owner-confirmed browser_task and reports done from its durable row',async()=>{
  let queued:any;
  const proposal={kind:'browser_task' as const,description:'Legacy browser plan (playback unverified)',params:{steps:[{action:'open',url:'https://www.youtube.com/'}]}};
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
  const proposal={kind:'browser_task' as const,description:'Legacy browser plan (playback unverified)',params:{steps:[{action:'open',url:'https://www.youtube.com/'}]}};
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
  expect(parseDirectComputerCommand('mporis na anixis to mac kai na valis tragoudia apo youtube ?')).toMatchObject({kind:'desktop_task',params:{goal:'mporis na anixis to mac kai na valis tragoudia apo youtube ?'}});
  expect(parseDirectComputerCommand('mporis na anixis safari')?.params).toEqual({app:'Safari'});
 });
 it('checks the actual online connector before offering approval and makes no mutation',async()=>{
  const out=await prepareDirectComputerCommand('org','browser_task','en',undefined,{loadDevices:async()=>[device('d1','Polis1984')],storage:memory(),now:()=>now});
  expect(out.ready).toBe(false);expect(out).toMatchObject({status:'upgrade_required'});
  if(!out.ready){expect(out.reply).toContain('No job was queued');expect(out.reply).toContain('Catalina');expect(out.reply).not.toContain('run it once');}
 });
 it('uses a capable worker despite an unavailable default Voice laptop',async()=>{
  const store=memory();setVoiceLaptop('org','d1',store);
  const out=await prepareDirectComputerCommand('org','browser_task','en',undefined,{loadDevices:async()=>[device('d1','Polis1984'),device('d2','Another Mac',true)],storage:store,now:()=>now});
  expect(out).toMatchObject({ready:true,deviceId:'d2'});expect(store.getItem('firbo.voice-laptop.v1:org')).toBe('d1');
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
 it('preserves the complete goal for observed playback, without a fixed first-result selector',()=>{
  const proposal=parseDirectComputerCommand('YouTube search Nikos Oikonomopoulos and play first result')!;
  expect(proposal.kind).toBe('desktop_task');expect(proposal.params).toEqual({goal:'YouTube search Nikos Oikonomopoulos and play first result'});expect(proposal.params).not.toHaveProperty('steps');
 });
});


it('never switches a stored unavailable device to another ready laptop, including URL opening',()=>{
 expect(chooseVoiceLaptop([device('other')],'selected',now)).toBeNull();
});

describe('explicit owner device target',()=>{
 const linux=()=>({...device('linux','My shell',true),platform:'linux x64',capabilities:{job_kinds:['browser_open','browser_task','desktop_task'],full_control:true}});
 it.each(['from mac open chrome','open Chrome on my Mac','στο Mac άνοιξε Chrome','άνοιξε Chrome στο Mac'])( 'retains the requested Mac: %s',text=>{
  expect(parseDirectComputerCommand(text)).toMatchObject({kind:'open_app',target:'mac',params:{app:'Google Chrome'}});
 });
 it('does not turn text inside the goal into a device switch',()=>{
  expect(parseDirectComputerCommand('write on mac in the browser search field')?.target).toBeUndefined();
 });
 it('resolves Mac instead of the stored Linux device before approval',async()=>{
  const store=memory();setVoiceLaptop('org','linux',store);
  const proposal=parseDirectComputerCommand('from mac open chrome')!;
  const out=await prepareDirectComputerCommand('org',proposal,'en',undefined,{loadDevices:async()=>[linux(),device('mac','Polis1984',true)],storage:store,now:()=>now});
  expect(out).toMatchObject({ready:true,deviceId:'mac',deviceName:'Polis1984'});
 });
 it.each(['offline','revoked','missing','ambiguous','old'])('does not use Linux when the requested Mac is %s',async state=>{
  const store=memory();setVoiceLaptop('org','linux',store);let queued=0;
  const mac=device('mac','Polis1984',state!=='old');
  if(state==='offline')mac.last_seen_at='2020-01-01T00:00:00Z';
  if(state==='revoked')mac.revoked_at='2026-10-09T00:00:00Z';
  const rows=[linux(),...(state==='missing'?[]:[mac]),...(state==='ambiguous'?[device('mac2','Other Mac',true)]:[])];
  const out=await dispatchDirectComputerCommand('org',parseDirectComputerCommand('from mac open chrome')!,'en',undefined,{loadDevices:async()=>rows,storage:store,now:()=>now,queue:async()=>{queued++;return{job_id:'never'}}});
  expect(out.status).not.toBe('done');expect(out.reply).not.toContain('My shell');expect(queued).toBe(0);
 });
 it('binds dispatch to the explicit target even if the proposal changes during discovery',async()=>{
  const store=memory();setVoiceLaptop('org','linux',store);let queued:any;
  const proposal=parseDirectComputerCommand('from mac open chrome')!;
  const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
   storage:store,now:()=>now,loadDevices:async()=>{proposal.target='debian';return[linux(),device('mac','Polis1984',true)]},
   queue:async(id,kind,params)=>(queued={id,kind,params},{job_id:'macjob'}),
   loadJobs:async()=>[{id:'macjob',device_id:'mac',kind:'open_app',params:{app:'Google Chrome'},status:'done',result:{opened:true,app:'Google Chrome'},error:null,created_at:'',finished_at:''}],
  });
  expect(queued).toEqual({id:'mac',kind:'open_app',params:{app:'Google Chrome'}});expect(out.status).toBe('done');
 });
 it('explains Safari cannot run on the selected Debian, even when native desktop is ready',async()=>{
  const out=await prepareDirectComputerCommand('org',parseDirectComputerCommand('open safari')!,'en',undefined,{storage:memory(),now:()=>now,loadDevices:async()=>[linux()]});
  expect(out).toMatchObject({ready:false,status:'unsupported_app'});if(!out.ready)expect(out.reply).toContain('Safari requires a Mac');
 });
 it('keeps basic browser opening available on a legacy Mac with no Full Control',async()=>{
  const proposal=parseDirectComputerCommand('from mac open browser')!;let queued:any;
  expect(proposal.kind).toBe('browser_open');
  const deps={storage:memory(),now:()=>now,loadDevices:async()=>[linux(),device('mac','Polis1984')]};
  expect(await prepareDirectComputerCommand('org',proposal,'en',undefined,deps)).toMatchObject({ready:true,deviceId:'mac'});
  const out=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{...deps,
   queue:async(id,kind,params)=>(queued={id,kind,params},{job_id:'browserjob'}),
   loadJobs:async()=>[{id:'browserjob',device_id:'mac',kind:'browser_open',params:{url:'https://www.google.com/'},status:'done',result:{launched:true},error:null,created_at:'',finished_at:''}],
  });
  expect(queued).toEqual({id:'mac',kind:'browser_open',params:{url:'https://www.google.com/'}});expect(out.status).toBe('done');
 });
 it('distinguishes a missing capability from disabled Full Control',async()=>{
  const d=linux();d.capabilities.job_kinds=['browser_open','browser_task'];
  const out=await prepareDirectComputerCommand('org',parseDirectComputerCommand('open chrome')!,'en',undefined,{storage:memory(),now:()=>now,loadDevices:async()=>[d]});
  expect(out.ready).toBe(false);if(!out.ready)expect(out.reply).toContain('has local Full Control');
 });
});


describe('CEO device-intent regression: positive task with negative guardrails',()=>{
 const observedGoal="Εκτέλεσε αυτή την εργασία αποκλειστικά στον υπολογιστή My shell (Debian). Άνοιξε browser, επισκέψου το https://example.com και διάβασε την κύρια επικεφαλίδα. Επέστρεψε το πραγματικό URL, την επικεφαλίδα, το job ID, τη συσκευή που εκτέλεσε την εργασία και το τελικό execution receipt. Μην αλλάξεις σε Mac ή άλλον worker. Μη δηλώσεις επιτυχία χωρίς πραγματική παρατήρηση.";
 it('does not cancel an action because its trailing safeguards say Μην / Μη',()=>{
  expect(parseOwnerDecision(observedGoal)).toBeNull();
  expect(parseOwnerDecision('Open the browser on Debian. Do not switch to Mac.')).toBeNull();
  expect(parseOwnerDecision('Άνοιξε browser στο Debian, μην αλλάξεις συσκευή.')).toBeNull();
  expect(parseOwnerDecision('do not open Microsoft Word')).toBe('reject');
  expect(parseOwnerDecision('μην ανοίξεις Microsoft Word')).toBe('reject');
  expect(parseOwnerDecision('Όχι, μην το κάνεις')).toBe('reject');
 });
 it('retains the explicitly targeted My shell identity and exact full goal',()=>{
  const proposal=parseDirectComputerCommand(observedGoal);
  expect(isComputerControlRequest(observedGoal)).toBe(true);
  expect(proposal).toMatchObject({kind:'desktop_task',target:'my shell',description:observedGoal,params:{goal:observedGoal}});
  expect(parseDirectComputerCommand('Run this task exclusively on computer My shell (Debian). Open browser and read example.com.')?.target).toBe('my shell');
  expect(parseDirectComputerCommand('from mac open chrome')?.target).toBe('mac');
  expect(parseDirectComputerCommand('write on mac in the browser search field')?.target).toBeUndefined();
 });
 it('answers an incomplete website-capability question via computer readiness, not invented work',()=>{
  for(const question of ['μπορείς να μπεις σε ένα website ?', 'mporis na mpis se ena website ?', 'Can you visit a website?']){
   expect(isComputerControlRequest(question)).toBe(true);
   expect(parseDirectComputerCommand(question)).toBeNull();
  }
 });
});


it('kind-only requests are incomplete, never malformed live VPS previews',async()=>{
 for(const kind of ['browser_task','desktop_task'] as const){
  const result=await prepareDirectComputerCommand('org',kind,'el');
  expect(result).toMatchObject({ready:false,status:'details_required'});
  if(!result.ready)expect(result.reply).toContain('https://example.com');
 }
});


it('CEO terminal reply exposes actual worker, job id, observed heading and receipt hash',async()=>{
 const goal='Open https://example.com and read heading';
 const proposal={kind:'desktop_task' as const,description:goal,params:{goal},target:'my shell'};
 const machine:DeviceRow={...device('d1','My shell',true),platform:'linux x64',capabilities:{job_kinds:['desktop_task'],full_control:true}};
 const digest='a'.repeat(64);
 const row:JobRow={id:'j-real',device_id:'d1',kind:'desktop_task',params:{goal},status:'done',
  result:{completed:true,summary:'https://example.com — Example Domain',observations:2,last_frame_sha256:'b'.repeat(64)},
  error:null,created_at:'',finished_at:'',report_sha256:digest,
  receipt:{ok:true,job_id:'j-real',device_id:'d1',report_sha256:digest}};
 const result=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
  now:()=>now,loadDevices:async()=>[machine],queue:async()=>({job_id:'j-real'}),loadJobs:async()=>[row],sleep:async()=>{}
 });
 expect(result.status).toBe('done');
 expect(result.reply).toContain('Example Domain');
 expect(result.reply).toContain('Job ID: j-real');
 expect(result.reply).toContain('Worker: My shell (d1)');
 expect(result.reply).toContain('Terminal receipt: matched SHA-256 '+digest);
 row.receipt={...row.receipt,report_sha256:'f'.repeat(64)};
 const invalid=await dispatchDirectComputerCommand('org',proposal,'en',undefined,{
  now:()=>now,loadDevices:async()=>[machine],queue:async()=>({job_id:'j-real'}),loadJobs:async()=>[row],sleep:async()=>{}
 });
 expect(invalid.reply).toContain('not independently confirmed');
});
