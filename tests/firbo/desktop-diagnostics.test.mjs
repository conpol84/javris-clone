import test from 'node:test';
import assert from 'node:assert/strict';
import { connectorCall } from '../../frontend/public/firbo-connector.mjs';

// Network and device are synthetic. No pairing tokens, real screenshots or OS actions.
const invoke = (action, body, response) =>
  connectorCall(action, body, { fetchImpl:async()=>response, timeoutMs:2500 });
test('known desktop error code crosses bounded Connector HTTP failure',async()=>{
 const response=new Response(JSON.stringify({error:'desktop_model_rate_limited',secret:'never print'}),{
  status:503,headers:{'content-type':'application/json'}
 });
 await assert.rejects(invoke('desktop_plan',{job_id:'fake'},response),error=>{
  assert.equal(error.message,'desktop_model_rate_limited');
  assert.equal(error.status,503);
  assert.doesNotMatch(error.message,/secret|never print/);
  return true;
 });
});
test('untrusted desktop provider prose never escapes as a diagnostic',async()=>{
 const response=new Response(JSON.stringify({error:'desktop_<script>steal</script>'}),{
  status:503,headers:{'content-type':'application/json'}
 });
 await assert.rejects(invoke('desktop_plan',{job_id:'fake'},response),error=>{
  assert.equal(error.message,'connector_http_503');
  return true;
 });
});
test('bounded error response rejects oversized provider text',async()=>{
 const response=new Response(JSON.stringify({error:'desktop_model_failed',padding:'s'.repeat(6000)}),{
  status:503,headers:{'content-type':'application/json'}
 });
 await assert.rejects(invoke('desktop_plan',{job_id:'fake'},response),error=>{
  assert.equal(error.message,'connector_http_503');
  return true;
 });
});
test('ordinary non-desktop HTTP errors remain unchanged and unexposed',async()=>{
 const response=new Response(JSON.stringify({error:'desktop_model_rate_limited'}),{
  status:503,headers:{'content-type':'application/json'}
 });
 await assert.rejects(invoke('poll',{token:'fake'},response),error=>{
  assert.equal(error.message,'connector_http_503');
  return true;
 });
});
