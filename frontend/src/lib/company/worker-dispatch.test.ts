import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { dispatchDirectComputerCommand, dispatchLaptopBrowserCommand, prepareDirectComputerCommand, setVoiceLaptop } from './laptop-bridge';
import { dispatchWorkerRequest, workerDispatchReceipt, type WorkerDispatchRequest } from './worker-dispatch';
import { computerApprovalDevice, decideComputerApproval, isComputerApprovalAction, type DeviceRow, type JobRow } from './computers';
import { formatComputerResult } from './computer-state';

const sdk = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => ({ functions: { invoke: sdk.invoke } }) }));
const ORG='11111111-1111-4111-8111-111111111111', REQUEST='22222222-2222-4222-8222-222222222222';
const DEBIAN='33333333-3333-4333-8333-333333333333', MAC='44444444-4444-4444-8444-444444444444', JOB=REQUEST;
const goal='Open YouTube and play Μαζωνάκης Ώρες Μικρές';
const proposal=()=>({kind:'desktop_task' as const,params:{goal},description:goal,requestId:REQUEST});
const receipt=(body:WorkerDispatchRequest,changes:Record<string,unknown>={})=>({
 contract:'firbo-worker-dispatch/v1',request_id:body.request_id,organization_id:body.organization_id,
 worker:{kind:'computer',id:DEBIAN,name:'My shell',platform:'linux x64'},
 job:{kind:body.kind,params:body.params},reason:'online native desktop',
 ...(body.action==='dispatch'?{job_id:body.request_id}:{}),...changes,
});
const done=(kind:JobRow['kind']='desktop_task',params:Record<string,unknown>={goal}):JobRow=>({id:JOB,device_id:DEBIAN,kind,params,status:'done',result:kind==='desktop_task'?{completed:true,summary:'Matched artist and title; observed playback advancing'}:{launched:true},error:null,created_at:'',finished_at:''});
const memory=()=>{const values=new Map<string,string>();return{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}};
beforeEach(()=>{sdk.invoke.mockReset();});

