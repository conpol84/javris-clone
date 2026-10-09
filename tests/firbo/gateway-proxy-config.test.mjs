import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const config = JSON.parse(readFileSync(new URL('../../frontend/vercel.json', import.meta.url), 'utf8'));
test('only three explicit API rewrite families; no user-selectable upstream', () => {
  const rules = config.rewrites.filter(r => r.destination.startsWith('https:'));
  assert.deepEqual(rules, [
    {source:'/firbo-backend-health',destination:'https://api.firboai.app/health'},
    {source:'/v1/gateway/:path*',destination:'https://api.firboai.app/v1/gateway/:path*'},
    {source:'/v1/firbo/:path*',destination:'https://api.firboai.app/v1/firbo/:path*'},
  ]);
  assert.ok(rules.every(r => !('has' in r) && !r.destination.includes('?')));
});
test('SPA fallback follows API rewrites and excludes API paths', () => {
  const last=config.rewrites.at(-1);
  assert.equal(last.destination,'/index.html');
  assert.ok(last.source.includes('?!v1/|assets/'));
  assert.equal(config.rewrites.length,4);
});
test('gateway responses disable both browser and CDN caches', () => {
  for (const source of ['/v1/(.*)', '/firbo-backend-health']) {
    const rule=config.headers.find(r => r.source===source);
    for (const key of ['Cache-Control','CDN-Cache-Control','Vercel-CDN-Cache-Control']) {
      assert.ok(rule.headers.find(h=>h.key===key).value.includes('no-store'));
    }
  }
  assert.ok(!JSON.stringify(config).includes('x-vercel-enable-rewrite-caching'));
});
test('no iframe protection removal or permissive CORS headers', () => {
  assert.ok(config.headers.find(r=>r.source==='/(.*)').headers.some(h=>h.key==='X-Frame-Options'&&h.value==='DENY'));
  assert.ok(!JSON.stringify(config).toLowerCase().includes('access-control-allow-origin'));
});
