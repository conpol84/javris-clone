// Runs with Node 22.22's built-in TypeScript type stripping. No tokens, network,
// fixtures from a production DB, or actual provider requests are used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpeechHandler } from '../../../supabase/functions/agent-speak/handler.ts';

function fixture({ usageCount = 0, member = true, providerStatus = 429 } = {}) {
  let requests = 0;
  const creator = (_url, key) => key === 'fixture-anon'
    ? { auth: { getUser: async () => ({ data: { user: { id: 'owner-fixture', email: 'owner@example.test' } }, error: null }) } }
    : { from(table) {
      if (table === 'organization_members') return {
        select: () => ({ eq() { return this; }, maybeSingle: async () => ({ data: member ? { role: 'owner' } : null, error: null }) }),
      };
      if (table === 'usage_events') return {
        select: () => ({ eq() { return this; }, gte: async () => ({ count: usageCount, error: null }) }),
        insert: async () => ({ error: null }),
      };
      throw Error('Unexpected fixture table: ' + table);
    } };
  const vars = {
    SUPABASE_URL:'https://example.supabase.co',
    SUPABASE_ANON_KEY:'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY:'fixture-service',
    OPENAI_API_KEY:'fixture-provider-only',
    ORG_DAILY_RUN_LIMIT:'100',
  };
  const handler = createSpeechHandler({
    createClient:creator,
    env:key=>vars[key],
    http: async () => { requests++;return new Response('{}', { status:providerStatus }); },
  });
  const request = () => new Request('https://example.test/functions/v1/agent-speak', {
    method:'POST',
    headers:{ authorization:'Bearer fake-fixture', 'content-type':'application/json' },
    body:JSON.stringify({organization_id:'fixture-org',text:'Please speak this safe demo',voice_profile:'firbo-dark-v1',audio_format:'wav'}),
  });
  return {handler,request,get calls(){return requests;}};
}
test('upstream voice-provider 429 yields recoverable 503 for free browser speech', async () => {
  const x = fixture({providerStatus:429});
  const response = await x.handler(x.request());
  assert.equal(response.status,503);
  assert.deepEqual(await response.json(),{error:'voice_provider_rate_limited'});
  assert.equal(x.calls,1);
});
test('organization usage cap stays 429 and does not call provider', async () => {
  const x = fixture({usageCount:300,providerStatus:429});
  const response = await x.handler(x.request());
  assert.equal(response.status,429);
  assert.deepEqual(await response.json(),{error:'rate_limited'});
  assert.equal(x.calls,0);
});
test('missing organization membership denies without provider or local-fallback signal', async () => {
  const x = fixture({member:false});
  const response = await x.handler(x.request());
  assert.equal(response.status,403);
  assert.equal(x.calls,0);
});
test('missing identity is denied before any provider call', async () => {
  const x = fixture();
  const r = x.request();
  const noAuth = new Request(r.url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({organization_id:'fixture-org',text:'hello'})});
  const response = await x.handler(noAuth);
  assert.equal(response.status,401);
  assert.equal(x.calls,0);
});
