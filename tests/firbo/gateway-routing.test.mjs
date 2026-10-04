import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayForAgent, gatewayForOrgPlan, completeViaGateway, boundedGatewayJson, GatewayError } from '../../supabase/functions/_shared/gateway-routing.ts';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const defaults = { FIRBO_TEXT_ROUTING_MODE: 'gateway', OMNIROUTE_BASE_URL: 'https://gateway.firboai.app/v1', OMNIROUTE_API_KEY: 'inference-test-secret', OMNIROUTE_PRICE_IN_PER_M: '1', OMNIROUTE_PRICE_OUT_PER_M: '2' };
const env = (values = {}) => key => ({ ...defaults, ...values })[key];
const plan = (values = {}, model = 'auto') => gatewayForAgent({ id, model }, env(values));
const messages = [{ role: 'user', content: 'Private prompt must not appear in trace' }];
const answer = (changes = {}) => ({ model: 'provider/test-model', choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 100, completion_tokens: 20 }, ...changes });
const call = (options = {}) => completeViaGateway(plan(), messages, 0.4, { fetcher: async () => Response.json(answer()), ...options });

test('unset mode preserves legacy without reading gateway credentials', () => assert.equal(gatewayForAgent({id,model:'auto'}, () => undefined), null));
test('legacy mode remains legacy even with a previously selected OmniRoute model', () => assert.equal(plan({FIRBO_TEXT_ROUTING_MODE:'legacy'},'omniroute:firbo-economy'), null));
test('canary selects only configured agent IDs', () => {
  assert.equal(gatewayForAgent({id:other,model:'auto'},env({FIRBO_TEXT_ROUTING_MODE:'canary',FIRBO_GATEWAY_CANARY_AGENTS:id})), null);
  assert.equal(plan({FIRBO_TEXT_ROUTING_MODE:'canary',FIRBO_GATEWAY_CANARY_AGENTS:id}).mode,'canary');
});
test('empty canary list changes nobody', () => assert.equal(plan({FIRBO_TEXT_ROUTING_MODE:'canary'}),null));
for (const [name, values] of Object.entries({ typo:{FIRBO_TEXT_ROUTING_MODE:'gatway'}, badCanary:{FIRBO_TEXT_ROUTING_MODE:'canary',FIRBO_GATEWAY_CANARY_AGENTS:'all'}, noKey:{OMNIROUTE_API_KEY:undefined}, managementKey:{OMNIROUTE_MANAGEMENT_KEY:'inference-test-secret'}, missingRates:{OMNIROUTE_PRICE_IN_PER_M:undefined}, badRates:{OMNIROUTE_PRICE_OUT_PER_M:'NaN'}, negativeRate:{OMNIROUTE_PRICE_OUT_PER_M:'-1'}, infiniteRate:{OMNIROUTE_PRICE_OUT_PER_M:'Infinity'} })) {
  test(`configuration fails closed: ${name}`, () => assert.throws(() => plan(values), GatewayError));
}
for (const url of ['http://gateway.firboai.app/v1','https://evil.test/v1','https://user:pass@gateway.firboai.app/v1','https://gateway.firboai.app/v1?key=secret','https://gateway.firboai.app/v1#secret','https://gateway.firboai.app/v2']) {
  test(`reject credential-bearing or mismatched endpoint: ${url}`, () => assert.throws(() => plan({OMNIROUTE_BASE_URL:url})));
}
test('root and versioned endpoint normalize to exactly one v1', () => { for (const suffix of ['', '/', '/v1', '/v1/']) assert.equal(plan({OMNIROUTE_BASE_URL:'https://gateway.firboai.app'+suffix}).base,'https://gateway.firboai.app/v1'); });
test('gateway uses the exact requested allowlisted combo', () => assert.equal(plan({},'omniroute:firbo-quality').model,'firbo-quality'));
test('explicit direct provider is not silently remapped', () => assert.throws(() => plan({},'openai:some-model'),/gateway_model_not_allowed/));
test('unknown model is rejected', () => assert.throws(() => plan({},'omniroute:unknown'),/gateway_model_not_allowed/));
test('JSON and enumerable properties do not disclose plan credentials', () => { assert.ok(!JSON.stringify(plan()).includes('inference-test-secret')); assert.ok(!Object.keys(plan()).includes('key')); });
test('one correlated request, reported model separate from routing profile, estimate not invoice', async () => {
  let count=0;
  const result = await call({ fetcher: async (url, options) => {
    count++; assert.equal(url,'https://gateway.firboai.app/v1/chat/completions');
    assert.equal(options.redirect,'error'); assert.equal(options.headers.authorization,'Bearer inference-test-secret');
    assert.match(options.headers['x-request-id'],/^[0-9a-f-]{36}$/);
    assert.equal(JSON.parse(options.body).model,'firbo-economy');
    return Response.json(answer());
  }});
  assert.equal(count,1); assert.equal(result.cost,0.00014);
  assert.equal(result.trace.requested_model,'firbo-economy'); assert.equal(result.trace.reported_model,'provider/test-model');
  assert.equal(result.trace.gateway_fallback,'unverified'); assert.equal(result.trace.cost_basis,'configured_estimate');
  assert.equal(result.trace.status,'succeeded'); assert.equal(result.trace.application_attempts,1);
  assert.ok(!JSON.stringify(result.trace).includes('Private prompt'));
});
for (const status of [301,401,403,429,500,502,503]) {
  test(`HTTP ${status} never triggers direct fallback or another POST`, async () => {
    let count=0;
    await assert.rejects(call({fetcher: async()=>{ count++;return new Response('secret provider error', {status}); }}),error=>error.code===`gateway_http_${status}`&&!error.message.includes('secret'));
    assert.equal(count,1);
  });
}
test('raw network exception is sanitized', async () => await assert.rejects(call({fetcher:async()=>{ throw Error('leaked-token=SECRET'); }}), error => error.code==='gateway_transport_error'&&!JSON.stringify(error).includes('SECRET')));
for (const changes of [{usage:undefined},{usage:{prompt_tokens:1,completion_tokens:-1}},{usage:{prompt_tokens:'100',completion_tokens:20}},{usage:{prompt_tokens:1.5,completion_tokens:20}}]) {
  test('missing or malformed usage does not become verified zeros '+JSON.stringify(changes), async () => await assert.rejects(call({fetcher:async()=>Response.json(answer(changes))}),/gateway_usage_missing/));
}
test('empty completion is a failure', async()=>await assert.rejects(call({fetcher:async()=>Response.json(answer({choices:[{message:{content:''}}]}))}),/gateway_empty_response/));
test('HTML responses are rejected', async()=>await assert.rejects(call({fetcher:async()=>new Response('<html>ok</html>',{headers:{'content-type':'text/html'}})}),/gateway_invalid_content_type/));
test('bad JSON is rejected', async()=>await assert.rejects(call({fetcher:async()=>new Response('oops',{headers:{'content-type':'application/json'}})}),/gateway_invalid_json/));
test('bounded reading stops and cancels oversized response', async()=>{
  let reads=0,cancelled=false;
  const stream = new ReadableStream({pull(controller){reads++;controller.enqueue(new Uint8Array(400_000));},cancel(){cancelled=true;}});
  await assert.rejects(boundedGatewayJson(new Response(stream),new AbortController().signal,1_000_000),/gateway_response_too_large/);
  assert.ok(reads<=4);assert.equal(cancelled,true);
});
test('deadline cancels a stalled response body, not only connection setup', async()=>{
  let cancelled=false,signal;
  await assert.rejects(call({timeoutMs:20,fetcher:async(_url,options)=>{signal=options.signal;return new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}});}}),/gateway_timeout_or_cancelled/);
  assert.equal(signal.aborted,true);assert.equal(cancelled,true);
});
test('aborted caller sends no request', async()=>{
  const controller=new AbortController();controller.abort();let count=0;
  await assert.rejects(call({signal:controller.signal,fetcher:async()=>{count++;return Response.json(answer());}}),/gateway_timeout_or_cancelled/);
  assert.equal(count,0);
});
test('oversized prompt and invalid parameters fail before network', async()=>{
  let count=0;const fetcher=async()=>{count++;return Response.json(answer());};
  await assert.rejects(completeViaGateway(plan(),[{role:'user',content:'x'.repeat(260_000)}],0.4,{fetcher}),/gateway_request_too_large/);
  await assert.rejects(completeViaGateway(plan(),messages,NaN,{fetcher}),/invalid_gateway_parameters/);
  assert.equal(count,0);
});

