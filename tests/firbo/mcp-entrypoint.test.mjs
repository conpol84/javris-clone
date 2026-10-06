/** Actual MCP Edge handler with synthetic database and remote-server doubles.
 * No real MCP server, provider credential or external action is used here.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const USER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INTEGRATION='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const REQUEST_RECEIPT='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const RESULT_RECEIPT='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;
let state,handler;
globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'})[key]},serve:fn=>{handler=fn;}};
globalThis.__mcpClient=(...args)=>state.client(...args);
const temp=await mkdtemp(join(tmpdir(),'firbo-mcp-test-'));
const source=await readFile(new URL('../../supabase/functions/mcp/index.ts',import.meta.url),'utf8');
const code=source.replace("import { createClient } from 'npm:@supabase/supabase-js@2';",'const createClient = (...args: any[]) => (globalThis as any).__mcpClient(...args);');
const entry=join(temp,'mcp.ts');await writeFile(entry,code);await import(pathToFileURL(entry).href);
after(async()=>{globalThis.Deno=originalDeno;globalThis.fetch=originalFetch;delete globalThis.__mcpClient;await rm(temp,{recursive:true,force:true});});

function fixture(options={}){
  const current={options,fetches:[],reads:[],writes:[],rpcs:[],membershipReads:0,audits:[],toolCalls:[],
    integration:{id:INTEGRATION,organization_id:ORG,kind:'mcp',name:'Synthetic MCP',config:{host:'mcp.example.test',server_url:'https://mcp.example.test/mcp',tools:1},status:'active'}};
  const error=message=>({message});
  const execute=(table,op,payload,filters,selection)=>{
    const item={table,op,payload,filters,selection};
    if(op==='select'){
      current.reads.push(item);
      if(table==='organization_members'){
        current.membershipReads++;
        const role=options.revokedAfterDiscovery&&current.membershipReads>1?'viewer':options.role??'owner';
        return {data:options.noMembership?null:{role},error:null};
      }
      if(table==='integrations') return selection==='id'
        ?{data:null,count:options.integrationCount??0,error:options.integrationCountError?error('count unavailable'):null}
        :{data:current.integration,error:options.integrationReadError?error('integration unavailable'):null};
      if(table==='integration_secrets') return options.secretReadError
        ?{data:null,error:error('secret unavailable')}
        :{data:options.missingSecret?null:{secret:options.badSecret?'not-json':'{"token":"synthetic-token"}'},error:null};
      throw Error(`Unhandled select ${table}`);
    }
    current.writes.push(item);
    if(table==='audit_log'&&op==='insert'){
      const n=current.audits.length;current.audits.push(payload);
      if(options.auditUnavailable&&n===0||options.completionAuditUnavailable&&n===1)return{data:null,error:error('audit unavailable')};
      return{data:{id:n===0?REQUEST_RECEIPT:RESULT_RECEIPT,created_at:'2026-10-06T06:00:00Z'},error:null};
    }
    if(table==='integrations'&&op==='update')return{data:null,error:null};
    throw Error(`Unhandled write ${table}`);
  };
  current.client=(_url,key)=>({
    auth:{getUser:async()=>({data:{user:options.unsigned?null:{id:USER}},error:null})},
    rpc:async(fn,args)=>{
      current.rpcs.push({fn,args});
      if(fn==='plan_limit')return options.planLimitError?{data:null,error:error('plan unavailable')}:{data:2,error:null};
      if(fn==='firbo_save_legacy_integration')return options.atomicSaveError?{data:null,error:error(options.atomicSaveError)}:{data:{...current.integration,organization_id:undefined},error:null};
      throw Error(`Unhandled rpc ${fn}`);
    },
    from:table=>{
      let op='select',payload,selection;const filters=[];
      const query={
        select(value,_opts){selection=value;return query;},insert(value){op='insert';payload=value;return query;},update(value){op='update';payload=value;return query;},
        eq(key,value){filters.push([key,value]);return query;},maybeSingle(){return Promise.resolve(execute(table,op,payload,filters,selection));},
        single(){return query.maybeSingle();},then(resolve,reject){return Promise.resolve(execute(table,op,payload,filters,selection)).then(resolve,reject);},
      };return query;
    },
  });
  const json=(body,headers={})=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json',...headers}});
  globalThis.fetch=async(url,init)=>{
    const request=JSON.parse(init.body);current.fetches.push({url:String(url),request,headers:init.headers});
    if(request.method==='initialize')return json({jsonrpc:'2.0',id:request.id,result:{protocolVersion:'2025-03-26'}},{'mcp-session-id':options.badSession?'bad\nsession':'session-1'});
    if(request.method==='notifications/initialized')return new Response(null,{status:202});
    if(request.method==='tools/list'){
      if(options.oversizedList){const bytes=new Uint8Array(400_001);return new Response(bytes,{headers:{'content-type':'application/json'}});}
      return json({jsonrpc:'2.0',id:request.id,result:{tools:[
        {name:'weather.read',description:'Read synthetic weather',inputSchema:{type:'object',properties:{city:{type:'string'}}}},
        {name:'bad name',description:'must be removed',inputSchema:{}},{name:'weather.read',description:'duplicate',inputSchema:{}},
      ]}});
    }
    if(request.method==='tools/call'){
      current.toolCalls.push(request.params);
      if(options.unknownResult)return new Response('not json',{headers:{'content-type':'application/json'}});
      return json({jsonrpc:'2.0',id:request.id,result:{content:[{type:'text',text:'Synthetic 24 C'}],isError:false}});
    }
    throw Error(`Unexpected MCP method ${request.method}`);
  };
  state=current;return current;
}

async function invoke(options={},body={action:'call',id:INTEGRATION,tool:'weather.read',arguments:{city:'Larnaca'},confirm:true}){
  const current=fixture(options);
  const response=await handler(new Request('https://db.example.test/functions/v1/mcp',{method:'POST',headers:{authorization:'Bearer synthetic','content-type':'application/json'},body:JSON.stringify(body)}));
  return{current,response,body:await response.json()};
}

test('authentication and manager scope stop before an MCP server is contacted',async()=>{
  for(const options of [{unsigned:true},{role:'viewer'},{noMembership:true}]){
    const {current,response}=await invoke(options);assert.ok([401,403,404].includes(response.status));assert.equal(current.fetches.length,0);
  }
});

test('integration, credential and plan reads fail closed before an MCP server is contacted',async()=>{
  for(const options of [{integrationReadError:true},{secretReadError:true},{missingSecret:true},{badSecret:true}]){
    const {current,response}=await invoke(options);assert.equal(response.status,503);assert.equal(current.fetches.length,0);
  }
  for(const options of [{integrationCountError:true},{planLimitError:true}]){
    const {current,response,body}=await invoke(options,{action:'connect',organization_id:ORG,name:'Synthetic MCP',server_url:'https://mcp.example.test/mcp',token:''});
    assert.equal(response.status,503);assert.equal(body.error,'plan_unavailable');assert.equal(current.fetches.length,0);
  }
});

test('tool calls require explicit confirmation and an advertised exact tool name',async()=>{
  const missing=await invoke({}, {action:'call',id:INTEGRATION,tool:'weather.read',arguments:{city:'Larnaca'}});
  assert.equal(missing.response.status,400);assert.equal(missing.body.error,'confirm_required');assert.equal(missing.current.fetches.length,0);assert.equal(missing.current.toolCalls.length,0);assert.equal(missing.current.audits.length,0);
  const hidden=await invoke({}, {action:'call',id:INTEGRATION,tool:'hidden.write',arguments:{},confirm:true});
  assert.equal(hidden.response.status,409);assert.equal(hidden.body.error,'tool_not_available');assert.equal(hidden.current.toolCalls.length,0);assert.equal(hidden.current.audits.length,0);
});

test('role revocation or audit failure after discovery prevents the external action',async()=>{
  const revoked=await invoke({revokedAfterDiscovery:true});assert.equal(revoked.response.status,403);assert.equal(revoked.current.toolCalls.length,0);
  const noAudit=await invoke({auditUnavailable:true});assert.equal(noAudit.response.status,503);assert.equal(noAudit.body.error,'audit_unavailable');assert.equal(noAudit.current.toolCalls.length,0);
});

test('a successful call has request and result receipts with hashes and bounded result data',async()=>{
  const {current,response,body}=await invoke();assert.equal(response.status,200);assert.equal(body.text,'Synthetic 24 C');assert.equal(current.toolCalls.length,1);
  assert.equal(current.toolCalls[0].name,'weather.read');assert.deepEqual(current.toolCalls[0].arguments,{city:'Larnaca'});
  assert.deepEqual(current.audits.map(x=>x.action),['mcp.tool_requested','mcp.tool_completed']);
  assert.equal(current.audits[0].organization_id,ORG);assert.equal(current.audits[0].actor_id,USER);assert.equal(current.audits[0].metadata.tool,'weather.read');
  assert.match(body.receipt.arguments_sha256,/^[a-f0-9]{64}$/);assert.match(body.receipt.result_sha256,/^[a-f0-9]{64}$/);
  assert.equal(body.receipt.request_id,REQUEST_RECEIPT);assert.equal(body.receipt.result_id,RESULT_RECEIPT);
});

test('an ambiguous remote result is never reported as success or automatically retried',async()=>{
  const {current,response,body}=await invoke({unknownResult:true});assert.equal(response.status,502);assert.equal(body.error,'result_unknown');assert.equal(body.reconciliation_required,true);
  assert.equal(current.toolCalls.length,1);assert.deepEqual(current.audits.map(x=>x.action),['mcp.tool_requested','mcp.tool_result_unknown']);
});

test('an unrecorded completion is a reconciliation result, not false success',async()=>{
  const {current,response,body}=await invoke({completionAuditUnavailable:true});assert.equal(response.status,503);assert.equal(body.error,'result_unrecorded');assert.equal(body.reconciliation_required,true);
  assert.equal(current.toolCalls.length,1);assert.equal(current.audits.length,2);
});

test('response streams are bounded before parsing and invalid session IDs fail closed',async()=>{
  for(const options of [{oversizedList:true},{badSession:true}]){
    const {current,response}=await invoke(options,{action:'tools',id:INTEGRATION});assert.equal(response.status,502);assert.equal(current.toolCalls.length,0);
  }
});

test('MCP connection persistence uses the existing atomic integration+secret RPC',async()=>{
  const {current,response,body}=await invoke({}, {action:'connect',organization_id:ORG,name:'Synthetic MCP',server_url:'https://mcp.example.test/mcp',token:'synthetic-token'});
  assert.equal(response.status,200);assert.equal(body.integration.id,INTEGRATION);
  const saved=current.rpcs.find(x=>x.fn==='firbo_save_legacy_integration');assert.ok(saved);assert.equal(saved.args.p_kind,'mcp');assert.equal(saved.args.p_org,ORG);assert.equal(JSON.parse(saved.args.p_secret).token,'synthetic-token');
  assert.equal(current.writes.filter(x=>['integrations','integration_secrets'].includes(x.table)).length,0);
  const capped=await invoke({atomicSaveError:'plan_limit'}, {action:'connect',organization_id:ORG,name:'Synthetic MCP',server_url:'https://mcp.example.test/mcp',token:''});
  assert.equal(capped.response.status,429);assert.equal(capped.body.error,'plan_limit');
});
