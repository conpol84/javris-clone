import { beforeEach, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({
 calls:[] as {table:string;method:string;args:unknown[]}[],
 sessions:[] as Record<string,unknown>[],
 messages:[] as Record<string,unknown>[],
 error:false,
}));
vi.mock('./client',()=>({requireClient:()=>({from:(table:string)=>{
 const scope:{table:string;criteria:Record<string,unknown>}={table,criteria:{}};
 const q:any={
  select:(...args:unknown[])=>{fixture.calls.push({table,method:'select',args});return q;},
  eq:(key:string,value:unknown)=>{scope.criteria[key]=value;fixture.calls.push({table,method:'eq',args:[key,value]});return q;},
  in:(key:string,value:unknown)=>{scope.criteria[key]=value;fixture.calls.push({table,method:'in',args:[key,value]});return q;},
  order:(...args:unknown[])=>{fixture.calls.push({table,method:'order',args});return q;},
  limit:async (_count:number)=>{
   if(fixture.error)return{data:null,error:{message:'scoped read failed'}};
   return{data:table==='conversations'?fixture.sessions:fixture.messages,error:null};
  },
  maybeSingle:async ()=>{
   const own=fixture.sessions.find(x=>Object.entries(scope.criteria).every(([key,val])=>x[key]===val));
   return{data:fixture.error?null:own??null,error:fixture.error?{message:'read failed'}:null};
  },
 };
 return q;
}})}));
import { ceoLinesFromMessages, listCeoSessions, readCeoSession } from './ceo-sessions';
beforeEach(()=>{fixture.calls=[];fixture.sessions=[];fixture.messages=[];fixture.error=false;});
it('shows only own CEO session previews with bounded batched messages',async()=>{
 fixture.sessions=[
  {id:'own-1',title:'Music task',updated_at:'2026-10-09T16:34:00Z'},
  {id:'own-2',title:'Market report',updated_at:'2026-10-08T10:00:00Z'}
 ];
 fixture.messages=[
  {id:'m1',conversation_id:'own-1',role:'assistant',content:'Screen locked: user action required',created_at:'2026-10-09T16:34:00Z'},
  {id:'m2',conversation_id:'own-2',role:'user',content:'How is our project doing?',created_at:'2026-10-08T10:00:00Z'},
 ];
 const data=await listCeoSessions('company','owner','ceo');
 expect(data).toEqual([
  {id:'own-1',title:'Music task',preview:'Screen locked: user action required',updated_at:'2026-10-09T16:34:00Z'},
  {id:'own-2',title:'Market report',preview:'How is our project doing?',updated_at:'2026-10-08T10:00:00Z'}
 ]);
 expect(fixture.calls.filter(c=>c.table==='conversations'&&c.method==='eq')).toEqual(expect.arrayContaining([
  {table:'conversations',method:'eq',args:['organization_id','company']},
  {table:'conversations',method:'eq',args:['user_id','owner']},
  {table:'conversations',method:'eq',args:['agent_id','ceo']}
 ]));
 expect(fixture.calls.filter(c=>c.table==='messages'&&c.method==='in')).toContainEqual({table:'messages',method:'in',args:['conversation_id',['own-1','own-2']]});
});
it('denies another users CEO conversation even for an admin and never fetches its messages',async()=>{
 fixture.sessions=[{id:'other',organization_id:'company',user_id:'another',agent_id:'ceo',status:'active'}];
 await expect(readCeoSession('company','owner','ceo','other')).rejects.toThrow('ceo_session_not_found');
 expect(fixture.calls.some(c=>c.table==='messages')).toBe(false);
});
it('restores past turns, preserving server-authored task offers and exact user text',async()=>{
 const uuid='11111111-1111-4111-8111-111111111111';
 fixture.sessions=[{id:'own',organization_id:'company',user_id:'owner',agent_id:'ceo',status:'active'}];
 // Mock the database's DESC created_at reply; readCeoSession reverses into
 // chronological display order after retrieving the most recent N turns.
 fixture.messages=[
  {role:'assistant',content:`I will delegate.\n\n[[task:${uuid}]] Test run\nCheck real device receipt`},
  {role:'user',content:'Continue our project'}
 ];
 const out=await readCeoSession('company','owner','ceo','own');
 expect(out[0]).toEqual({who:'me',text:'Continue our project'});
 expect(out[1]).toMatchObject({who:'ceo',text:'I will delegate.',task:{agentId:uuid,title:'Test run',details:'Check real device receipt'}});
});
it('returns explicit errors instead of erasing older conversations when network retrieval fails',async()=>{
 fixture.error=true;
 await expect(listCeoSessions('company','owner','ceo')).rejects.toThrow('scoped read failed');
 await expect(readCeoSession('company','owner','ceo','own')).rejects.toThrow('read failed');
});
it('refuses incomplete identity and ignores non-user/assistant archival records',async()=>{
 expect(ceoLinesFromMessages([{role:'tool',content:'malicious'},{role:'user',content:'Hello'}])).toEqual([{who:'me',text:'Hello'}]);
 await expect(listCeoSessions('','owner','ceo')).rejects.toThrow('ceo_session_scope_required');
});
