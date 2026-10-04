import { describe, expect, it } from 'vitest';
import { chooseVoiceLaptop, dispatchLaptopBrowserCommand, parseLaptopBrowserCommand, setVoiceLaptop } from './laptop-bridge';
import type { DeviceRow, JobRow } from './computers';

const now=Date.parse('2026-10-04T10:00:00Z');
const device=(id:string,name='Laptop'):DeviceRow=>({id,name,platform:'Windows',paired:true,last_seen_at:new Date(now-1000).toISOString(),capabilities:{job_kinds:['browser_open']},revoked_at:null,created_at:''});
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
  const out=await dispatchLaptopBrowserCommand('org','άνοιξε το browser','el',undefined,{
   storage:memory(),now:()=>now,loadDevices:async()=>[device('d1')],queue:async()=>({job_id:'j1'}),loadJobs:async()=>[],sleep:async()=>{},
  });
  expect(out.status).not.toBe('done');expect(out.reply).not.toContain('Άνοιξα');
 });
});
