// Real temporary files/processes; HTTP is always a fake Fetch transport.
// Does NOT pair a device, call Supabase/providers, or certify a sandbox/remote Stop.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { connectorCall, executeJobForReport, parseArgs, runJob, validateJob } from '../../frontend/public/firbo-connector.mjs';

let root, outside;
before(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'firbo-real-ops-'));
  outside = await fs.mkdtemp(path.join(os.tmpdir(), 'firbo-outside-'));
  await fs.writeFile(path.join(root, 'readme.txt'), 'Public synthetic example');
  await fs.writeFile(path.join(outside, 'private.txt'), 'Not permitted');
});
after(async () => { await fs.rm(root, {recursive:true,force:true}); await fs.rm(outside, {recursive:true,force:true}); });
const cfg = extra => ({ roots:[root], allowWrite:false, allowExec:false, auto:true, ...extra });
const job = (kind, params) => ({kind, params});
async function command(name, source) {
  const file = path.join(root, name + '.cjs');
  await fs.writeFile(file, source);
  return `"${process.execPath}" "${file}"`;
}
const response = data => new Response(JSON.stringify(data), {headers:{'content-type':'application/json'}});

test('real allowed file is read and reported successfully', async () => {
  const report = await executeJobForReport(job('read',{path:'readme.txt'}),cfg());
  assert.equal(report.ok,true); assert.equal(report.result.content,'Public synthetic example');
  assert.equal(report.result.truncated,false);
});
test('real new file is written then read back', async () => {
  const report = await executeJobForReport(job('write',{path:'report.txt',content:'Synthetic output'}),cfg({allowWrite:true}));
  assert.equal(report.ok,true);
  assert.equal(await fs.readFile(path.join(root,'report.txt'),'utf8'),'Synthetic output');
});
test('real exit-zero process produces a local artifact and success report', async () => {
  const script=await command('success', "require('node:fs').writeFileSync('process-result.txt','completed');console.log('synthetic done');");
  const report=await executeJobForReport(job('exec',{command:script}),cfg({allowExec:true}));
  assert.equal(report.ok,true);assert.equal(report.result.code,0);
  assert.match(report.result.stdout,/synthetic done/);
  assert.equal(await fs.readFile(path.join(root,'process-result.txt'),'utf8'),'completed');
});
test('real exit-7 process must NOT be reported done', async () => {
  const script=await command('failure',"console.error('PRIVATE_OUTPUT_MUST_NOT_BE_ECHOED');process.exit(7);");
  const report=await executeJobForReport(job('exec',{command:script}),cfg({allowExec:true}));
  assert.deepEqual(report,{ok:false,error:'command_failed_exit_7'});
  assert.doesNotMatch(JSON.stringify(report),/PRIVATE_OUTPUT/);
});
test('POSIX signal termination is not reported successful', {skip:process.platform==='win32'}, async () => {
  const report=await executeJobForReport(job('exec',{command:'kill -TERM $$'}),cfg({allowExec:true}));
  assert.deepEqual(report,{ok:false,error:'command_interrupted'});
});
test('remote job cannot turn on command permission', async () => {
  const script=await command('forbidden',"require('node:fs').writeFileSync('must-not-exist.txt','bad');");
  const report=await executeJobForReport({...job('exec',{command:script}),allowExec:true,auto:true},cfg());
  assert.deepEqual(report,{ok:false,error:'commands_disabled'});
  await assert.rejects(fs.stat(path.join(root,'must-not-exist.txt')),{code:'ENOENT'});
});
test('remote job cannot turn on write permission', async () => {
  assert.deepEqual(await executeJobForReport({...job('write',{path:'forbidden.txt',content:'x'}),allowWrite:true},cfg()),{ok:false,error:'writing_disabled'});
});
test('truthy permission text does not enable commands', async () => {
  assert.deepEqual(await executeJobForReport(job('exec',{command:'echo test'}),cfg({allowExec:'true'})),{ok:false,error:'commands_disabled'});
});
test('noninteractive writes without local auto-consent are declined', async () => {
  if (process.stdin.isTTY) return;
  assert.deepEqual(await executeJobForReport(job('write',{path:'ask.txt',content:'x'}),cfg({allowWrite:true,auto:false})),{ok:false,error:'declined_on_this_computer'});
});
test('outside-root file request is denied', async () => {
  assert.deepEqual(await executeJobForReport(job('read',{path:path.join(outside,'private.txt')}),cfg()),{ok:false,error:'outside_allowed_folders'});
});
test('non-overwrite request leaves existing bytes unchanged', async () => {
  const report=await executeJobForReport(job('write',{path:'readme.txt',content:'REPLACED'}),cfg({allowWrite:true}));
  assert.equal(report.ok,false);assert.equal(await fs.readFile(path.join(root,'readme.txt'),'utf8'),'Public synthetic example');
});
test('two exclusive creates cannot both replace the same file', async () => {
  const reports=await Promise.all(['first','second'].map(content=>executeJobForReport(job('write',{path:'one-create.txt',content}),cfg({allowWrite:true}))));
  assert.equal(reports.filter(r=>r.ok).length,1);
  const winner=await fs.readFile(path.join(root,'one-create.txt'),'utf8');assert.ok(['first','second'].includes(winner));
});
test('explicit overwrite retains existing contract', async () => {
  await fs.writeFile(path.join(root,'overwrite.txt'),'old');
  const report=await executeJobForReport(job('write',{path:'overwrite.txt',content:'new',overwrite:true}),cfg({allowWrite:true}));
  assert.equal(report.ok,true);assert.equal(await fs.readFile(path.join(root,'overwrite.txt'),'utf8'),'new');
});
test('large real file is refused without returning bytes', async () => {
  await fs.writeFile(path.join(root,'large.txt'),'x'.repeat(200001));
  assert.deepEqual(await executeJobForReport(job('read',{path:'large.txt'}),cfg()),{ok:false,error:'file_too_large'});
});
test('text preview truncation is explicit', async () => {
  await fs.writeFile(path.join(root,'preview.txt'),'x'.repeat(120000));
  const report=await executeJobForReport(job('read',{path:'preview.txt'}),cfg());
  assert.equal(report.ok,true);assert.equal(report.result.content.length,100000);assert.equal(report.result.truncated,true);assert.equal(report.result.bytes,120000);
});
test('binary real file is refused', async () => {
  await fs.writeFile(path.join(root,'binary.bin'),Buffer.from([1,0,2]));
  assert.deepEqual(await executeJobForReport(job('read',{path:'binary.bin'}),cfg()),{ok:false,error:'binary_file'});
});
test('directory listing reports the entry cap', async () => {
  const folder=path.join(root,'many');await fs.mkdir(folder);
  await Promise.all(Array.from({length:205},(_,i)=>fs.writeFile(path.join(folder,String(i)),'')));
  const result=await runJob(job('list',{path:folder}),cfg());assert.equal(result.entries.length,200);assert.equal(result.truncated,true);
});
test('missing file reports a code rather than an absolute path', async () => {
  const report=await executeJobForReport(job('read',{path:'missing.txt'}),cfg());
  assert.deepEqual(report,{ok:false,error:'file_enoent'});assert.ok(!JSON.stringify(report).includes(root));
});
test('invalid job inputs fail before local execution', () => {
  for(const invalid of [null,[],{},job('browser',{}),job('read',[]),job('read',{}),job('read',{path:32}),job('exec',{command:''}),job('exec',{command:'x'.repeat(501)}),job('write',{path:'x',content:42}),job('write',{path:'x',content:'a'.repeat(100001)}),job('write',{path:'x',content:'ok',overwrite:'true'}),job('list',{path:'bad\0path'})]) assert.throws(()=>validateJob(invalid));
});
test('empty allowed-folder option fails explicitly', () => {
  assert.throws(()=>parseArgs(['pair','CODE','--allow']),/missing_allowed_folder/);
  assert.throws(()=>parseArgs(['--allow','--allow-exec']),/missing_allowed_folder/);
});
test('legacy argument and job shape remains supported', () => {
  assert.deepEqual(parseArgs(['pair','CODE','--allow','/folder','--allow-write']),{_:['pair','CODE'],allow:['/folder'],allowWrite:true});
  assert.deepEqual(validateJob(job('list',{})),{});
});
test('successful mocked HTTP JSON is consumed normally', async () => {
  const actual=await connectorCall('poll',{token:'SYNTHETIC'},{fetchImpl:async(_url,options)=>{
    assert.equal(options.redirect,'error');assert.equal(options.method,'POST');return response({job:null});
  }});
  assert.deepEqual(actual,{job:null});
});
test('HTTP 401 retains status without echoing upstream content', async () => {
  await assert.rejects(connectorCall('poll',{}, {fetchImpl:async()=>new Response('SECRET',{status:401})}),e=>e.status===401 && !e.message.includes('SECRET'));
});
test('HTML fallback is not accepted as a successful API response', async () => {
  await assert.rejects(connectorCall('poll',{}, {fetchImpl:async()=>new Response('<html/>',{headers:{'content-type':'text/html'}})}),/connector_invalid_response/);
});
test('malformed JSON does not include upstream payload in error', async () => {
  await assert.rejects(connectorCall('poll',{}, {fetchImpl:async()=>new Response('SECRET invalid',{headers:{'content-type':'application/json'}})}),/connector_invalid_response/);
});
test('JSON arrays are not a valid connector protocol object', async () => {
  await assert.rejects(connectorCall('poll',{}, {fetchImpl:async()=>response([])}),/connector_invalid_response/);
});
test('response byte cap cancels reading before the whole stream', async () => {
  let reads=0,cancelled=false;
  const stream=new ReadableStream({pull(c){reads++;if(reads<=20)c.enqueue(new Uint8Array(100000));else c.close();},cancel(){cancelled=true;}});
  await assert.rejects(connectorCall('poll',{}, {fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}})}),/connector_response_too_large/);
  assert.ok(reads<20);assert.equal(cancelled,true);
});
test('hung body gets cancelled when total request timeout expires', async () => {
  let cancelled=false;
  const stream=new ReadableStream({cancel(){cancelled=true;}});
  await assert.rejects(connectorCall('poll',{}, {timeoutMs:25,fetchImpl:async()=>new Response(stream,{headers:{'content-type':'application/json'}})}),/connector_timeout/);
  assert.equal(cancelled,true);
});
test('hung fetch respects AbortSignal and returns bounded timeout', async () => {
  await assert.rejects(connectorCall('poll',{}, {timeoutMs:25,fetchImpl:async(_url,o)=>new Promise((_resolve,reject)=>o.signal.addEventListener('abort',()=>reject(new Error('aborted'))))}),/connector_timeout/);
});
test('oversized outgoing payload is refused before transport', async () => {
  let calls=0;
  await assert.rejects(connectorCall('report',{value:'x'.repeat(1024*1024+1)},{fetchImpl:async()=>{calls++;return response({});}}),/connector_request_too_large/);assert.equal(calls,0);
});
test('a caller body cannot override the selected operation', async () => {
  await connectorCall('poll',{action:'pair'}, {fetchImpl:async(_url,o)=>{assert.equal(JSON.parse(o.body).action,'poll');return response({job:null});}});
});
test('transport exceptions are not reflected verbatim', async () => {
  await assert.rejects(connectorCall('poll',{}, {fetchImpl:async()=>{throw new Error('secret token inside exception');}}),e=>e.message==='connector_unreachable');
});
