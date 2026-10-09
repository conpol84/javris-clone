import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { TaskResult } from './types';
const state = vi.hoisted(() => ({ steps: [] as any[], invoke: vi.fn(), read: vi.fn(), updates: [] as any[] }));
vi.mock('./client', () => ({ requireClient: () => ({ functions: { invoke: state.invoke }, from: () => {
  const query = { select: () => query, eq: () => query, order: async () => ({ data: await state.read(), error: null }),
    update: (value: unknown) => ({ eq: async (_column: string, id: string) => { state.updates.push({ id, value }); return { error: null }; } }) };
  return query;
} }) }));
import { missionStepWaiting, runMission, type MissionProgress, type MissionRow, type StepRow } from './missions';
import { computerExecutionOf } from './runner';

const JOB='11111111-1111-4111-8111-111111111111', DEVICE='22222222-2222-4222-8222-222222222222';
const marker=(status='pending')=>({ contract:'firbo-worker-execution/v1',status,verified_success:status==='completed',jobs:[{
  job_id:JOB,request_id:JOB,device_id:DEVICE,device_name:'Chosen Debian',kind:'desktop_task',status:status==='completed'?'done':'queued',
  ...(status==='completed'?{result:{completed:true},receipt:{contract:'firbo-execution-receipt/v1',job_id:JOB,device_id:DEVICE,kind:'desktop_task',ok:true,report_sha256:'a'.repeat(64)}}:{}),
}] });
const result=(execution:unknown)=>({ report:'Pending acknowledgement is not teammate output',computer_execution:execution }) as TaskResult;
const step=(id:string,status:StepRow['status']='pending'):StepRow=>({id,title:id,description:'Original instruction',status,assigned_agent_id:'employee',created_at:id==='first'?'2026-10-09T00:00:00Z':'2026-10-09T00:01:00Z',result:null});
const mission:MissionRow={id:'mission',title:'Computer work then write report',description:null,status:'running',created_at:'',result:null};
const run=(progress:MissionProgress[]=[],known={})=>runMission(mission,'en',p=>progress.push(p),()=>false,known);
const calls=()=>state.invoke.mock.calls.map(([name,{body}])=>[name,body]);
beforeEach(()=>{
 vi.clearAllMocks();state.steps=[step('first'),step('second')];state.updates=[];state.read.mockImplementation(async()=>structuredClone(state.steps));
 state.invoke.mockImplementation(async(name,{body})=>{
  if(name==='agent-runner'){const s=state.steps.find(s=>s.id===body.task_id)!;s.status='completed';s.result={summary:`Actual ${s.id} output`};return{data:{status:'completed'},error:null};}
  return{data:{},error:null};
 });
});

