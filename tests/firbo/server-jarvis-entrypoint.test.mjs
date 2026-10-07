import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const root=new URL('../../',import.meta.url), originalFetch=globalThis.fetch, originalDeno=globalThis.Deno;
let current,handler;
const env={SUPABASE_URL:'https://db.test',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',OPENJARVIS_URL:'https://jarvis.example',OPENJARVIS_API_KEY:'synthetic-server-key'};
globalThis.Deno={env:{get:n=>env[n]},serve:h=>{handler=h}};
globalThis.__jarvisClient=()=>({auth:{getUser:async()=>({data:{user:current.unsigned?null:{id:'owner'}}})},from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:current.admin?{user_id:'owner'}:null})})})})});
const directory=await mkdtemp(join(tmpdir(),'firbo-server-bridge-'));
const source=(await readFile(new URL('supabase/functions/server-jarvis/index.ts',root),'utf8'))
 .replace("import { createClient } from 'npm:@supabase/supabase-js@2';","const createClient=(...args: any[]) => (globalThis as any).__jarvisClient(...args);")
 .replace("'../_shared/server-execution.ts'",JSON.stringify(new URL('supabase/functions/_shared/server-execution.ts',root).href))
 .replace("'../_shared/server-runtime.ts'",JSON.stringify(new URL('supabase/functions/_shared/server-runtime.ts',root).href));
const file=join(directory,'handler.ts');await writeFile(file,source);await import(pathToFileURL(file).href);
after(async()=>{globalThis.fetch=originalFetch;globalThis.Deno=originalDeno;delete globalThis.__jarvisClient;await rm(directory,{recursive:true,force:true});});
const evidence={contract:'openjarvis-execution/v1',mode:'agent',tool_count:1,failed_count:1,tools:[{name:'shell_exec',success:false,output:'Command failed',truncated:false}],truncated:false};
async function invoke(options={}) {
 current={admin:true,...options};const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push({url,init});return Response.json(String(url).endsWith('/v1/info')?{model:'model',runtime:options.runtime}:{choices:[{message:{content:'Done'}}],execution:options.execution});};
 const response=await handler(new Request('https://functions.test/server-jarvis',{method:'POST',headers:{authorization:'Bearer synthetic-user'},body:JSON.stringify({action:options.action??'chat',message:'Run the job'})}));
 return {response,body:await response.json(),calls};
}
test('anonymous and non-admin callers cannot retrieve tool outputs',async()=>{
 for(const [options,status] of [[{unsigned:true},401],[{admin:false},403]]){const r=await invoke(options);assert.equal(r.response.status,status);assert.equal(r.calls.length,0);}
});
test('actual admin bridge opts in and returns failures separately from the answer',async()=>{
 const r=await invoke({execution:{...evidence,privateMetadata:'not-exported'}});
 assert.equal(r.response.status,200);assert.equal(r.body.reply,'Done');assert.deepEqual(r.body.execution,evidence);
 const call=r.calls.find(c=>String(c.url).endsWith('/v1/chat/completions'));
 assert.equal(JSON.parse(call.init.body).firbo_include_execution,true);
 assert.equal(call.init.headers.authorization,'Bearer synthetic-server-key');
 assert.ok(!JSON.stringify(r.body).includes('synthetic-server-key'));
});
test('old or malformed server receipt is explicitly unverified',async()=>{
 for(const execution of [undefined,'Done',{...evidence,failed_count:0}]){const r=await invoke({execution});assert.equal(r.body.execution,null);assert.equal(r.body.reply,'Done');}
});
test('status returns validated runtime only and denies non-admin discovery',async()=>{
 const runtime={contract:'openjarvis-runtime/v1',agent_loaded:true,tool_inventory_known:true,tool_count:1,tool_names:['file_write'],truncated:false};
 const r=await invoke({action:'status',runtime:{...runtime,secret:'private'}});
 assert.equal(r.body.online,true);assert.deepEqual(r.body.runtime,runtime);
 for(const value of [undefined,{...runtime,tool_count:2}]){
  const r=await invoke({action:'status',runtime:value});assert.equal(r.body.runtime,null);assert.equal(r.body.online,true);
 }
 const denied=await invoke({action:'status',admin:false,runtime});assert.equal(denied.response.status,403);assert.equal(denied.calls.length,0);
});
