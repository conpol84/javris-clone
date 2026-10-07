import { describe, expect, it } from 'vitest';
import { chooseVoiceLaptop, dispatchLaptopBrowserCommand, executePreparedLaptopAction, isLaptopActionConfirmation, parseLaptopAutomationCommand, parseLaptopBrowserCommand, prepareLaptopAutomation, setVoiceLaptop } from './laptop-bridge';
import type { DeviceRow, JobRow } from './computers';

const now=Date.parse('2026-10-04T10:00:00Z');
const device=(id:string,name='Laptop'):DeviceRow=>({id,name,platform:'Windows',paired:true,last_seen_at:new Date(now-1000).toISOString(),capabilities:{job_kinds:['browser_open']},revoked_at:null,created_at:''});
const fullDevice=(id:string,name='Polis1984'):DeviceRow=>({...device(id,name),platform:'darwin x64',capabilities:{job_kinds:['browser_open','browser_task'],full_control:true}});
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
 it('turns a YouTube search/play request into a deterministic browser plan',()=>{
  const plan=parseLaptopAutomationCommand('Άνοιξε YouTube, βάλε Μαζωνάκη στο search και παίξε το πρώτο τραγούδι');
  expect(plan?.query).toBe('Μαζωνάκη');
  expect(plan?.params).toEqual({steps:[
   {action:'open',url:'https://www.youtube.com/results?search_query=%CE%9C%CE%B1%CE%B6%CF%89%CE%BD%CE%AC%CE%BA%CE%B7'},
   {action:'click',selector:'ytd-video-renderer a#video-title'},
  ],timeout_ms:120000});
  expect(isLaptopActionConfirmation('ναι')).toBe(true);
  expect(isLaptopActionConfirmation('κάντο')).toBe(true);
 });
 it('does not delegate when the selected Mac still needs the Full Control updater',async()=>{
  const store=memory();setVoiceLaptop('org','d1',store);
  const out=await prepareLaptopAutomation('org','open youtube and play Mazonaki','el',undefined,{storage:store,now:()=>now,loadDevices:async()=>[device('d1','Polis1984')]});
  expect(out.handled).toBe(true);expect(out.status).toBe('setup_required');expect(out.reply).toContain('Mac updater');
 });
 it('asks once, then queues the reviewed browser task and waits for its receipt',async()=>{
  const store=memory();setVoiceLaptop('org','d1',store);
  const prepared=await prepareLaptopAutomation('org','open youtube and play Mazonaki','en',undefined,{storage:store,now:()=>now,loadDevices:async()=>[fullDevice('d1')]});
  expect(prepared.handled).toBe(true);expect(prepared.status).toBe('confirm');
  if(prepared.status!=='confirm'||!prepared.action)throw new Error('missing action');
  let queued:unknown;
  const out=await executePreparedLaptopAction(prepared.action,'en',undefined,{
    orgId:'org',now:()=>now,
    queue:async(deviceId,kind,params,confirm)=>(queued={deviceId,kind,params,confirm},{job_id:'j2'}),
    loadJobs:async()=>[{id:'j2',device_id:'d1',kind:'browser_task',params:prepared.action.params,status:'done',result:{steps:[{step:1,action:'open'},{step:2,action:'click'}]},error:null,created_at:'',finished_at:''} as JobRow],
    sleep:async()=>{},
  });
  expect(queued).toMatchObject({deviceId:'d1',kind:'browser_task',confirm:true});
  expect(out.status).toBe('done');expect(out.reply).toContain('Done on Polis1984');
 });
 it('never calls an unconfirmed launch a success',async()=>{
  let clock=now;
  const out=await dispatchLaptopBrowserCommand('org','άνοιξε το browser','el',undefined,{
   storage:memory(),now:()=>clock,loadDevices:async()=>[device('d1')],queue:async()=>({job_id:'j1'}),loadJobs:async()=>[],sleep:async()=>{clock+=20_000},
  });
  expect(out.status).not.toBe('done');expect(out.reply).not.toContain('Άνοιξα');
 });
});
