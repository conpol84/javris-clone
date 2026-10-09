import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({index:0,refIndex:0,states:[] as any[],refs:[] as {current:any}[],effects:[] as (()=>void|(()=>void))[],org:'org-a',user:'owner-a',role:'owner',active:'mission-a',steps:[] as any[],missions:[] as any[],interval:vi.fn()}));
const api=vi.hoisted(()=>({runMission:vi.fn(),runTask:vi.fn(),listSteps:vi.fn(),listMissions:vi.fn(),getMission:vi.fn(),createMission:vi.fn()}));
const notice=vi.hoisted(()=>({success:vi.fn(),message:vi.fn(),error:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),
 useState:(initial:unknown)=>{const i=fixture.index++;if(!(i in fixture.states))fixture.states[i]=typeof initial==='function'?(initial as ()=>unknown)():initial;return[fixture.states[i],(value:any)=>{fixture.states[i]=typeof value==='function'?value(fixture.states[i]):value}]},
 useRef:(initial:unknown)=>{const i=fixture.refIndex++;return fixture.refs[i]??={current:initial}},
 useEffect:(callback:()=>void|(()=>void))=>{fixture.effects.push(callback)},useCallback:(callback:unknown)=>callback,useMemo:(callback:()=>unknown)=>callback(),
}));
vi.mock('react-router',()=>({useSearchParams:()=>[new URLSearchParams(`m=${fixture.active}`),vi.fn((params:URLSearchParams)=>{fixture.active=params.get('m')??''})]}));
vi.mock('../lib/company/AuthProvider',()=>({useCompanyAuth:()=>({current:{role:fixture.role,organization:{id:fixture.org}},user:{id:fixture.user}})}));
vi.mock('../lib/company/missions',async original=>({...await original<typeof import('../lib/company/missions')>(),runMission:api.runMission,listSteps:api.listSteps,listMissions:api.listMissions,getMission:api.getMission,createMission:api.createMission}));
vi.mock('../lib/company/runner',async original=>({...await original<typeof import('../lib/company/runner')>(),runTask:api.runTask}));
vi.mock('../lib/company/data',()=>({listAgents:async()=>[]}));
vi.mock('../lib/company/labels',()=>({agentLabel:()=>({name:'Employee'})}));
vi.mock('sonner',()=>({toast:notice}));
vi.mock('../i18n/I18nProvider',async original=>{const m=await original<typeof import('../i18n/I18nProvider')>();return{...m,useI18n:()=>m.defaultI18n}});
import { MissionsPage } from './MissionsPage';
import { ComputerExecutionView } from '../components/company/ComputerExecutionView';
import { computerExecutionOf } from '../lib/company/runner';
import { defaultI18n } from '../i18n/I18nProvider';