describe('browser mission sequencing',()=>{
 it('halts on HTTP202 instead of handing pending prose to another employee or synthesizing',async()=>{
  state.invoke.mockImplementation(async()=>{state.steps[0]={...step('first','running'),result:result(marker())};return{data:{status:'running',pending:true,computer_execution:marker()},error:null};});
  const progress:MissionProgress[]=[];await run(progress);
  expect(calls()).toEqual([['agent-runner',{task_id:'first',lang:'en'}]]);expect(state.updates).toEqual([]);
  expect(progress.slice(-1)[0]).toMatchObject({phase:'waiting',waiting:'running',acknowledgement:{stepId:'first',outcome:{status:'running',computer_execution:{jobs:[{job_id:JOB,device_id:DEVICE}]}}}});
  expect(state.read).toHaveBeenCalledTimes(3); // bounded readback, no wait/retry loop
 });
 it('requires fresh terminal readback on manual resume and never requeues the acknowledged first job',async()=>{
  state.invoke.mockImplementationOnce(async()=>{state.steps[0]={...step('first','running'),result:result(marker())};return{data:{status:'running',pending:true,computer_execution:marker()},error:null};});
  const first:MissionProgress[]=[];await run(first);
  const acknowledgement=first.slice(-1)[0]!.acknowledgement!;
  state.steps[0]=step('first');await run([],{[acknowledgement.stepId]:acknowledgement.outcome});
  expect(state.invoke).toHaveBeenCalledOnce();
  state.steps[0]={...step('first','completed'),result:{summary:'Observed requested app',computer_execution:marker('completed')} as TaskResult};
  const resumed:MissionProgress[]=[];await run(resumed,{[acknowledgement.stepId]:acknowledgement.outcome});
  expect(calls().filter(([name])=>name==='agent-runner').map(([,body])=>body.task_id)).toEqual(['first','second']);
  expect(calls().slice(-1)[0]).toEqual(['mission-runner',{action:'synthesize',mission_id:'mission',lang:'en'}]);expect(resumed.slice(-1)[0]?.phase).toBe('done');
  expect(state.updates[0].value.description).toContain('Observed requested app');expect(state.updates[0].value.description).not.toContain('Pending acknowledgement');
 });
 it('does not trust a completed response while the persisted step is still running',async()=>{
  state.invoke.mockImplementation(async()=>{state.steps[0]=step('first','running');return{data:{status:'completed'},error:null};});
  const progress:MissionProgress[]=[];await run(progress);expect(state.invoke).toHaveBeenCalledOnce();expect(progress.slice(-1)[0]?.phase).toBe('waiting');expect(state.updates).toEqual([]);
 });
 it.each(['running','awaiting_approval'] as const)('does not run past an existing %s step',async status=>{
  state.steps[0]=step('first',status);const progress:MissionProgress[]=[];await run(progress);
  expect(state.invoke).not.toHaveBeenCalled();expect(progress.slice(-1)[0]).toMatchObject({phase:'waiting',waiting:status});expect(state.updates).toEqual([]);
 });
 it.each(['pending','unknown'])('does not advance a stale completed row with durable %s execution',async status=>{
  state.steps[0]={...step('first','completed'),result:result(marker(status))};const progress:MissionProgress[]=[];await run(progress);
  expect(state.invoke).not.toHaveBeenCalled();expect(progress.slice(-1)[0]?.phase).toBe('waiting');
 });
 it('stops at a new guarded approval instead of running dependent steps',async()=>{
  state.invoke.mockImplementation(async()=>{state.steps[0]=step('first','awaiting_approval');return{data:{status:'awaiting_approval',queued:1},error:null};});
  const progress:MissionProgress[]=[];await run(progress);expect(state.invoke).toHaveBeenCalledOnce();expect(progress.slice(-1)[0]).toMatchObject({phase:'waiting',waiting:'awaiting_approval'});
 });
 it('rechecks the terminal set immediately before synthesis',async()=>{
  state.steps=[step('first','completed'),step('second','completed')];let reads=0;
  state.read.mockImplementation(async()=>{if(++reads===4)state.steps[0]={...step('first','completed'),result:result(marker('unknown'))};return structuredClone(state.steps);});
  const progress:MissionProgress[]=[];await run(progress);expect(state.invoke).not.toHaveBeenCalled();expect(progress.slice(-1)[0]?.phase).toBe('waiting');
 });
 it('preserves independent failed-step continuation and reports it as failure context',async()=>{
  state.invoke.mockImplementationOnce(async()=>{state.steps[0]={...step('first','failed'),result:{summary:'Step failed independently'}};return{data:null,error:new FunctionsHttpError(Response.json({error:'model_error'},{status:502}))};});
  const progress:MissionProgress[]=[];await run(progress);
  expect(calls().filter(([name])=>name==='agent-runner').map(([,body])=>body.task_id)).toEqual(['first','second']);expect(calls().slice(-1)[0]?.[1].action).toBe('synthesize');expect(progress.slice(-1)[0]?.phase).toBe('done');expect(state.updates[0].value.description).toContain('Step failed independently');
 });
 it('keeps a fatal permission error from advancing or synthesizing',async()=>{
  state.invoke.mockResolvedValue({data:null,error:new FunctionsHttpError(Response.json({error:'forbidden'},{status:403}))});
  await expect(run()).rejects.toMatchObject({code:'forbidden'});expect(state.invoke).toHaveBeenCalledOnce();
 });
 it('stops all browser traversal after scope cancellation during an acknowledgement',async()=>{
  let stopped=false;state.invoke.mockImplementation(async()=>{stopped=true;return{data:{status:'running',pending:true},error:null};});
  const progress:MissionProgress[]=[];await runMission(mission,'en',p=>progress.push(p),()=>stopped);
  expect(state.invoke).toHaveBeenCalledOnce();expect(state.read).toHaveBeenCalledTimes(2);expect(progress.slice(-1)[0]?.phase).toBe('working');
 });
 it('does nothing if the scope is already cancelled',async()=>{
  const progress=vi.fn();await runMission(mission,'en',progress,()=>true);expect(state.invoke).not.toHaveBeenCalled();expect(state.read).not.toHaveBeenCalled();expect(progress).not.toHaveBeenCalled();
 });
 it('treats malformed durable success metadata as unconfirmed rather than teammate output',()=>{
  expect(missionStepWaiting({...step('first','completed'),result:result({...marker('completed'),verified_success:false})})).toBe(true);
 });
 it.each(['completed','failed','cancelled'] as const)('does not clear a new worker acknowledgement with an old or missing %s receipt',async status=>{
  const known={status:'running' as const,queued:0,pending:true,computer_execution:computerExecutionOf({computer_execution:marker()})!};
  const old=marker('completed'),different='33333333-3333-4333-8333-333333333333';old.jobs[0].job_id=different;old.jobs[0].request_id=different;old.jobs[0].receipt!.job_id=different;
  state.steps[0]={...step('first',status),result:result(old)};const progress:MissionProgress[]=[];await run(progress,{first:known});
  expect(state.invoke).not.toHaveBeenCalled();expect(progress.slice(-1)[0]?.phase).toBe('waiting');
  state.steps[0]={...step('first',status),result:null};await run([],{first:known});expect(state.invoke).not.toHaveBeenCalled();
 });
});
