import { describe, expect, it } from 'vitest';
import { isUnlockContinuation, resolveUnlockContinuation } from './computer-continuation';
import type { DeviceRow, JobRow } from './computers';
import { isComputerControlRequest, parseDirectComputerCommand } from './laptop-bridge';

const NOW=Date.parse('2026-10-09T16:34:00Z');
const goal='open website youtube and search mazonakis and play the song ores mikres';
const digest='a'.repeat(64);
const machine:DeviceRow={
 id:'c40d6e28-bc44-44cb-b883-aeb2e3ac4b6f',name:'My shell',platform:'linux x64',paired:true,
 last_seen_at:new Date(NOW-6000).toISOString(),revoked_at:null,created_at:'',
 capabilities:{job_kinds:['list','read','write','exec','browser_open','browser_task','desktop_task'],full_control:true},
 agent_policy:{enabled:true,control:'full',apps:[],shortcuts:[],writes:'off',commands:'off',hours:null}
};
const job=():JobRow=>({
 id:'c2bcec20-ba01-49ca-888e-6609c21480f6',device_id:machine.id,kind:'desktop_task',
 status:'done',params:{goal},origin:'owner',error:null,created_at:new Date(NOW-300000).toISOString(),
 finished_at:new Date(NOW-120000).toISOString(),
 result:{completed:false,summary:'Screen black with light-locker active. Need owner unlock session.'},
 receipt:{ok:true,job_id:'c2bcec20-ba01-49ca-888e-6609c21480f6',device_id:machine.id,report_sha256:digest},
 report_sha256:digest,
});

describe('CEO desktop unlock continuation — real user wording',()=>{
 it('recognizes a lock-state acknowledgement, not an arbitrary unlock instruction',()=>{
  for(const text of ['ok tora einai unlock','OK τώρα είναι unlock','now it is unlocked','το shell είναι ξεκλείδωτο'])
   expect(isUnlockContinuation(text)).toBe(true);
  for(const text of ['unlock the computer','what is unlock','re to shell einai unlock pexe to tragoudi',
   'unlock somebody else','ok start a market analysis','please unlock the Mac'])
   expect(isUnlockContinuation(text)).toBe(false);
 });
 it('binds one new task to exactly the recent owner job and same company worker',async()=>{
  let scoped:{org?:string;user?:string}={};
  const result=await resolveUnlockContinuation('org-A','owner-A','ok tora einai unlock','el',undefined,{
   now:()=>NOW,latestOwnerJob:async(org,user)=>{scoped={org,user};return job();},devices:async()=>[machine]
  });
  expect(scoped).toEqual({org:'org-A',user:'owner-A'});
  expect(result).toMatchObject({
   recognized:true,proposal:{kind:'desktop_task',description:goal,target:'My shell',
    deviceId:machine.id,params:{goal}}
  });
  if(result.recognized)expect(result.reply).toContain('My shell');
 });
 it('never resumes a job with stale, mismatched or incomplete evidence',async()=>{
  const broken:[string,(row:JobRow)=>void][]=[
   ['stale',j=>{j.finished_at=new Date(NOW-3600000).toISOString()}],
   ['already successful',j=>{j.result={completed:true,summary:'Done'}}],
   ['different device receipt',j=>{j.receipt={...j.receipt,device_id:'wrong'}}],
   ['hash mismatch',j=>{j.report_sha256='f'.repeat(64)}],
   ['unrelated user action',j=>{j.params={goal:'delete files'}}],
   ['not locked',j=>{j.result={completed:false,summary:'Provider unavailable'}}],
   ['pending job',j=>{j.status='running'}],
   ['wrong origin',j=>{j.origin='agent'}],
  ];
  for(const [name,mutate] of broken){const row=job();mutate(row);
   const result=await resolveUnlockContinuation('org','owner','ok tora einai unlock','en',undefined,{
    now:()=>NOW,latestOwnerJob:async()=>row,devices:async()=>[machine]
   });
   expect(result, name).toMatchObject({recognized:true,proposal:null});
  }
 });
 it('never switches to Mac, an offline device or another company device',async()=>{
  for(const other of [{...machine,id:'other'}, {...machine,paired:false},
   {...machine,revoked_at:NOW.toString()}, {...machine,last_seen_at:new Date(NOW-120000).toISOString()},
   {...machine,capabilities:{job_kinds:['browser_open']}},
  ]){
   const result=await resolveUnlockContinuation('org','owner','ok tora einai unlock','en',undefined,{
    now:()=>NOW,latestOwnerJob:async()=>job(),devices:async()=>[other]
   });
   expect(result).toMatchObject({recognized:true,proposal:null});
  }
 });
 it('rejects a late async result after Stop',async()=>{
  const abort=new AbortController();
  const pending=resolveUnlockContinuation('org','owner','ok tora einai unlock','en',abort.signal,{
   now:()=>NOW,latestOwnerJob:async()=>{abort.abort();return job()},devices:async()=>[machine]
  });
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
 });
 it('routes the actual new Greeklish owner playback request without invented Mac fallback',()=>{
  const text='re to shell einai unlock pexe to tragoudi tou mazonaki ores mikres sto youtube browser';
  expect(isUnlockContinuation(text)).toBe(false);
  expect(isComputerControlRequest(text)).toBe(true);
  expect(parseDirectComputerCommand(text)).toMatchObject({
   kind:'desktop_task',target:'my shell',description:text,params:{goal:text}
  });
  expect(parseDirectComputerCommand('Research YouTube music trends')).toBeNull();
 });
});
