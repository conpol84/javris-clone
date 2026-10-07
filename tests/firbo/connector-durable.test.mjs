import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { LocalJobJournal, executeJournaled, flushPendingReports, runDurableConnector, executeJobForReport, runCommand,
  connectorCall, reportEnvelope, canonicalJSON } from '../../frontend/public/firbo-connector.mjs';
const moduleURL = new URL('../../frontend/public/firbo-connector.mjs', import.meta.url).href;
const scope = createHash('sha256').update('synthetic-device-scope').digest('hex');
const token = 'a'.repeat(64);
async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'firbo-durable-test-'));
  const cfg = { token, roots: [root], allowWrite: true, allowExec: false, auto: true };
  const journal = await LocalJobJournal.open(path.join(root, 'private-state'), scope); journal.acquire();
  t.after(async () => { journal.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, cfg, journal, directory: path.join(root, 'private-state') };
}
function writeJob(root, name = 'report.md') { return { id: randomUUID(), kind: 'write', params: { path: path.join(root, name), content: '# Verified report\n\nSynthetic local document.\n', overwrite: false } }; }
const receipt = body => ({ ok: true, job_id: body.job_id, report_sha256: body.report_sha256 });

 test('real write commits a verifiable report into SQLite BEFORE delivery', async t => {
  const { root, cfg, journal } = await setup(t); const job = writeJob(root);
  const result = await executeJournaled(job, cfg, journal);
  assert.equal(result.ok, true); const [pending] = journal.pending();
  const file = await fs.readFile(job.params.path);
  assert.equal(pending.result.verification.method, 'sha256-readback');
  assert.equal(pending.result.verification.sha256, createHash('sha256').update(file).digest('hex'));
  assert.equal(pending.report_sha256, reportEnvelope(job.id, pending).report_sha256);
});
test('journal survives close/reopen with identical undelivered receipt', async t => {
 const { root, cfg, journal, directory } = await setup(t); const job = writeJob(root);
 await executeJournaled(job, cfg, journal); const before = journal.pending(); journal.close();
 const restored = await LocalJobJournal.open(directory, scope); restored.acquire();
 try { assert.deepEqual(restored.pending(), before); } finally { restored.close(); }
});
test('failed report transport retains result and never reexecutes the file write', async t => {
 const { root, cfg, journal } = await setup(t); const job = writeJob(root);
 await executeJournaled(job, cfg, journal);
 await assert.rejects(flushPendingReports(cfg,journal,async()=>{throw new Error('connector_unreachable');}),/unreachable/);
 assert.equal(journal.pending().length,1);
 assert.deepEqual(await executeJournaled(job,cfg,journal),{executed:false,phase:'ready'});
 await flushPendingReports(cfg,journal,async(_action,body)=>receipt(body));
 assert.equal(journal.pending().length,0);
 assert.deepEqual(await executeJournaled(job,cfg,journal),{executed:false,phase:'acked'});
 assert.equal(await fs.readFile(job.params.path,'utf8'),job.params.content);
});
test('lost-ack retry submits the SAME result digest', async t => {
 const {root,cfg,journal}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);
 const sent=[];const api=async(a,b)=>{sent.push(structuredClone(b));if(sent.length===1)throw new Error('connector_unreachable');return receipt(b);};
 await assert.rejects(flushPendingReports(cfg,journal,api));await flushPendingReports(cfg,journal,api);
 assert.deepEqual(sent[0],sent[1]);assert.equal(journal.pending().length,0);
});
test('fake or mismatched receipt cannot delete the private pending result',async t=>{
 const {root,cfg,journal}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);
 for(const ack of [{ok:true},{ok:true,job_id:randomUUID(),report_sha256:'0'.repeat(64)}]){
  await assert.rejects(flushPendingReports(cfg,journal,async()=>ack),/report_ack_mismatch/);assert.equal(journal.pending().length,1);
 }
});
test('terminal conflict quarantines the record rather than silently retrying work',async t=>{
 const {root,cfg,journal}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);
 await assert.rejects(flushPendingReports(cfg,journal,async()=>{throw Object.assign(new Error('conflict'),{status:409});}),/delivery_conflict/);
 assert.throws(()=>journal.pending(),/delivery_conflict/);assert.equal(journal.counts()[0].phase,'conflict');
});
test('revoked token preserves pending data without acknowledging it',async t=>{
 const {root,cfg,journal}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);
 await assert.rejects(flushPendingReports(cfg,journal,async()=>{throw Object.assign(new Error('unauthorized'),{status:401});}));
 assert.equal(journal.pending().length,1);
});
test('same ID with changed parameters is never executed',async t=>{
 const {root,cfg,journal}=await setup(t);const job=writeJob(root);await executeJournaled(job,cfg,journal);
 await assert.rejects(executeJournaled({...job,params:{...job.params,content:'Changed'}},cfg,journal),/job_identity_changed/);
});
test('unowned journal cannot authorize a side effect',async t=>{
 const {root,cfg,directory}=await setup(t);const second=await LocalJobJournal.open(directory,scope);
 try { await assert.rejects(executeJournaled(writeJob(root),cfg,second),/journal_not_owned/); }
 finally { second.close(); } // Close every SQLite handle before the fixture removes files (Windows).

});
test('two workers cannot own the same journal',async t=>{
 const {directory}=await setup(t);const second=await LocalJobJournal.open(directory,scope);
 try { assert.throws(()=>second.acquire(),/connector_already_running/); }
 finally { second.close(); } // Do not rely on after-hook ordering to release an open Windows file.

});
test('active STARTED work cannot be replayed by another call',async t=>{
 const {root,cfg,journal}=await setup(t);const job=writeJob(root);journal.begin(job);
 await assert.rejects(executeJournaled(job,cfg,journal),/job_already_started/);await assert.rejects(fs.stat(job.params.path),{code:'ENOENT'});
});
test('interrupted intent becomes review-required failure, not automatic reexecution',async t=>{
 const {root,cfg,journal}=await setup(t);const job=writeJob(root);journal.begin(job);
 await fs.writeFile(job.params.path,'partial side effect');
 assert.equal(journal.recoverInterrupted(),1);assert.equal(journal.pending()[0].error,'execution_interrupted_needs_review');
 await executeJournaled(job,cfg,journal);assert.equal(await fs.readFile(job.params.path,'utf8'),'partial side effect');
});
test('real dead worker lock is reclaimed transactionally and its work is NOT replayed',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-dead-worker-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const id=randomUUID();const job={id,kind:'write',params:{path:path.join(root,'crash.txt'),content:'never replay'}};
 const script=`import {LocalJobJournal} from ${JSON.stringify(moduleURL)};import fs from 'node:fs/promises';
 const j=await LocalJobJournal.open(${JSON.stringify(root)},${JSON.stringify(scope)});j.acquire();j.begin(${JSON.stringify(job)});
 await fs.writeFile(${JSON.stringify(job.params.path)},'side effect before crash');process.exit(0);`;
 execFileSync(process.execPath,['--input-type=module','-e',script],{timeout:5000,stdio:'pipe'});
 const j=await LocalJobJournal.open(root,scope);j.acquire();try{assert.equal(j.recoverInterrupted(),1);assert.equal(j.pending()[0].ok,false);}finally{j.close();}
 assert.equal(await fs.readFile(job.params.path,'utf8'),'side effect before crash');
});
test('invalid job IDs cannot create a ledger row or touch a file',async t=>{
 const {root,cfg,journal}=await setup(t);await assert.rejects(executeJournaled({...writeJob(root),id:'../../other'},cfg,journal),/bad_job/);
 assert.equal(journal.counts().length,0);
});
test('oversized result is explicit review-required failure, never an undeliverable success',async t=>{
 const {root,cfg,journal}=await setup(t);await executeJournaled(writeJob(root),cfg,journal,{executor:async()=>({ok:true,result:{data:'x'.repeat(200000)}})});
 assert.equal(journal.pending()[0].ok,false);assert.equal(journal.pending()[0].error,'result_unavailable_needs_review');
});
test('receipt canonicalization is independent of object-key insertion order',()=>{
 const id=randomUUID();const a=reportEnvelope(id,{ok:true,result:{a:1,b:{x:'α',y:true}}});
 const b=reportEnvelope(id,{ok:true,result:{b:{y:true,x:'α'},a:1}});assert.equal(a.report_sha256,b.report_sha256);
});
test('invalid JSON values and excessive nesting cannot be acknowledged',()=>{
 for(const value of [undefined,NaN,Infinity,()=>{},new Date()])assert.throws(()=>canonicalJSON(value));
 let deep=null;for(let i=0;i<40;i++)deep={next:deep};assert.throws(()=>canonicalJSON(deep));
});
test('journal path scope is strict and cannot inject another directory',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-bad-scope-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await assert.rejects(LocalJobJournal.open(root,'../../somewhere'),/invalid_journal_scope/);
});
test('journal stores neither raw device token nor server URL',async t=>{
 const {root,cfg,journal,directory}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);journal.close();
 const bytes=await fs.readFile(path.join(directory,scope,'outbox.sqlite3'));
 assert.equal(bytes.includes(Buffer.from(token)),false);assert.equal(bytes.includes(Buffer.from('supabase.co')),false);
});
test('journal rejects a linked database file',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-journal-link-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,scope),{mode:0o700});const actual=path.join(root,'other.db');await fs.writeFile(actual,'',{mode:0o600});
 await fs.link(actual,path.join(root,scope,'outbox.sqlite3'));await assert.rejects(LocalJobJournal.open(root,scope),/unsafe_journal_file/);
});
test('pending payload is purged after a matching durable acknowledgment',async t=>{
 const {root,cfg,journal,directory}=await setup(t);const job=writeJob(root);await executeJournaled(job,cfg,journal);
 await flushPendingReports(cfg,journal,async(_a,b)=>receipt(b));assert.equal(journal.counts()[0].phase,'acked');journal.close();
 const bytes=await fs.readFile(path.join(directory,scope,'outbox.sqlite3'));assert.equal(bytes.includes(Buffer.from(job.params.path)),false);
});
test('different token scopes cannot deliver each other\'s reports',async t=>{
 const {root,cfg,journal,directory}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);
 const other=await LocalJobJournal.open(directory,'b'.repeat(64));other.acquire();try{assert.equal(other.pending().length,0);}finally{other.close();}
});
test('pre-aborted local operation never creates a file',async t=>{
 const {root,cfg,journal}=await setup(t);const c=new AbortController();c.abort();const job=writeJob(root);
 await assert.rejects(executeJournaled(job,cfg,journal,{signal:c.signal}),/operation_stopped/);assert.equal(journal.counts().length,0);
 await assert.rejects(fs.stat(job.params.path),{code:'ENOENT'});
});
test('aborted report flush preserves the pending receipt',async t=>{
 const {root,cfg,journal}=await setup(t);await executeJournaled(writeJob(root),cfg,journal);const c=new AbortController();c.abort();let calls=0;
 await flushPendingReports(cfg,journal,async()=>{calls++;},c.signal);assert.equal(calls,0);assert.equal(journal.pending().length,1);
});
test('network request responds to local Stop without waiting for timeout',async()=>{
 const c=new AbortController();let started;
 const ready=new Promise(r=>started=r);
 const req=connectorCall('poll',{token},{signal:c.signal,fetchImpl:(_u,o)=>new Promise((_r,j)=>{o.signal.addEventListener('abort',()=>j(new Error('aborted')));started();})});
 await ready;c.abort();await assert.rejects(req,/connector_stopped/);
});
test('actual local shell observes Stop as a failed operation',async t=>{
 const {root,cfg}=await setup(t);const c=new AbortController();const code='setInterval(()=>{},1000)';
 const command=`"${process.execPath}" -e "${code}"`;const result=executeJobForReport({kind:'exec',params:{command,cwd:root}},{...cfg,allowExec:true},{signal:c.signal});
 setTimeout(()=>c.abort(),150);const report=await result;assert.equal(report.ok,false);assert.equal(report.error,'operation_stopped');
});
test('actual local shell timeout is not success',async t=>{
 const {root}=await setup(t);const result=await runCommand(`"${process.execPath}" -e "setInterval(()=>{},1000)"`,root,{timeoutMs:100});
 assert.equal(result.interrupted,'timeout');
});
test('static hardlink write cannot change an outside file',async t=>{
 const {root,cfg}=await setup(t);const other=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-outside-'));t.after(()=>fs.rm(other,{recursive:true,force:true}));
 const secret=path.join(other,'outside.txt');await fs.writeFile(secret,'original');await fs.link(secret,path.join(root,'linked.txt'));
 const r=await executeJobForReport({kind:'write',params:{path:path.join(root,'linked.txt'),content:'bad',overwrite:true}},cfg);
 assert.equal(r.ok,false);assert.equal(r.error,'unsafe_file_type');assert.equal(await fs.readFile(secret,'utf8'),'original');
});
test('FIFO is refused without blocking the worker', {skip:process.platform==='win32'},async t=>{
 const {root,cfg}=await setup(t);const fifo=path.join(root,'pipe');execFileSync('mkfifo',[fifo]);
 const r=await executeJobForReport({kind:'read',params:{path:fifo}},cfg);assert.equal(r.ok,false);assert.equal(r.error,'unsafe_file_type');
});
test('old backend protocol cannot trigger a poll or a local effect',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-old-protocol-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const calls=[];
 await assert.rejects(runDurableConnector({token,roots:[root]},{directory:root,maxJobs:1,callFn:async(a)=>{calls.push(a);return {ok:true};}}),/matching_connector_backend_required/);
 assert.deepEqual(calls,['capabilities']);
});
test('temporary connection failure during startup retries before polling any work', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-startup-retry-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const calls=[], events=[];
 const result=await runDurableConnector({token,roots:[],allowBrowser:true},{directory:root,maxJobs:0,
  callFn:async action=>{calls.push(action);if(calls.length===1)throw new Error('connector_unreachable');return {protocol:'firbo-connector/v2',report_ack:'sha256-v1'};},
  onEvent:event=>events.push(event)});
 assert.deepEqual(calls,['capabilities','capabilities']);
 assert.deepEqual(events,['connection_retry_without_reexecution','connected_to_firbo']);
 assert.equal(result.processed,0);assert.deepEqual(result.local_states,[]);
});
test('revoked startup authentication fails immediately without retrying or polling', async t => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'firbo-startup-revoked-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const calls=[];
 await assert.rejects(runDurableConnector({token,roots:[],allowBrowser:true},{directory:root,maxJobs:0,callFn:async action=>{
  calls.push(action);throw Object.assign(new Error('connector_http_401'),{status:401});
 }}),error=>error.status===401);
 assert.deepEqual(calls,['capabilities']);
});
test('real failed process result persists as failure through receipt delivery',async t=>{
 const {root,cfg,journal}=await setup(t);const j={id:randomUUID(),kind:'exec',params:{cwd:root,command:`"${process.execPath}" -e "process.exit(7)"`}};
 await executeJournaled(j,{...cfg,allowExec:true},journal);assert.equal(journal.pending()[0].error,'command_failed_exit_7');
 let sent;await flushPendingReports(cfg,journal,async(_a,b)=>{sent=b;return receipt(b);});assert.equal(sent.ok,false);assert.equal(journal.pending().length,0);
});