// Plan rule: Free-plan companies use the admin-managed free combo; it is opt-in and everything else is untouched.
const freeOn = { FIRBO_FREE_PLAN_ROUTING: 'gateway' };
const forPlan = (orgPlan, values = {}, model = 'auto') => gatewayForOrgPlan({ id, model }, orgPlan, env(values));
test('plan rule is off by default: a free company keeps its normal routing', () => {
  assert.equal(forPlan('free', { FIRBO_TEXT_ROUTING_MODE: 'legacy' }), null);
  assert.equal(forPlan('free').model, 'firbo-economy');
});
test('free plan with the rule on uses the free combo even when routing is legacy', () => {
  const p = forPlan('free', { ...freeOn, FIRBO_TEXT_ROUTING_MODE: 'legacy' });
  assert.equal(p.model, 'firbo-free');
  assert.equal(p.mode, 'gateway');
});
test('free plan cannot pick a different model through the agent setting', () => {
  assert.equal(forPlan('free', freeOn, 'omniroute:firbo-quality').model, 'firbo-free');
  assert.equal(forPlan('free', freeOn, 'openai:some-model').model, 'firbo-free');
});
test('the free combo name is configurable by the admin only', () => assert.equal(forPlan('free', { ...freeOn, FIRBO_FREE_PLAN_MODEL: 'my-free-combo' }).model, 'my-free-combo'));
test('paid plans are never moved to the free combo', () => {
  assert.equal(forPlan('pro', freeOn, 'omniroute:firbo-quality').model, 'firbo-quality');
  assert.equal(forPlan('business', { ...freeOn, FIRBO_TEXT_ROUTING_MODE: 'legacy' }), null);
});
for (const bad of ['http://evil/x', 'a b', '']) {
  test(`free combo name is validated: ${JSON.stringify(bad)}`, () => {
    if (bad === '') assert.equal(forPlan('free', { ...freeOn, FIRBO_FREE_PLAN_MODEL: bad }).model, 'firbo-free');
    else assert.throws(() => forPlan('free', { ...freeOn, FIRBO_FREE_PLAN_MODEL: bad }), GatewayError);
  });
}
test('free plan still fails closed without gateway credentials', () => assert.throws(() => forPlan('free', { ...freeOn, OMNIROUTE_API_KEY: undefined }), GatewayError));
test('free-plan combo is always $0, even when paid estimates are set or missing', () => {
  const p = forPlan('free', { FIRBO_FREE_PLAN_ROUTING: 'gateway', OMNIROUTE_PRICE_IN_PER_M: '5', OMNIROUTE_PRICE_OUT_PER_M: '20' });
  assert.equal(p.priceIn, 0); assert.equal(p.priceOut, 0); assert.equal(p.model, 'firbo-free');
  const q = forPlan('free', { FIRBO_FREE_PLAN_ROUTING: 'gateway', OMNIROUTE_PRICE_IN_PER_M: undefined, OMNIROUTE_PRICE_OUT_PER_M: undefined });
  assert.equal(q.priceIn, 0);
  // Paid plans keep the configured estimates, so their budgets and analytics stay real.
  const paid = forPlan('pro', { FIRBO_FREE_PLAN_ROUTING: 'gateway', OMNIROUTE_PRICE_IN_PER_M: '5', OMNIROUTE_PRICE_OUT_PER_M: '20' }, 'omniroute:firbo-economy');
  assert.equal(paid.priceIn, 5); assert.equal(paid.priceOut, 20);
});
