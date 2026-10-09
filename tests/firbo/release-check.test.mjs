import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {PROJECT,REPOSITORY,FUNCTIONS,ASSETS,JWT,collectBundle,deploymentBundle,verifyRelease,relativeImports,gitReader} from '../../tools/firbo-release-check.mjs';

const source='a'.repeat(40), shared='b'.repeat(40), parity='c'.repeat(40), previous='d'.repeat(40);
const now=Date.parse('2026-10-07T13:00:00Z');
const sha=s=>createHash('sha256').update(s).digest('hex');
function fixture() {
  const files = new Map(FUNCTIONS.map(name=>['supabase/functions/'+name+'/index.ts',"import {check} from '../_shared/check.ts';\ncheck();\n"]));
  files.set('supabase/functions/_shared/check.ts','export function check() {}\n');
  for (const asset of ASSETS) files.set('frontend/public/'+asset,'reviewed '+asset+'\n');
  const readSource=file=>{if(!files.has(file))throw Error('missing');return files.get(file);};
  const evidence={schema:'firbo-release-evidence/v1',project_id:PROJECT,repository:REPOSITORY,
    captured_at:new Date(now).toISOString(),source_commit:source,shared_head:shared,parity_head:parity,
    functions:FUNCTIONS.map(name=>({name,slug:name,status:'ACTIVE',version:1,verify_jwt:JWT[name],
      files:[...collectBundle(name,readSource)].map(([name,content])=>({name,content}))})),
    frontend:{deployment_id:'dpl_Synthetic',state:'READY',target:'production',source_commit:previous,
      aliases:['firboai.app','javris.firboai.app'],assets:ASSETS.map(name=>({name,status:200,sha256:sha(readSource('frontend/public/'+name))}))}};
  const options={source,observedShared:shared,observedParity:parity,readSource,now,isAncestor:()=>true,frontendTree:()=> 'same-frontend-tree'};
  return {evidence,options,files};
}

