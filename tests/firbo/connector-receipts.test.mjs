import {test} from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {randomUUID,createHash} from 'node:crypto';
import {makeHandler,TOKEN,ORG,DEVICE} from './helpers/connector-handler.mjs';
import {reportEnvelope,connectorCall,runDurableConnector} from '../../frontend/public/firbo-connector.mjs';
const jobRow=(id=randomUUID())=>({id,device_id:DEVICE,organization_id:ORG,status:'running',result:null,error:null,created_at:new Date().toISOString()});
const payload=(id,report={ok:true,result:{value:42}})=>({action:'report',token:TOKEN,...reportEnvelope(id,report)});

test('authenticated device receives the exact supported report protocol',async()=>{
 const {invoke}=await makeHandler();const r=await invoke({action:'capabilities',token:TOKEN});assert.equal(r.status,200);
 const p=await r.json();assert.equal(p.protocol,'firbo-connector/v2');assert.equal(p.report_ack,'sha256-v1');assert.equal(p.remote_stop,true);assert.equal(p.running_stop,'cancel-request-v1');assert.equal(p.queued_cancel_only,false);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('poll claims work only through the atomic server RPC',async()=>{
 const {state,invoke}=await makeHandler();const row={...jobRow(),status:'queued',kind:'read',params:{path:'synthetic'},created_at:new Date().toISOString()};state.rows.connector_jobs.push(row);
 const response=await invoke({action:'poll',token:TOKEN});assert.equal(response.status,200);
 assert.deepEqual((await response.json()).job,{id:row.id,kind:'read',params:{path:'synthetic'}});
 assert.equal(row.status,'running');assert.equal(state.claims.length,1);
 assert.deepEqual(state.claims[0].p_org,ORG);assert.deepEqual(state.claims[0].p_device,DEVICE);
});
test('capabilities do not bypass token authentication',async()=>{
 const {invoke,state}=await makeHandler();for(const token of [undefined,'a'.repeat(40),'b'.repeat(64),'not-a-token']){
  assert.equal((await invoke({action:'capabilities',token})).status,401);
 }assert.equal(state.writes.length,0);
});
test('unpaired or revoked device cannot report or read capabilities',async()=>{
 const {invoke,state}=await makeHandler();state.rows.connector_devices[0].paired=false;
 assert.equal((await invoke({action:'capabilities',token:TOKEN})).status,401);
 state.rows.connector_devices[0].paired=true;state.rows.connector_devices[0].revoked_at=new Date().toISOString();
 assert.equal((await invoke({action:'capabilities',token:TOKEN})).status,401);
});
test('authentication database error is unavailable, not unauthorized',async()=>{
 for(const table of ['connector_secrets','connector_devices']){
  const {state,invoke}=await makeHandler();state.failures.push({table,type:'read'});
  assert.equal((await invoke({action:'capabilities',token:TOKEN})).status,503);
 }
});
test('report commits only the authenticated device/company running row',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);
 const sent=payload(row.id);const r=await invoke(sent);assert.equal(r.status,200);const ack=await r.json();
 assert.equal(ack.job_id,row.id);assert.equal(ack.report_sha256,sent.report_sha256);assert.equal(ack.duplicate,false);
 assert.equal(row.status,'done');assert.deepEqual(row.result,{value:42});
});
test('duplicate successful report is acknowledged without a second state change',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);const sent=payload(row.id);
 await invoke(sent);const finished=row.finished_at;const ack=await(await invoke(sent)).json();
 assert.equal(ack.duplicate,true);assert.equal(ack.report_sha256,sent.report_sha256);assert.equal(row.finished_at,finished);
 assert.equal(state.writes.filter(w=>w.table==='connector_jobs'&&w.matched>0).length,1);
});
test('duplicate failure report is acknowledged consistently',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);
 const sent=payload(row.id,{ok:false,error:'command_failed_exit_7'});assert.equal((await invoke(sent)).status,200);
 assert.equal((await(await invoke(sent)).json()).duplicate,true);assert.equal(row.status,'error');assert.equal(row.error,'command_failed_exit_7');
});
test('matching JSON with a different property order is the same receipt',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);
 await invoke(payload(row.id,{ok:true,result:{a:1,b:2}}));
 const r=await invoke(payload(row.id,{ok:true,result:{b:2,a:1}}));assert.equal(r.status,200);assert.equal((await r.json()).duplicate,true);
});
test('different result for completed job conflicts rather than overwriting',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);await invoke(payload(row.id));
 const r=await invoke(payload(row.id,{ok:true,result:{value:43}}));assert.equal(r.status,409);assert.deepEqual(row.result,{value:42});
});
test('simultaneous different terminal reports have exactly one winner',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);
 const results=await Promise.all([invoke(payload(row.id,{ok:true,result:{v:1}})),invoke(payload(row.id,{ok:true,result:{v:2}}))]);
 assert.deepEqual(results.map(x=>x.status).sort(),[200,409]);assert.equal(state.writes.filter(w=>w.table==='connector_jobs'&&w.matched).length,1);
});
test('wrong device or company cannot observe or finalize the row',async()=>{
 for(const field of ['device_id','organization_id']){
  const {state,invoke}=await makeHandler();const row={...jobRow(),[field]:randomUUID()};state.rows.connector_jobs.push(row);
  assert.equal((await invoke(payload(row.id))).status,404);assert.equal(row.status,'running');
 }
});
test('queued/cancelled job is not a successful report target',async()=>{
 for(const status of ['queued','cancelled']){const {state,invoke}=await makeHandler();const row={...jobRow(),status};state.rows.connector_jobs.push(row);
 assert.equal((await invoke(payload(row.id))).status,409);assert.equal(row.status,status);}
});
test('bad reported digest fails before a write',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);
 assert.equal((await invoke({...payload(row.id),report_sha256:'f'.repeat(64)})).status,400);assert.equal(state.writes.length,0);
});
test('malformed job ID and nonboolean ok fail before a write',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);
 for(const changes of [{job_id:'../other'},{ok:'true'},{result:[]}])assert.equal((await invoke({...payload(row.id),...changes})).status,400);
 assert.equal(state.writes.length,0);
});
test('persistence failure yields 503, not false receipt',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);state.failures.push({table:'connector_jobs',type:'update'});
 assert.equal((await invoke(payload(row.id))).status,503);assert.equal(row.status,'running');
});
test('receipt lookup failure yields 503 and preserves terminal record',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);await invoke(payload(row.id));
 state.failures.push({table:'connector_jobs',type:'read'});assert.equal((await invoke(payload(row.id))).status,503);assert.equal(row.status,'done');
});
test('old client without receipt digest remains backward compatible',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);const data=payload(row.id);delete data.report_sha256;
 assert.equal((await invoke(data)).status,200);assert.equal(row.status,'done');
});
test('body limit checks actual bytes before auth or database access',async()=>{
 const {state,handler}=await makeHandler();const req=new Request('https://synthetic.invalid',{method:'POST',body:'x'.repeat(256001)});
 assert.equal((await handler(req)).status,413);assert.equal(state.reads.length,0);
});
test('invalid top-level JSON is refused before database access',async()=>{
 const {state,handler}=await makeHandler();for(const body of ['[]','null','not-json'])assert.equal((await handler(new Request('https://synthetic.invalid',{method:'POST',body}))).status,400);
 assert.equal(state.reads.length,0);
});
test('aborted request cancels its body reader',async()=>{
 const {handler}=await makeHandler();const abort=new AbortController();let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 const req=new Request('https://synthetic.invalid',{method:'POST',body:stream,duplex:'half',signal:abort.signal});
 const promise=handler(req);abort.abort();assert.equal((await promise).status,400);assert.equal(cancelled,true);
});
test('deep or multibyte oversized reports are refused without terminal write',async()=>{
 const {state,invoke}=await makeHandler();const row=jobRow();state.rows.connector_jobs.push(row);let deep=null;for(let i=0;i<40;i++)deep={next:deep};
 assert.equal((await invoke({action:'report',token:TOKEN,job_id:row.id,ok:true,result:deep})).status,400);
 assert.equal((await invoke({action:'report',token:TOKEN,job_id:row.id,ok:true,result:{data:'α'.repeat(90000)}})).status,413);
 assert.equal(state.writes.length,0);
});