const JOB='11111111-1111-4111-8111-111111111111',DEVICE='22222222-2222-4222-8222-222222222222';
const marker=(status='pending')=>({contract:'firbo-worker-execution/v1',status,verified_success:status==='completed',jobs:[{job_id:JOB,request_id:JOB,device_id:DEVICE,device_name:'Chosen Debian',kind:'desktop_task',status:status==='completed'?'done':'queued',...(status==='completed'?{result:{completed:true},receipt:{contract:'firbo-execution-receipt/v1',job_id:JOB,device_id:DEVICE,kind:'desktop_task',ok:true,report_sha256:'a'.repeat(64)}}:{})}]});
const pending=()=>({status:'running',queued:0,pending:true,computer_execution:computerExecutionOf({computer_execution:marker()})!});
const step=()=>({id:'step-a',title:'Use the computer',description:null,status:'pending',assigned_agent_id:null,created_at:'2026-10-09T00:00:00Z',result:null});
const mission=()=>({id:fixture.active,title:'Selected mission',description:null,status:'running',created_at:'2026-10-09T00:00:00Z',result:null});
type Element=ReactElement<{children?:ReactNode;disabled?:boolean;onClick?:()=>unknown;onSubmit?:(event:unknown)=>Promise<void>;execution?:unknown}>;
function elements(node:ReactNode):Element[]{if(Array.isArray(node))return node.flatMap(elements);if(!isValidElement(node))return[];const e=node as Element;return[e,...elements(e.props.children)]}
function text(node:ReactNode):string{if(Array.isArray(node))return node.map(text).join('');if(isValidElement(node))return text((node as Element).props.children);return typeof node==='string'?node:''}
function page(){fixture.index=0;fixture.refIndex=0;fixture.effects=[];return elements(MissionsPage())}
const continueButton=(tree=page())=>tree.find(e=>e.type==='button'&&text(e).includes(defaultI18n.t('mis.continue')))!;
const stepButton=(tree=page())=>tree.find(e=>e.type==='button'&&text(e).trim()==='Run')!;
const flush=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve()};
beforeEach(()=>{
 vi.clearAllMocks();fixture.org='org-a';fixture.user='owner-a';fixture.role='owner';fixture.active='mission-a';fixture.steps=[step()];fixture.missions=[mission()];fixture.refs=[];
 const identity=JSON.stringify([fixture.org,fixture.user,fixture.role]);
 fixture.states=[[],fixture.missions,fixture.steps,null,'Goal','',null,'mission',[],null,{},null,identity,JSON.stringify([identity,fixture.active])];
 api.listSteps.mockImplementation(async()=>fixture.steps);api.listMissions.mockImplementation(async()=>fixture.missions);api.getMission.mockImplementation(async()=>fixture.missions[0]);
 api.runTask.mockResolvedValue(pending());api.runMission.mockImplementation(async(_mission,_lang,progress)=>{fixture.steps=[{...step(),status:'running',result:{computer_execution:marker()}}];progress({phase:'waiting',waiting:'running',steps:fixture.steps,acknowledgement:{stepId:'step-a',outcome:pending()}})});
 vi.stubGlobal('window',{setInterval:fixture.interval,clearInterval:vi.fn()});
});
afterEach(()=>vi.unstubAllGlobals());

it('keeps the mission waiting with the exact worker receipt and disables premature resume',async()=>{
 await continueButton().props.onClick?.();await vi.waitFor(()=>expect(api.listMissions).toHaveBeenCalledOnce());await flush();
 const tree=page();expect(fixture.states[3]).toBe('waiting');expect(text(tree)).toContain(defaultI18n.t('run.pending'));expect(continueButton(tree).props.disabled).toBe(true);
 expect(tree.find(e=>e.type===ComputerExecutionView)?.props.execution).toMatchObject({status:'pending',jobs:[{job_id:JOB,device_id:DEVICE}]});expect(api.runTask).not.toHaveBeenCalled();expect(notice.success).not.toHaveBeenCalled();
});

it('allows only manual resume after the existing read-only refresh returns matching terminal evidence',async()=>{
 await continueButton().props.onClick?.();await flush();page();fixture.effects[5]();const tick=fixture.interval.mock.calls.slice(-1)[0]![0];
 fixture.steps=[{...step(),status:'completed',result:{computer_execution:marker('completed')}}];tick();await flush();
 const button=continueButton();expect(button.props.disabled).toBe(false);expect(api.runMission).toHaveBeenCalledOnce();
 api.runMission.mockImplementationOnce(async(_m,_l,progress)=>progress({phase:'done',steps:fixture.steps}));
 button.props.onClick?.();await flush();expect(api.runMission).toHaveBeenCalledTimes(2);expect(api.runMission.mock.calls[1][4]).toMatchObject({'step-a':{status:'running',computer_execution:{jobs:[{job_id:JOB}]}}});expect(api.runTask).not.toHaveBeenCalled();
});

