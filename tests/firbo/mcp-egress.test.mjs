import {after,test} from 'node:test';
import assert from 'node:assert/strict';
import {mcpEgressFetch} from '../../supabase/functions/_shared/mcp-egress.ts';
const originalDeno=globalThis.Deno, originalFetch=globalThis.fetch;
after(()=>{globalThis.Deno=originalDeno;globalThis.fetch=originalFetch;});
const env={FIRBO_MCP_EGRESS_URL:'https://egress.example.test/v1/mcp',FIRBO_MCP_EGRESS_TOKEN:'synthetic-service-token-at-least-32'};
const init={method:'POST',body:'{"jsonrpc":"2.0","method":"tools/list"}',headers:{authorization:'Bearer synthetic-provider-token','mcp-session-id':'synthetic-session','content-type':'application/json',accept:'application/json'}};
test('missing or invalid egress configuration cannot dispatch a direct target request',async()=>{
  for(const changed of [{FIRBO_MCP_EGRESS_URL:''},{FIRBO_MCP_EGRESS_TOKEN:''},{FIRBO_MCP_EGRESS_URL:'http://egress.example.test/v1/mcp'},{FIRBO_MCP_EGRESS_URL:'https://user:password@egress.example.test/v1/mcp'},{FIRBO_MCP_EGRESS_URL:'https://egress.example.test/other'},{FIRBO_MCP_EGRESS_URL:'https://egress.example.test/v1/mcp?x=1'},{FIRBO_MCP_EGRESS_TOKEN:'x'.repeat(32)+'\n'}]){
    let calls=0;globalThis.Deno={env:{get:key=>({...env,...changed})[key]}};globalThis.fetch=async()=>{calls++;throw Error('unexpected dispatch');};
    await assert.rejects(mcpEgressFetch('https://mcp.example.test/mcp',init),/egress_unavailable/);assert.equal(calls,0);
  }
});
test('only the service endpoint receives the envelope and its own credential',async()=>{
  globalThis.Deno={env:{get:key=>env[key]}};let calls=0;
  const signal=AbortSignal.timeout(1000);
  globalThis.fetch=async(url,options)=>{
    calls++;assert.equal(url,env.FIRBO_MCP_EGRESS_URL);assert.equal(options.redirect,'error');assert.equal(options.signal,signal);
    assert.equal(options.headers.authorization,'Bearer '+env.FIRBO_MCP_EGRESS_TOKEN);
    const envelope=JSON.parse(options.body);assert.deepEqual(envelope,{url:'https://mcp.example.test/mcp',body:init.body,headers:{authorization:'Bearer synthetic-provider-token','mcp-session-id':'synthetic-session'}});
    assert.ok(!envelope.body.includes(env.FIRBO_MCP_EGRESS_TOKEN));
    return new Response('{"error":"egress_denied"}',{status:502});
  };
  const response=await mcpEgressFetch('https://mcp.example.test/mcp',{...init,signal});assert.equal(response.status,502);assert.equal(calls,1);
});
test('invalid method or oversized body is rejected before network dispatch',async()=>{
  globalThis.Deno={env:{get:key=>env[key]}};let calls=0;globalThis.fetch=async()=>{calls++;throw Error('unexpected dispatch');};
  for(const options of [{...init,method:'GET'},{...init,body:'x'.repeat(30001)}])await assert.rejects(mcpEgressFetch('https://mcp.example.test/mcp',options),/egress_request_denied/);
  assert.equal(calls,0);
});
