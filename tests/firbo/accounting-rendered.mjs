// Real BillingPage and accounting effects. Localhost only, synthetic RPCs.
import assert from 'node:assert/strict';
import { chromium } from '../../tools/firbo-browser-runtime/node_modules/playwright/index.mjs';
import { mkdir } from 'node:fs/promises';
const origin = 'http://127.0.0.1:5218';
const evidence = '/tmp/firbo-accounting-evidence';
const orgA = '11111111-0815-4815-8815-111111111111';
const orgB = '22222222-0815-4815-8815-222222222222';
const pendingId = '33333333-0815-4815-8815-333333333333';
const receipt = (organization_id, amount = .123456) => ({
  contract: 'firbo-accounting-snapshot/v1', organization_id, observed_at: '2026-10-06T20:00:00Z',
  month_start: '2026-10-01T00:00:00Z', read_only: true, open_count: 21, reserved_count: 20,
  reconcile_required_count: 1, potential_liability_usd: amount, stale_open_count: 2, stale_minutes: 60,
  settled_month_count: 3, platform_settled_month_usd: .01, unknown_settled_cost_count: 1,
  byok_settled_month_count: 1, zero_cost_settled_month_count: 1, overrun_month_count: 1, detail_limit: 20,
  details: [{ request_id: pendingId, source: 'agent-runner', status: 'reconcile_required', reserved_usd: amount, age_seconds: 86400 }],
});
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const width of [320, 390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => { errors.push(e.message); console.error('SYNTHETIC HARNESS ERROR', e.message); });
    page.on('console', message => { if (message.type() === 'error') console.error('SYNTHETIC HARNESS CONSOLE', message.text()); });
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/accounting-test.html') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/accounting-harness.js"></script></body></html>` });
      if (url.pathname === '/accounting-harness.js') return route.fulfill({ contentType: 'application/javascript', body: `
        import React, {useState} from '/node_modules/.vite/deps/react.js';
        import {createRoot} from '/node_modules/.vite/deps/react-dom_client.js';
        import {MemoryRouter} from '/node_modules/.vite/deps/react-router.js';
        import {I18nProvider} from '/src/i18n/I18nProvider.tsx';
        import {BillingPage} from '/src/pages/BillingPage.tsx';
        import '/src/index.css';
        window.harness={queue:[],organization:'${orgA}',role:'owner'};
        function App(){const [n,setN]=useState(0); window.harness.render=()=>setN(v=>v+1); return React.createElement(I18nProvider,{key:(window.harness.lang??'en')+':'+(window.harness.localeRevision??0)},React.createElement(MemoryRouter,{},React.createElement(BillingPage)));}
        createRoot(document.getElementById('root')).render(React.createElement(App));
      ` });
      if (url.pathname === '/src/lib/company/AuthProvider.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export function useCompanyAuth(){return {current:{organization:{id:window.harness.organization,name:'Synthetic company'},role:window.harness.role}}}` });
      if (url.pathname === '/src/lib/company/client.ts') return route.fulfill({ contentType: 'application/javascript', body: `
        export const COMPANY_ENABLED=true;
        export const companyClient={
          from:()=>({select:()=>({order:()=>Promise.resolve({data:[],error:null})})}),
          rpc:(name,params)=>name==='firbo_accounting_snapshot'?{abortSignal(signal){return new Promise(resolve=>window.harness.queue.push({params,signal,resolve}))}}:Promise.resolve({data:name==='is_platform_admin'?false:null,error:null})
        };
        export function requireClient(){return companyClient;}
      ` });
      return route.continue();
    });
    await page.goto(`${origin}/accounting-test.html?lang=en`);
    const panel = page.locator('section[aria-labelledby="inference-accounting-title"]');
    await panel.waitFor().catch(async error => {
      console.error('SYNTHETIC HARNESS STATE', await page.locator('body').textContent());
      await page.screenshot({ path: `${evidence}/accounting-${width}-load-failure.png` });
      throw error;
    });
    await page.waitForFunction(() => window.harness?.queue.length === 1);
    await page.evaluate(data => window.harness.queue[0].resolve({ data, error: null }), receipt(orgA));
    await panel.getByText(pendingId, { exact: true }).waitFor();
    assert.match(await panel.textContent(), /0\.123456/);
    assert.match(await panel.textContent(), /Oldest 1 of 21/);
    assert.match(await panel.getByRole('alert').textContent(), /Costs missing: 1.*overruns: 1/);
    assert.match(await panel.textContent(), /Age does not release/);
    await page.screenshot({ path: `${evidence}/accounting-${width}.png` });
    const boxes = await panel.getByRole('button').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { left: r.left, right: r.right }; }));
    assert.ok(boxes.every(b => b.left >= 0 && b.right <= width), 'accounting controls in viewport');
    assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'no accounting overflow');
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await panel.getByRole('status').waitFor();
    assert.equal(await panel.getByText(pendingId, { exact: true }).count(), 0, 'refresh hides old evidence');
    await page.waitForFunction(() => window.harness.queue.length === 2);
    await page.evaluate(org => {window.harness.organization=org;window.harness.render();}, orgB);
    await page.waitForFunction(() => window.harness.queue.length === 3);
    assert.equal(await page.evaluate(() => window.harness.queue[1].signal.aborted), true);
    // A late previous-company reply cannot overwrite current data.
    await page.evaluate(data => window.harness.queue[1].resolve({ data, error: null }), receipt(orgA, 999));
    await page.evaluate(data => window.harness.queue[2].resolve({ data, error: null }), receipt(orgB, .25));
    await panel.getByText(pendingId, { exact: true }).waitFor();
    assert.ok(!(await panel.textContent()).includes('999'));
    await panel.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => window.harness.queue.length === 4);
    await page.evaluate(() => window.harness.queue[3].resolve({ data: null, error: { code: '42501', message: 'private secret' } }));
    await panel.getByRole('alert').filter({ hasText: 'Only current company' }).waitFor();
    assert.equal(await panel.getByText(pendingId, { exact: true }).count(), 0);
    assert.ok(!(await panel.textContent()).includes('private secret'));
    await page.evaluate(() => {window.harness.role='viewer';window.harness.render();});
    await panel.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => window.harness.queue.length), 4, 'viewer does not call RPC');
    await page.evaluate(() => {window.harness.role='owner';window.harness.render();});
    await page.waitForFunction(() => window.harness.queue.length === 5);
    await panel.getByRole('status').waitFor();
    await page.evaluate(data => window.harness.queue[4].resolve({ data, error: null }), receipt(orgA));
    await panel.getByRole('alert').filter({ hasText: 'Could not load accounting' }).waitFor();
    assert.equal(await panel.getByText(pendingId, { exact: true }).count(), 0, 'mismatched receipt fails closed');
    // All eight real dictionaries and RTL at mobile width, with no network/provider calls.
    await page.evaluate(() => history.replaceState(null, '', '/accounting-test.html'));
    for (const lang of ['en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar']) {
      const count = await page.evaluate(() => window.harness.queue.length);
      await page.evaluate(lang => {localStorage.setItem('firbo-lang',lang);window.harness.lang=lang;window.harness.localeRevision=(window.harness.localeRevision??0)+1;window.harness.render();}, lang);
      await page.waitForFunction(n => window.harness.queue.length > n, count);
      await page.evaluate(data => window.harness.queue.at(-1).resolve({ data, error: null }), receipt(orgB));
      await panel.locator('code').waitFor();
      assert.equal(await page.locator('html').getAttribute('lang'), lang);
      const text = await panel.textContent();
      assert.ok(!text.includes('acct.'), `translated ${lang}`);
      assert.ok(await panel.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `no overflow ${lang}/${width}`);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS Billing/accounting ${width}px: pending precision, unknown costs, refresh, tenant race, abort, denial, role revocation, bounded controls, eight dictionaries`);
    await context.close();
  }
} finally { await browser.close(); }