it('does not clear waiting or display another job as completed after an old terminal receipt refresh',async()=>{
 await continueButton().props.onClick?.();await flush();page();fixture.effects[5]();const tick=fixture.interval.mock.calls.slice(-1)[0]![0];
 const old=marker('completed'),oldJob='33333333-3333-4333-8333-333333333333';old.jobs[0].job_id=oldJob;old.jobs[0].request_id=oldJob;old.jobs[0].receipt!.job_id=oldJob;
 fixture.steps=[{...step(),status:'completed',result:{computer_execution:old}}];tick();await flush();
 const tree=page();expect(continueButton(tree).props.disabled).toBe(true);expect(tree.find(e=>e.type===ComputerExecutionView)?.props.execution).toMatchObject({status:'pending',jobs:[{job_id:JOB}]});expect(api.runMission).toHaveBeenCalledOnce();
});

it.each(['org','user','role','active'] as const)('fences progress and readback after a %s switch',async key=>{
 let finish!:()=>void;api.runMission.mockImplementation((_m,_l,progress,stop)=>new Promise<void>(resolve=>{finish=()=>{expect(stop()).toBe(true);progress({phase:'waiting',steps:[{...step(),status:'running'}],acknowledgement:{stepId:'step-a',outcome:pending()}});resolve()}}));
 continueButton().props.onClick?.();fixture[key]='changed';page();finish();await flush();
 expect(fixture.states[10]).toEqual({});expect(api.listMissions).not.toHaveBeenCalled();expect(api.listSteps).not.toHaveBeenCalled();expect(notice.error).not.toHaveBeenCalled();
});

it('fences a late mission run after unmount',async()=>{
 let finish!:()=>void;api.runMission.mockImplementation((_m,_l,progress,stop)=>new Promise<void>(resolve=>{finish=()=>{expect(stop()).toBe(true);progress({phase:'waiting',steps:[]});resolve()}}));
 const tree=page(),cleanup=fixture.effects[0]()!;continueButton(tree).props.onClick?.();cleanup();finish();await flush();
 expect(api.listMissions).not.toHaveBeenCalled();expect(api.listSteps).not.toHaveBeenCalled();expect(fixture.states[3]).not.toBe('waiting');
});

it('fences old read-only refresh responses after switching missions',async()=>{
 page();fixture.effects[5]();const tick=fixture.interval.mock.calls.slice(-1)[0]![0];
 let finishSteps!:(steps:any[])=>void,finishMission!:(m:any)=>void;api.listSteps.mockImplementation(()=>new Promise(resolve=>{finishSteps=resolve}));api.getMission.mockImplementation(()=>new Promise(resolve=>{finishMission=resolve}));
 tick();fixture.active='mission-b';page();finishSteps([{...step(),title:'Old response'}]);finishMission({...mission(),id:'mission-a',title:'Old mission'});await flush();
 expect(fixture.states[2][0].title).toBe('Use the computer');expect(fixture.states[1][0].title).toBe('Selected mission');expect(api.runMission).not.toHaveBeenCalled();
});

it('keeps meeting action-item HTTP202 pending and prevents a second enqueue on stale task data',async()=>{
 fixture.missions=[{...mission(),metadata:{meeting:true}}];fixture.states[1]=fixture.missions;
 stepButton().props.onClick?.();await flush();
 expect(api.runTask).toHaveBeenCalledExactlyOnceWith('step-a','en');expect(notice.message).toHaveBeenCalledOnce();expect(notice.message.mock.calls[0][0]).toContain(JOB);expect(notice.success).not.toHaveBeenCalled();
 const tree=page();expect(tree.find(e=>e.type===ComputerExecutionView)?.props.execution).toMatchObject({jobs:[{job_id:JOB}]});expect(stepButton(tree).props.disabled).toBe(true);
 stepButton(tree).props.onClick?.();await flush();expect(api.runTask).toHaveBeenCalledOnce();
});

it('shows guarded meeting action approval using the shared neutral outcome notice',async()=>{
 fixture.missions=[{...mission(),metadata:{meeting:true}}];fixture.states[1]=fixture.missions;api.runTask.mockResolvedValue({status:'awaiting_approval',queued:1,pending:false});fixture.steps=[{...step(),status:'awaiting_approval'}];
 stepButton().props.onClick?.();await flush();expect(notice.message).toHaveBeenCalledOnce();expect(notice.success).not.toHaveBeenCalled();
});