describe('CEO central worker dispatch',()=>{
 it('previews and dispatches through the central API with the same UUID and server-selected worker',async()=>{
  const store=memory();setVoiceLaptop(ORG,MAC,store);
  sdk.invoke.mockImplementation(async(_name,{body})=>({data:receipt(body),error:null}));
  const ready=await prepareDirectComputerCommand(ORG,proposal(),'en',undefined,{storage:store});
  expect(ready).toEqual({ready:true,deviceId:DEBIAN,deviceName:'My shell',nativeDesktop:true,requestId:REQUEST});
  if(!ready.ready)throw Error('must be ready');
  const out=await dispatchDirectComputerCommand(ORG,{...proposal(),deviceId:ready.deviceId,requestId:ready.requestId},'en',undefined,{storage:store,loadJobs:async(_org,id)=>{expect(id).toBe(DEBIAN);return[done()]}});
  expect(out.status).toBe('done');expect(sdk.invoke).toHaveBeenCalledTimes(2);
  const calls=sdk.invoke.mock.calls;
  expect(calls.map(([name])=>name)).toEqual(['computer-dispatch','computer-dispatch']);
  expect(calls[0][1].body).toEqual({action:'preview',organization_id:ORG,request_id:REQUEST,kind:'desktop_task',params:{goal},goal});
  expect(calls[1][1].body).toEqual({...calls[0][1].body,action:'dispatch',confirm:true,device_id:DEBIAN});
  expect(store.getItem(`firbo.voice-laptop.v1:${ORG}`)).toBe(MAC);
 });
 it('snapshots approved goal, target and parameters before the central await',async()=>{
  const p={kind:'open_app' as const,params:{app:'Google Chrome'},description:'Open Google Chrome',target:'mac',deviceId:MAC,requestId:REQUEST};
  sdk.invoke.mockImplementation(async(_name,{body})=>{
   p.params.app='Safari';p.target='debian';p.deviceId=DEBIAN;p.description='Open Safari';
   return{data:receipt(body,{worker:{kind:'computer',id:MAC,name:'Polis1984',platform:'darwin x64'}}),error:null};
  });
  const out=await dispatchDirectComputerCommand(ORG,p,'en',undefined,{loadJobs:async()=>[{...done('open_app',{app:'Google Chrome'}),device_id:MAC,result:{opened:true,app:'Google Chrome'}}]});
  expect(out.status).toBe('done');expect(out.reply).toContain('Open Google Chrome');
  expect(sdk.invoke.mock.calls[0][1].body).toMatchObject({target:'mac',device_id:MAC,params:{app:'Google Chrome'},goal:'Open Google Chrome'});
 });
 it('accepts only the exact native adaptation and verifies the adapted receipt',async()=>{
  sdk.invoke.mockImplementation(async(_name,{body})=>({data:receipt(body,{job:{kind:'desktop_task',params:{goal:body.goal}}}),error:null}));
  const p={kind:'open_app' as const,params:{app:'Google Chrome'},description:'Open Google Chrome',requestId:REQUEST};
  expect(await prepareDirectComputerCommand(ORG,p,'en')).toMatchObject({ready:true,nativeDesktop:true});
  const out=await dispatchDirectComputerCommand(ORG,p,'en',undefined,{loadJobs:async()=>[done('desktop_task',{goal:'Open Google Chrome'})]});
  expect(out.status).toBe('done');
  const req:WorkerDispatchRequest={action:'dispatch',organization_id:ORG,request_id:REQUEST,kind:'open_app',params:{app:'Google Chrome'},goal:'Open Google Chrome',confirm:true};
  expect(()=>workerDispatchReceipt(receipt(req,{job:{kind:'desktop_task',params:{goal:'Open Safari'}}}),req)).toThrow();
 });
 it('keeps legacy browser_open on the central path without requiring native control',async()=>{
  const store=memory();setVoiceLaptop(ORG,MAC,store);
  sdk.invoke.mockImplementation(async(_name,{body})=>({data:receipt(body),error:null}));
  const out=await dispatchLaptopBrowserCommand(ORG,'open browser to example.com','en',undefined,{storage:store,loadJobs:async()=>[{...done('browser_open',{url:'https://example.com/'}),id:sdk.invoke.mock.calls[0][1].body.request_id}]});
  expect(out.status).toBe('done');expect(sdk.invoke).toHaveBeenCalledOnce();
  expect(sdk.invoke.mock.calls[0][1].body).toMatchObject({action:'dispatch',kind:'browser_open',params:{url:'https://example.com/'}});
  expect(sdk.invoke.mock.calls[0][1].body).not.toHaveProperty('device_id');
  expect(store.getItem(`firbo.voice-laptop.v1:${ORG}`)).toBe(MAC);
 });
 it('never discovers locally, retries or switches workers after a central transport error',async()=>{
  const discover=vi.fn(),queue=vi.fn(),loadJobs=vi.fn(),cancel=vi.fn(async()=>{});
  const dispatcher=vi.fn(async()=>{throw Error('network uncertainty')});
  const out=await dispatchDirectComputerCommand(ORG,proposal(),'en',undefined,{dispatcher,loadDevices:discover,queue,loadJobs,cancel});
  expect(out.status).toBe('failed');expect(dispatcher).toHaveBeenCalledOnce();expect(discover).not.toHaveBeenCalled();expect(queue).not.toHaveBeenCalled();expect(loadJobs).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledExactlyOnceWith(REQUEST);
 });
 it.each(['device','params','stop'])('never accepts a completed job with mismatched %s',async mismatch=>{
  sdk.invoke.mockImplementation(async(_name,{body})=>({data:receipt(body),error:null}));
  const row=done();if(mismatch==='device')row.device_id=MAC;if(mismatch==='params')row.params={goal:'Different goal'};if(mismatch==='stop')row.cancel_requested_at='2026-10-09T10:00:00Z';
  const out=await dispatchDirectComputerCommand(ORG,proposal(),'en',undefined,{loadJobs:async()=>[row]});
  expect(out.status).toBe('failed');
 });
 it('requests Stop once when cancellation races with the enqueue response',async()=>{
  const ac=new AbortController(),cancel=vi.fn(async()=>{});
  sdk.invoke.mockImplementation(async(_name,{body})=>{ac.abort();return{data:receipt(body),error:null}});
  await expect(dispatchDirectComputerCommand(ORG,proposal(),'en',ac.signal,{cancel,loadJobs:async()=>[done()]})).rejects.toMatchObject({name:'AbortError'});
  expect(cancel).toHaveBeenCalledExactlyOnceWith(JOB);expect(sdk.invoke).toHaveBeenCalledOnce();
 });
 it('fences preview returned after Stop without enqueueing',async()=>{
  const ac=new AbortController();
  sdk.invoke.mockImplementation(async(_name,{body})=>{ac.abort();return{data:receipt(body),error:null}});
  await expect(prepareDirectComputerCommand(ORG,proposal(),'en',ac.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(sdk.invoke).toHaveBeenCalledOnce();expect(sdk.invoke.mock.calls[0][1].body.action).toBe('preview');
 });
 it('cancels the committed request once when Stop loses the enqueue ACK',async()=>{
  const ac=new AbortController(),cancel=vi.fn(async()=>{});
  sdk.invoke.mockImplementation(async()=>{ac.abort();throw new DOMException('Connection lost after commit','AbortError');});
  await expect(dispatchDirectComputerCommand(ORG,proposal(),'en',ac.signal,{cancel})).rejects.toMatchObject({name:'AbortError'});
  expect(cancel).toHaveBeenCalledExactlyOnceWith(REQUEST);expect(sdk.invoke).toHaveBeenCalledOnce();
 });
});

describe('central dispatch response identity',()=>{
 it.each(['request','org','worker','job','kind','params'])('rejects mismatched %s before polling a computer',async mismatch=>{
  const req:WorkerDispatchRequest={action:'dispatch',organization_id:ORG,request_id:REQUEST,kind:'desktop_task',params:{goal},goal,device_id:DEBIAN,confirm:true};
  const data=receipt(req);
  if(mismatch==='request')data.request_id=MAC;if(mismatch==='org')data.organization_id=MAC;
  if(mismatch==='worker')data.worker.id=MAC;if(mismatch==='job')data.job_id='invalid';
  if(mismatch==='kind')data.job.kind='browser_open';if(mismatch==='params')data.job.params={goal:'changed'};
  sdk.invoke.mockResolvedValue({data,error:null});await expect(dispatchWorkerRequest(req)).rejects.toThrow('dispatch_receipt_invalid');
  expect(sdk.invoke).toHaveBeenCalledOnce();
 });
 it('clones transport parameters so mutation cannot change approval identity',async()=>{
  const req:WorkerDispatchRequest={action:'dispatch',organization_id:ORG,request_id:REQUEST,kind:'desktop_task',params:{goal},goal,confirm:true};
  sdk.invoke.mockImplementation(async(_name,{body})=>{body.params.goal='changed';return{data:receipt(body),error:null}});
  await expect(dispatchWorkerRequest(req)).rejects.toThrow();expect(req.params).toEqual({goal});
 });
 it('maps a defined policy error without exposing arbitrary upstream text',async()=>{
  sdk.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(Response.json({error:'business_plan_required',detail:'private upstream data'},{status:403}))});
  const ready=await prepareDirectComputerCommand(ORG,proposal(),'en');
  expect(ready).toMatchObject({ready:false,status:'business_plan_required'});if(!ready.ready)expect(ready.reply).not.toContain('private');
 });
 it.each(['no_eligible_worker','target_unavailable','target_ambiguous'])('preserves a central %s explanation without making a local job',async code=>{
  sdk.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(Response.json({error:code},{status:409}))});
  const ready=await prepareDirectComputerCommand(ORG,{...proposal(),target:'mac'},'en');
  expect(ready).toMatchObject({ready:false,status:code});if(!ready.ready)expect(ready.reply).not.toContain('dispatcher did not confirm');
  expect(sdk.invoke).toHaveBeenCalledOnce();
 });
 it('never replaces a reviewed browser step plan with an opaque desktop goal',()=>{
  const req:WorkerDispatchRequest={action:'preview',organization_id:ORG,request_id:REQUEST,kind:'browser_task',params:{steps:[{action:'open',url:'https://example.com/'}]},goal:'Read the example page'};
  expect(()=>workerDispatchReceipt(receipt(req,{job:{kind:'desktop_task',params:{goal:req.goal}}}),req)).toThrow('dispatch_receipt_invalid');
 });
 it('rejects preview selecting a different platform than an explicit Mac target',()=>{
  const req:WorkerDispatchRequest={action:'preview',organization_id:ORG,request_id:REQUEST,kind:'browser_open',params:{url:'https://example.com/'},goal:'Open browser',target:'mac'};
  expect(()=>workerDispatchReceipt(receipt(req),req)).toThrow('dispatch_receipt_invalid');
 });
});

