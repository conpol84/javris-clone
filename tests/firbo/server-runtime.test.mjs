import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serverRuntime } from '../../supabase/functions/_shared/server-runtime.ts';
const runtime = {contract:'openjarvis-runtime/v1',agent_loaded:true,tool_inventory_known:true,tool_count:1,tool_names:['file_read'],truncated:false};
test('legacy or inconsistent inventory remains unknown',()=>{
 for(const value of [undefined, {}, {...runtime,tool_count:2}, {...runtime,agent_loaded:false}, {...runtime,tool_count:0}, {...runtime,truncated:true}, {...runtime,tool_names:['a','a'],tool_count:2}]) assert.equal(serverRuntime(value),null);
});
test('only validated inventory fields survive',()=>{
 assert.deepEqual(serverRuntime({...runtime,secret:'hidden'}),runtime);
 assert.notEqual(serverRuntime(runtime).tool_names,runtime.tool_names);
});
test('unknown count and verified zero stay distinct',()=>{
 const unknown={...runtime,tool_inventory_known:false,tool_count:null,tool_names:[]};
 assert.deepEqual(serverRuntime(unknown),unknown);
 assert.equal(serverRuntime({...unknown,tool_count:0}),null);
 assert.equal(serverRuntime({...runtime,tool_count:0,tool_names:[]}).tool_count,0);
});
test('bounded names must agree with truncation and total',()=>{
 const large={...runtime,tool_count:200,tool_names:Array.from({length:128},(_,i)=>`tool_${i}`),truncated:true};
 assert.deepEqual(serverRuntime(large),large);
 assert.equal(serverRuntime({...large,tool_names:[...large.tool_names,'extra']}),null);
});
