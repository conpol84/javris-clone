import { describe, expect, it } from 'vitest';
import { chooseVoiceLaptop, dispatchDirectComputerCommand, dispatchLaptopBrowserCommand, parseDirectComputerCommand, parseLaptopBrowserCommand, parseOwnerDecision, setVoiceLaptop } from './laptop-bridge';
import type { DeviceRow, JobRow } from './computers';

const now=Date.parse('2026-10-04T10:00:00Z');
const device=(id:string,name='Laptop',full=false):DeviceRow=>({id,name,platform:'darwin x64',paired:true,last_seen_at:new Date(now-1000).toISOString(),capabilities:full?{job_kinds:['browser_open','browser_task','open_app'],full_control:true}:{job_kinds:['browser_open']},agent_policy:full?{enabled:true,control:'full',apps:['Microsoft Word'],shortcuts:[],writes:'auto',commands:'safe',hours:null}:null,revoked_at:null,created_at:''});
const memory=()=>{const map=new Map<string,string>();return{getItem:(k:string)=>map.get(k)??null,setItem:(k:string,v:string)=>map.set(k,v),removeItem:(k:string)=>map.delete(k)}};

describe('website to laptop browser bridge',()=>{
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
  expect(parseDirectComputerCommand('Άνοιξε το Microsoft Word')?.kind).toBe('open_app');
 });
 it('treats one natural owner reply as approval or rejection',()=>{
  expect(parseOwnerDecision('ναι το εγκρίνω')).toBe('approve');
  expect(parseOwnerDecision('kanto esi, egkrino')).toBe('approve');
  expect(parseOwnerDecision('όχι, μην το κάνεις')).toBe('reject');
 });
 it('does not delegate when the Mac is online but still runs the old connector',async()=>{
  const out=await dispatchDirectComputerCommand('org',{kind:'open_app',params:{app:'Microsoft Word'},description:'Open Word'},'el',undefined,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984')],queue:async()=>{throw new Error('must not queue')},loadJobs:async()=>[],sleep:async()=>{},
  });
  expect(out.status).toBe('upgrade_required');expect(out.reply).toContain('Mac updater');
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
  const ac=new AbortController();let cancelled='';
  const proposal=parseDirectComputerCommand('YouTube search Mazonaki and play first result')!;
  const running=dispatchDirectComputerCommand('org',proposal,'en',ac.signal,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1','Polis1984',true)],
   queue:async()=>({job_id:'j3'}),loadJobs:async()=>{ac.abort();return[]},cancel:async id=>{cancelled=id},sleep:async()=>{},
  });
  await expect(running).rejects.toMatchObject({name:'AbortError'});expect(cancelled).toBe('j3');
 });
});
