import {beforeEach,describe,expect,it,vi} from 'vitest';
import {claimJarvisDelegation} from './jarvis-delegation';
let api:any;
vi.mock('./client',()=>({requireClient:()=>api}));
const org='33333333-3333-4333-8333-333333333333';
const user='11111111-1111-4111-8111-111111111111';
const ceo='22222222-2222-4222-8222-222222222222';
const worker='44444444-4444-4444-8444-444444444444';
const convo='55555555-5555-4555-8555-555555555555';
const msg='66666666-6666-4666-8666-666666666666';
const input={organizationId:org,userId:user,conversationId:convo,messageId:msg,agentId:worker,title:'Research competitor prices',details:'Deliver public sources and findings'};
let rows:Record<string,any[]>,inserts:number,loseAck:boolean;
beforeEach(()=>{
 rows={
  conversations:[{id:convo,organization_id:org,user_id:user,agent_id:ceo,status:'active'}],
  agents:[{id:ceo,organization_id:org,type:'ceo',slug:'ceo',enabled:true}],
  messages:[{id:msg,conversation_id:convo,organization_id:org,role:'assistant',content:'I will delegate.\n[[task:'+worker+']] '+input.title+'\n'+input.details}],
  tasks:[],
 };inserts=0;loseAck=false;
 api={from:(table:string)=>{
  let filters:[string,unknown][]=[];let insertion:Record<string,any>|null=null;
  const self:any={
   select:()=>self,eq:(k:string,v:unknown)=>{filters.push([k,v]);return self;},
   insert:(row:Record<string,any>)=>{insertion=row;return self;},
   maybeSingle:()=>get(),single:()=>get(),
  };
  async function get(){
   if(insertion){
    inserts++;
    const old=rows.tasks.find(t=>t.id===insertion!.id);
    if(old)return{data:null,error:{code:'23505',message:'duplicate'}};
    const created={...insertion,status:'pending'};
    rows.tasks.push(created);
    return loseAck?{data:null,error:{message:'response lost'}}:{data:created,error:null};
   }
   const data=(rows[table]??[]).find(row=>filters.every(([k,v])=>row[k]===v))??null;
   return{data,error:null};
  }
  return self;
 }};
});
describe('durable JARVIS CEO delegation',()=>{
 it('claims a single task using a verified saved assistant message',async()=>{
  const result=await claimJarvisDelegation(input);
  expect(result).toEqual({taskId:msg,created:true,status:'pending'});
  expect(inserts).toBe(1);
  expect(rows.tasks[0]).toMatchObject({id:msg,organization_id:org,created_by:user,
   assigned_agent_id:worker,metadata:{source:'jarvis_ceo_handoff_v1',conversation_id:convo,message_id:msg}});
 });
 it('does not re-dispatch after duplicate or lost insert acknowledgment',async()=>{
  await claimJarvisDelegation(input);
  expect(await claimJarvisDelegation(input)).toEqual({taskId:msg,created:false,status:'pending'});
  expect(rows.tasks.length).toBe(1);
  rows.tasks=[];inserts=0;loseAck=true;
  expect(await claimJarvisDelegation(input)).toEqual({taskId:msg,created:false,status:'pending'});
  expect(rows.tasks.length).toBe(1);
 });
 it('rejects a forged handoff or another member conversation before insert',async()=>{
  await expect(claimJarvisDelegation({...input,agentId:ceo})).rejects.toThrow('source_not_verified');
  await expect(claimJarvisDelegation({...input,userId:ceo})).rejects.toThrow('source_not_verified');
  rows.messages[0].role='user';
  await expect(claimJarvisDelegation(input)).rejects.toThrow('source_not_verified');
  expect(inserts).toBe(0);
 });
 it('cannot reuse a colliding task created by somebody else',async()=>{
  rows.tasks=[{id:msg,organization_id:org,created_by:ceo,assigned_agent_id:worker,
   title:input.title,description:input.details,status:'pending',metadata:{source:'jarvis_ceo_handoff_v1'}}];
  await expect(claimJarvisDelegation(input)).rejects.toThrow('task_unavailable');
  expect(rows.tasks.length).toBe(1);
 });
});