test('complete source, production and served assets pass without making a task-acceptance claim',()=>{
  const {evidence,options}=fixture();const result=verifyRelease(evidence,options);
  assert.equal(result.ok,true);assert.equal(result.functions.length,6);assert.match(result.scope,/parity only/);
  assert.match(result.limitations.join(' '),/Not authenticated business/);
});
test('rejects wrong product evidence before reading any source',()=>{
  for(const key of ['project_id','repository']){const {evidence,options}=fixture();evidence[key]='another-product';options.readSource=()=>assert.fail('no cross-product read');assert.throws(()=>verifyRelease(evidence,options),/wrong evidence/);}
});
test('requires fresh snapshots and rejects invalid/future timestamps',()=>{
  for(const captured of [now-16*60_000,now+61_000,'invalid']){const {evidence,options}=fixture();evidence.captured_at=typeof captured==='number'?new Date(captured).toISOString():captured;assert.throws(()=>verifyRelease(evidence,options),/timestamp/);}
});
test('a concurrent shared or parity update invalidates the release snapshot',()=>{
  for(const key of ['observedShared','observedParity']){const {evidence,options}=fixture();options[key]='e'.repeat(40);assert.throws(()=>verifyRelease(evidence,options),/heads moved/);}
});
test('candidate cannot omit either contributor even when supplied heads match',()=>{
  for(const missing of [shared,parity]){const {evidence,options}=fixture();options.isAncestor=parent=>parent!==missing;assert.throws(()=>verifyRelease(evidence,options),/omits current/);}
});
test('missing dependency reproduces the incomplete runner deployment failure',()=>{
  const {evidence,options}=fixture();evidence.functions.find(f=>f.name==='agent-runner').files.pop();
  assert.throws(()=>verifyRelease(evidence,options),/agent-runner: missing=_shared\/check.ts/);
});
test('old Connector entrypoint is rejected even with a current version label',()=>{
  const {evidence,options}=fixture();const connector=evidence.functions.find(f=>f.name==='connector');connector.version=999;connector.files[0].content+='// take_control handler absent\n';
  assert.throws(()=>verifyRelease(evidence,options),/connector:.*changed=connector\/index.ts/);
});
test('duplicate, extra and missing function/file snapshots cannot hide differences',()=>{
  for(const mutate of [e=>e.functions.pop(),e=>e.functions[1]=e.functions[0],e=>e.functions[0].files.push(e.functions[0].files[0]),e=>e.functions[0].files.push({name:'_shared/extra.ts',content:'extra'})]){
    const {evidence,options}=fixture();mutate(evidence);assert.throws(()=>verifyRelease(evidence,options),/required|duplicate|extra=/);
  }
});
test('refuses traversal, inactive deployments and unexpected JWT settings',()=>{
  for(const mutate of [e=>e.functions[0].files[0].name='../agent-chat/index.ts',e=>e.functions[0].status='REMOVED',e=>e.functions[0].verify_jwt=true]){
    const {evidence,options}=fixture();mutate(evidence);assert.throws(()=>verifyRelease(evidence,options),/unsafe|inactive|JWT/);
  }
});
test('preview, stale frontend source, missing alias or replaced asset blocks release completion',()=>{
  for(const mutate of [(e,o)=>e.frontend.target='preview',(e,o)=>o.frontendTree=commit=>commit,(e,o)=>e.frontend.aliases.pop(),(e,o)=>e.frontend.assets[0].sha256='0'.repeat(64),(e,o)=>e.frontend.assets[0].status=404]){
    const {evidence,options}=fixture();mutate(evidence,options);assert.throws(()=>verifyRelease(evidence,options),/frontend|aliases|asset/);
  }
});
test('mission-runner retains its platform JWT check in validation and deployment payloads',()=>{
  const {evidence,options}=fixture();
  assert.equal(deploymentBundle('mission-runner',options.readSource).verify_jwt,true);
  evidence.functions.find(f=>f.name==='mission-runner').verify_jwt=false;
  assert.throws(()=>verifyRelease(evidence,options),/mission-runner: unexpected JWT/);
});
test('a deployment with a different frontend history cannot be blessed by matching trees alone',()=>{
  const {evidence,options}=fixture();options.isAncestor=parent=>parent!==previous;
  assert.throws(()=>verifyRelease(evidence,options),/production frontend differs/);
});
test('complete deployment payload is pinned to FIRBO and includes transitive imports and exact newlines',()=>{
  const {options,files}=fixture();files.set('supabase/functions/_shared/check.ts',"export {thing} from './nested.ts';\n");files.set('supabase/functions/_shared/nested.ts','export const thing=1;\n');
  const bundle=deploymentBundle('connector',options.readSource);
  assert.equal(bundle.project_id,PROJECT);assert.equal(bundle.entrypoint_path,'connector/index.ts');assert.equal(bundle.files.length,3);
  assert.equal(bundle.files.find(f=>f.name==='_shared/nested.ts').content,'export const thing=1;\n');
  files.delete('supabase/functions/_shared/nested.ts');assert.throws(()=>deploymentBundle('connector',options.readSource),/missing source dependency/);
});
test('closure supports literal dynamic/side-effect imports, cycles and Deno config',()=>{
  const {files,options}=fixture();files.set('supabase/functions/connector/index.ts',"import '../_shared/check.ts';\nconst mod=import('../_shared/dynamic.ts');\n");
  files.set('supabase/functions/_shared/check.ts',"import '../connector/index.ts';\n");files.set('supabase/functions/_shared/dynamic.ts','export default 1;\n');
  files.set('supabase/functions/connector/deno.json','{"compilerOptions":{"strict":true}}\n');
  assert.equal(collectBundle('connector',options.readSource).size,4);
  assert.throws(()=>relativeImports('const m=import(remotePath);'),/non-literal dynamic import/);
  files.set('supabase/functions/connector/index.ts',"import '../../../outside.ts';");assert.throws(()=>collectBundle('connector',options.readSource),/escapes function tree/);
});
test('real Git reader preserves committed bytes, ignores dirty copies and verifies actual ancestry',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'firbo-release-check-'));
  const git=(...args)=>execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try{
    git('init','-q');git('config','user.name','Synthetic');git('config','user.email','synthetic@example.invalid');
    mkdirSync(path.join(dir,'frontend'));writeFileSync(path.join(dir,'frontend','asset'),'exact\n\n');git('add','.');git('commit','-qm','first');const first=git('rev-parse','HEAD');
    writeFileSync(path.join(dir,'marker'),'second');git('add','.');git('commit','-qm','second');const second=git('rev-parse','HEAD');
    const reader=gitReader(dir,second);writeFileSync(path.join(dir,'frontend','asset'),'dirty');
    assert.equal(reader.readSource('frontend/asset'),'exact\n\n');assert.equal(reader.isAncestor(first,second),true);assert.equal(reader.isAncestor(second,first),false);
    assert.equal(reader.frontendTree(first),reader.frontendTree(second));
  }finally{rmSync(dir,{recursive:true,force:true});}
});