// Real HTTP and filesystem, but the above deliberately synthetic identity/database.
async function localServer(t, handler, drop) {
 const server=http.createServer(async(req,res)=>{
  const chunks=[];for await(const part of req)chunks.push(part);const bytes=Buffer.concat(chunks);
  const request=new Request('http://127.0.0.1/connector',{method:req.method,headers:{'content-type':'application/json'},body:bytes});
  try{const answer=await handler(request);const data=await answer.text();
   if(drop?.(JSON.parse(bytes.toString()),JSON.parse(data))){res.destroy();return;}
   res.writeHead(answer.status,{'content-type':'application/json'});res.end(data);
  }catch{res.writeHead(500);res.end('{}');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const url=`http://127.0.0.1:${server.address().port}/connector`;
 return (action,body,options={})=>connectorCall(action,body,{...options,fetchImpl:(_neverContactedProduction,init)=>fetch(url,init)});
}

test('real HTTP lost acknowledgment: write once, resend receipt, finalize actual handler once',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-loop-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const {state,handler}=await makeHandler();const file=path.join(root,'artifact.md');const id=randomUUID();const text='# Report\nPublic synthetic test data.\n';
 state.rows.connector_jobs.push({...jobRow(id),status:'queued',kind:'write',params:{path:file,content:text,overwrite:false}});
 let reports=0;const callFn=await localServer(t,handler,(body,ack)=>{if(body.action==='report'&&ack.ok){reports++;return reports===1;}return false;});
 const done=await runDurableConnector({token:TOKEN,roots:[root],allowWrite:true,auto:true},{directory:path.join(root,'state'),callFn,maxJobs:1});
 assert.equal(done.processed,1);assert.equal(reports,2);assert.equal(await fs.readFile(file,'utf8'),text);
 const row=state.rows.connector_jobs[0];assert.equal(row.status,'done');
 assert.equal(row.result.verification.sha256,createHash('sha256').update(text).digest('hex'));
 assert.equal(state.writes.filter(w=>w.table==='connector_jobs'&&w.keys.includes('result')&&w.matched).length,1);
});
test('real HTTP scripted read -> report write -> readback workflow persists each receipt (not LLM)',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-report-loop-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const input=path.join(root,'public-notes.txt'),output=path.join(root,'report.md');await fs.writeFile(input,'Task A: complete\nTask B: pending\n');
 const {state,handler}=await makeHandler();const first={...jobRow(),status:'queued',kind:'read',params:{path:input}};state.rows.connector_jobs.push(first);
 const callFn=await localServer(t,handler,(body,ack)=>{
  if(body.action==='report'&&ack.ok&&!ack.duplicate){
   if(body.job_id===first.id)state.rows.connector_jobs.push({...jobRow(),status:'queued',kind:'write',params:{path:output,content:'# Task report\n\n'+body.result.content,overwrite:false}});
   else if(state.rows.connector_jobs.length===2)state.rows.connector_jobs.push({...jobRow(),status:'queued',kind:'read',params:{path:output}});
  }return false;
 });
 const result=await runDurableConnector({token:TOKEN,roots:[root],allowWrite:true,auto:true},{directory:path.join(root,'state'),callFn,maxJobs:3});
 assert.equal(result.processed,3);assert.ok(state.rows.connector_jobs.every(row=>row.status==='done'));
 const written=state.rows.connector_jobs[1].result,read=state.rows.connector_jobs[2].result;
 assert.equal(written.verification.sha256,read.sha256);assert.equal(read.content,await fs.readFile(output,'utf8'));
});