describe('native task Inbox handoff',()=>{
 const device=(id:string):DeviceRow=>({id,name:id,platform:'linux x64',paired:true,last_seen_at:'2026-10-09T10:00:00Z',capabilities:{job_kinds:['desktop_task'],full_control:true},agent_policy:{enabled:true,control:'full'},revoked_at:null,created_at:''});
 const approval=()=>({action:'computer_desktop_task',payload:{goal,device_id:DEBIAN}});
 it('recognises native task approvals and binds them to the exact original device',()=>{
  expect(isComputerApprovalAction('computer_desktop_task')).toBe(true);
  expect(computerApprovalDevice(approval(),[device(MAC),device(DEBIAN)],MAC)).toBe(DEBIAN);
  expect(computerApprovalDevice(approval(),[device(MAC)],MAC)).toBeUndefined();
  expect(computerApprovalDevice(approval(),[{...device(DEBIAN),revoked_at:'2026-10-09T10:00:00Z'},device(MAC)])).toBeUndefined();
 });
 it('does not approve a missing or invalid native goal on another available computer',()=>{
  for(const payload of [{device_id:DEBIAN},{device_id:DEBIAN,goal:''},{device_id:DEBIAN,goal:4},{goal}])expect(computerApprovalDevice({action:'computer_desktop_task',payload},[device(DEBIAN),device(MAC)])).toBeUndefined();
 });
 it('preserves explicit legacy changes but never silently replaces a removed pinned device',()=>{
  const legacy={action:'computer_open_app',payload:{app:'Google Chrome',device_id:DEBIAN}};
  expect(computerApprovalDevice(legacy,[device(MAC)])).toBeUndefined();
  expect(computerApprovalDevice(legacy,[device(MAC)],MAC)).toBe(MAC);
  expect(computerApprovalDevice(legacy,[device(MAC)],'')).toBeUndefined();
 });
 it('sends the exact native goal to Connector approval and displays observed native output',async()=>{
  sdk.invoke.mockResolvedValue({data:{decision:'approved',job_id:REQUEST,duplicate:false},error:null});
  await decideComputerApproval({approval_id:JOB,decision:'approved',device_id:DEBIAN,payload:approval().payload});
  expect(sdk.invoke).toHaveBeenCalledExactlyOnceWith('connector',{body:{action:'decide_execution',approval_id:JOB,decision:'approved',device_id:DEBIAN,payload:{goal,device_id:DEBIAN}}});
  expect(formatComputerResult({kind:'desktop_task',result:{completed:false,summary:'Login needs owner input'}})).toBe('Login needs owner input');
 });
});