test('Stop also interrupts an ordinary descendant that ignores TERM and closes its pipes', {skip:process.platform==='win32'},async t=>{
 const {root,cfg}=await setup(t);const pidFile=path.join(root,'child.pid'),marker=path.join(root,'must-not-appear.txt');
 const childFile=path.join(root,'child.mjs'),parentFile=path.join(root,'parent.mjs');
 await fs.writeFile(childFile,`import fs from 'node:fs';process.on('SIGTERM',()=>{});fs.writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setTimeout(()=>fs.writeFileSync(${JSON.stringify(marker)},'continued'),750);setInterval(()=>{},1000);`);
 await fs.writeFile(parentFile,`import {spawn} from 'node:child_process';spawn(process.execPath,[${JSON.stringify(childFile)}],{stdio:'ignore'});setInterval(()=>{},1000);`);
 const c=new AbortController();const execution=executeJobForReport({kind:'exec',params:{cwd:root,command:`"${process.execPath}" "${parentFile}"`}},{...cfg,allowExec:true},{signal:c.signal});
 let pid;
 try{
  for(let i=0;i<100;i++){try{pid=Number(await fs.readFile(pidFile,'utf8'));break;}catch{}await new Promise(r=>setTimeout(r,20));}
  assert.ok(pid,'test child never started');c.abort();const result=await execution;assert.equal(result.ok,false);
  await new Promise(r=>setTimeout(r,900));await assert.rejects(fs.stat(marker),{code:'ENOENT'});
 }finally{c.abort();if(pid){try{process.kill(pid,'SIGKILL');}catch{}}await execution;}
});

test('normal file jobs cannot read or overwrite the locally protected outbox',async t=>{
 const {root,cfg,directory,journal}=await setup(t);
 for(const kind of ['read','write']){
  const result=await executeJobForReport({kind,params:{path:path.join(directory,scope,'outbox.sqlite3'),content:'overwrite',overwrite:true}},
   {...cfg,internalProtectedPaths:[directory]});
  assert.equal(result.ok,false);assert.equal(result.error,'reserved_local_path');
 }
 assert.equal(journal.counts().length,0);
});
test('production connector endpoint requires HTTPS without URL credentials',async()=>{
 const {validateConnectorURL}=await import('../../frontend/public/firbo-connector.mjs');
 for(const url of ['http://host.test','file:///tmp/data','https://user:secret@host.test','https://host.test/?token=bad','https://host.test/#bad','not-a-url'])assert.throws(()=>validateConnectorURL(url));
 assert.equal(validateConnectorURL('https://host.test/functions/v1/connector'),'https://host.test/functions/v1/connector');
});
