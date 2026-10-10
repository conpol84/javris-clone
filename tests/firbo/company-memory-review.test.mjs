import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompanyMemoryHandler} from '../../supabase/functions/company-memory-review/handler.ts';

const A='10000000-0000-0000-0000-000000000001';
const B='10000000-0000-0000-0000-000000000002';
const OWNER='20000000-0000-0000-0000-000000000001';
const MEMBER='20000000-0000-0000-0000-000000000002';
const OTHER='20000000-0000-0000-0000-000000000003';
const SOURCE_A='30000000-0000-0000-0000-000000000001';
const SOURCE_B='30000000-0000-0000-0000-000000000002';
const PUB='40000000-0000-0000-0000-000000000001';

function testRig({user=OWNER,role='owner',authenticated=true}={}){
 const state={
  publications:[],
  members:[{organization_id:A,user_id:OWNER,role:'owner'},
           {organization_id:A,user_id:MEMBER,role:'member'},
           {organization_id:B,user_id:OTHER,role:'owner'}],
  memories:[{id:SOURCE_A,organization_id:A,user_id:null,metadata:{source:'learned'},
             content:'Legacy proposal for first tenant',memory_type:'fact',created_at:'2026-10-09'},
            {id:SOURCE_B,organization_id:B,user_id:null,metadata:{source:'learned'},
             content:'Private competing company plan',memory_type:'fact',created_at:'2026-10-09'}],
  writes:0,tableReads:[],providerCalls:0,
 };
 state.members[0].role=role;
 const query=(table)=>{
  const criteria=[];let operation='get',write=null;
  const matches=(row)=>criteria.every(([k,v])=>{
   if(k==='metadata->>source')return row.metadata?.source===v;
   return (row[k]??null)===v;
  });
  const rows=()=>state[table==='organization_members'?'members':table==='memories'?'memories':'publications']
   .filter(matches);
  const result=()=>{
   if(operation==='insert'){
    state.writes++;
    if(state.publications.some(x=>x.source_memory_id===write.source_memory_id && x.organization_id===write.organization_id && !x.revoked_at))
      return{data:null,error:{code:'23505'}};
    const inserted={...write,id:PUB,approved_at:'2026-10-10'};
    state.publications.push(inserted);return{data:inserted,error:null};
   }
   if(operation==='update'){
    state.writes++;
    const found=rows();
    for(const row of found)Object.assign(row,write);
    return{data:found,error:null};
   }
   state.tableReads.push(table);return{data:rows(),error:null};
  };
  const q={
   select:()=>q,eq:(k,v)=>(criteria.push([k,v]),q),is:(k,v)=>(criteria.push([k,v]),q),
   order:()=>q,limit:async()=>result(),
   maybeSingle:async()=>{const x=result();return{data:x.data?.[0]??null,error:x.error}},
   insert:(payload)=>(operation='insert',write=payload,q),
   update:(payload)=>(operation='update',write=payload,q),
   single:async()=>{const x=result();return{data:x.data,error:x.error}},
   then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject),
  };
  return q;
 };
 const createClient=(_url,key)=>{
  if(key==='fixture-anon')return{auth:{getUser:async()=>authenticated?
   {data:{user:{id:user}},error:null}:{data:{user:null},error:{message:'no session'}}}};
  return{from:query};
 };
 const env=k=>({SUPABASE_URL:'https://fixture.supabase.co',
   SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service'})[k];
 const handler=createCompanyMemoryHandler({createClient,env});
 const invoke=async(action,org=A,fields={},headers={Authorization:'Bearer synthetic-authorized-token'})=>{
  const res=await handler(new Request('https://example.test/functions/v1/company-memory-review',{
   method:'POST',headers:{...headers,'content-type':'application/json'},
   body:JSON.stringify({action,organization_id:org,...fields}),
  }));
  return{status:res.status,body:await res.json()};
 };
 return{state,invoke};
}

test('no caller/session cannot enumerate company memories or unpublished proposals',async()=>{
 const x=testRig({authenticated:false});
 assert.equal((await x.invoke('list_proposals')).status,401);
 assert.equal((await x.invoke('list_published')).status,401);
 assert.equal(x.state.tableReads.length,0);
});
test('non-owner cannot read, publish or revoke legacy/private memories',async()=>{
 const x=testRig({user:MEMBER});
 for(const action of ['list_proposals','list_published','publish','revoke']){
  assert.equal((await x.invoke(action,A,{source_memory_id:SOURCE_A,content:'This is a reviewed company record',confirm_reviewed:true})).status,403);
 }
 assert.equal(x.state.writes,0);
 assert.equal(x.state.tableReads.includes('memories'),false);
});
test('owner sees only own organizations old proposals, never the other tenant',async()=>{
 const x=testRig();
 const r=await x.invoke('list_proposals');
 assert.equal(r.status,200);
 assert.equal(r.body.proposals.length,1);
 assert.equal(r.body.proposals[0].id,SOURCE_A);
 assert.ok(!JSON.stringify(r.body).includes('Private competing'));
});
test('explicit owner review publishes only matching source and validates edited statement',async()=>{
 const x=testRig();
 const payload={source_memory_id:SOURCE_A,content:'Verified actual contract renewal on 1 November 2026.',
  memory_type:'decision',importance:0.9};
 assert.equal((await x.invoke('publish',A,payload)).status,400);
 const pub=await x.invoke('publish',A,{...payload,confirm_reviewed:true});
 assert.equal(pub.status,201);
 assert.equal(pub.body.published_id,PUB);
 assert.equal(x.state.publications.length,1);
 assert.equal(x.state.publications[0].approved_by,OWNER);
 assert.equal(x.state.publications[0].organization_id,A);
 assert.equal(x.state.memories.length,2,'legacy proposal must be retained');
 assert.equal((await x.invoke('publish',A,{...payload,confirm_reviewed:true})).status,409);
});
test('foreign tenant proposal cannot be cited as publication evidence',async()=>{
 const x=testRig();
 const r=await x.invoke('publish',A,{source_memory_id:SOURCE_B,
  content:'Tried to publish another company plan',memory_type:'fact',confirm_reviewed:true});
 assert.equal(r.status,404);assert.equal(x.state.writes,0);
});
test('free-form owner publication requires confirmation and cannot spoof source id',async()=>{
 const x=testRig();
 assert.equal((await x.invoke('publish_manual',A,{content:'Reviewed and approved shared company note',
  memory_type:'company',source_memory_id:SOURCE_A,confirm_reviewed:true})).status,400);
 const ok=await x.invoke('publish_manual',A,{content:'Reviewed and approved shared company note',
  memory_type:'company',confirm_reviewed:true});
 assert.equal(ok.status,201);
 assert.equal(x.state.publications[0].source_memory_id,null);
});
test('revocation is tenant-bound and terminal; no reapproval implied',async()=>{
 const x=testRig();
 await x.invoke('publish',A,{source_memory_id:SOURCE_A,
  content:'Reviewed company-wide decision text',memory_type:'decision',confirm_reviewed:true});
 assert.equal((await x.invoke('revoke',B,{publication_id:PUB})).status,403);
 const revoked=await x.invoke('revoke',A,{publication_id:PUB});
 assert.equal(revoked.status,200);
 assert.equal(x.state.publications[0].revoked_by,OWNER);
 assert.equal((await x.invoke('list_published',A)).body.publications.length,0);
 assert.equal((await x.invoke('revoke',A,{publication_id:PUB})).status,404);
});
test('invalid JSON/roles/unknown action yield no privileged writes',async()=>{
 const x=testRig();
 assert.equal((await x.invoke('publish',A,{source_memory_id:SOURCE_A,
  content:'short',memory_type:'fact',confirm_reviewed:true})).status,400);
 assert.equal((await x.invoke('run_shell',A,{})).status,400);
 assert.equal((await x.invoke('list_proposals','malformed-org')).status,400);
 assert.equal(x.state.writes,0);
});
