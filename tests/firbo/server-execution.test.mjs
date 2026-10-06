import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverExecution, serverTaskResult } from '../../supabase/functions/_shared/server-execution.ts';
const receipt = (tools = []) => ({contract:'openjarvis-execution/v1',mode:'agent',tool_count:tools.length,failed_count:tools.filter(t=>!t.success).length,tools,truncated:false});
const fail = {name:'file_write',success:false,output:'Permission denied',truncated:false};
test('failure is retained even if answer claims success; arbitrary metadata is discarded',()=>{
 const value=receipt([{...fail, secret:'not-exported'}]);
 assert.deepEqual(serverExecution(value).tools,[fail]);
 assert.match(serverTaskResult('Done',value),/1 failed/);
 assert.match(serverTaskResult('Done',value),/Permission denied/);
});
test('old servers and model-authored pseudo-evidence stay unverified',()=>{
 for(const value of [undefined,null,'I executed the tool',{}, {contract:'v0'}, {...receipt(),failed_count:1}]) assert.equal(serverExecution(value),null);
 assert.match(serverTaskResult('I ran every tool',null),/not verified/);
 assert.equal(serverExecution(receipt()).tool_count,0);
});
test('invalid booleans, counts, missing steps and hidden failures are rejected',()=>{
 for(const value of [{...receipt([fail]),failed_count:0},{...receipt([fail]),tools:[]},receipt([{...fail,success:'true'}]),{...receipt(),tool_count:Infinity},{...receipt(),truncated:'false'}]) assert.equal(serverExecution(value),null);
});
test('bounds preserve failure totals beyond visible steps and unknown fields never escape',()=>{
 const value={...receipt(Array.from({length:24},()=>({...fail,output:'α'.repeat(10000)}))),tool_count:30,failed_count:30, secret:'hidden'};
 const result=serverExecution(value);
 assert.equal(result.tools.reduce((n,t)=>n+t.output.length,0),24000);
 assert.equal(result.failed_count,30);assert.equal(result.truncated,true);
 assert.ok(serverTaskResult('x'.repeat(9000),value).length<=3500);
 assert.match(serverTaskResult('Done',value),/omitted or truncated/);
 assert.equal(JSON.stringify(result).includes('hidden'),false);
});