it('does not toast completed for a meeting action with a stale completed outcome and fresh running task',async()=>{
 fixture.missions=[{...mission(),metadata:{meeting:true}}];fixture.states[1]=fixture.missions;api.runTask.mockResolvedValue({status:'completed',queued:0,pending:false});fixture.steps=[{...step(),status:'running'}];
 stepButton().props.onClick?.();await flush();expect(notice.message).toHaveBeenCalledOnce();expect(notice.success).not.toHaveBeenCalled();expect(notice.message.mock.calls[0][0]).toBe(defaultI18n.t('run.pending'));
});

it.each(['org','user','active'] as const)('ignores a late meeting action acknowledgement after a %s switch',async key=>{
 fixture.missions=[{...mission(),metadata:{meeting:true}}];fixture.states[1]=fixture.missions;let finish!:(value:unknown)=>void;api.runTask.mockImplementation(()=>new Promise(resolve=>{finish=resolve}));
 stepButton().props.onClick?.();fixture[key]='changed';page();finish(pending());await flush();
 expect(notice.message).not.toHaveBeenCalled();expect(notice.success).not.toHaveBeenCalled();expect(api.listSteps).not.toHaveBeenCalled();expect(fixture.states[10]).toEqual({});
});

it.each(['slow','failed'] as const)('hides company A inventory and rejects its old controls while company B inventory is %s',async load=>{
 const oldTree=page(),oldContinue=continueButton(oldTree);fixture.org='org-b';
 if(load==='slow')api.listMissions.mockReturnValue(new Promise(()=>{}));else api.listMissions.mockRejectedValue(new Error('Company B read failed'));
 const tree=page();fixture.effects[3]();fixture.effects[4]();fixture.effects[5]();oldContinue.props.onClick?.();await flush();
 expect(text(tree)).not.toContain('Selected mission');expect(continueButton(tree)).toBeUndefined();expect(api.listSteps).not.toHaveBeenCalled();expect(api.getMission).not.toHaveBeenCalled();expect(api.runMission).not.toHaveBeenCalled();expect(api.runTask).not.toHaveBeenCalled();
 expect(api.listMissions).toHaveBeenCalledExactlyOnceWith('org-b');
});

it('never reads or starts an unknown mission URL even when the member can access two companies',async()=>{
 fixture.org='org-b';fixture.active='mission-a';const identity=JSON.stringify([fixture.org,fixture.user,fixture.role]);fixture.states[12]=identity;fixture.states[1]=[{...mission(),id:'mission-b',title:'Company B mission'}];
 const tree=page();fixture.effects[4]();fixture.effects[5]();await flush();
 expect(text(tree)).toContain('Company B mission');expect(continueButton(tree)).toBeUndefined();expect(api.listSteps).not.toHaveBeenCalled();expect(api.getMission).not.toHaveBeenCalled();expect(api.runMission).not.toHaveBeenCalled();
});

it('hides stale action-item rows immediately on a same-company mission switch and fences their old Run callback',async()=>{
 fixture.missions=[{...mission(),metadata:{meeting:true}},{...mission(),id:'mission-b',metadata:{meeting:true}}];fixture.states[1]=fixture.missions;
 const oldRun=stepButton();fixture.active='mission-b';const tree=page();oldRun.props.onClick?.();await flush();
 expect(stepButton(tree)).toBeUndefined();expect(text(tree)).not.toContain('Use the computer');expect(api.runTask).not.toHaveBeenCalled();
});

it('filters every selected mission read by the active company',async()=>{
 page();fixture.effects[4]();fixture.effects[5]();fixture.interval.mock.calls.slice(-1)[0]![0]();await flush();
 expect(api.listSteps).toHaveBeenCalledWith('mission-a','org-a');expect(api.getMission).toHaveBeenCalledExactlyOnceWith('mission-a','org-a');
});
