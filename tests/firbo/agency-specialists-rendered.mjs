// Actual StorePage -> HireDialog -> hireAgent, localhost-only synthetic database.
import assert from 'node:assert/strict';
import { chromium } from '../../tools/firbo-browser-runtime/node_modules/playwright/index.mjs';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const origin = 'http://127.0.0.1:5227';
const evidence = '/tmp/firbo-agency-evidence';
const files = [];
const manifest = JSON.parse(await readFile(new URL('../../third_party/agency-agents/manifest.json', import.meta.url), 'utf8'));
for (const entry of manifest.files) {
  const raw = await readFile(new URL(`../../third_party/agency-agents/${entry.path}`, import.meta.url));
  assert.equal(createHash('sha256').update(raw).digest('hex'), entry.sha256);
  assert.equal(createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex'), entry.git_blob);
}
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, content] of [
    ['agency-test.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/agency-harness.jsx"></script></body></html>'],
    ['agency-harness.jsx', `
      import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {MemoryRouter} from 'react-router';
      import {I18nProvider,useI18n} from '/src/i18n/I18nProvider.tsx';
      import {StorePage} from '/src/pages/StorePage.tsx';
      import '/src/index.css';
      window.harness={calls:[],updates:[],fail:false};
      function App(){const {t}=useI18n();window.harness.labels={research:t('tpl.deep-research.name'),qa:t('tpl.qa-engineer.name'),hire:t('hire.btn'),confirm:t('hire.confirmBtn'),instructions:t('hire.instrLabel')};return <StorePage/>;}
      createRoot(document.getElementById('root')).render(<I18nProvider><MemoryRouter><App/></MemoryRouter></I18nProvider>);
    `],
  ]) {
    const path = new URL(`../../frontend/${name}`, import.meta.url);
    await writeFile(path, content, { flag: 'wx' }); files.push(path);
  }
  for (const [width, lang] of [[320, 'el'], [390, 'ar'], [1280, 'en']]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/src/lib/company/AuthProvider.tsx') return route.fulfill({ contentType: 'application/javascript', body: `export function useCompanyAuth(){return {current:{organization:{id:'company-a',name:'Test company'},role:'owner'}}}` });
      if (url.pathname === '/src/lib/company/client.ts') return route.fulfill({ contentType: 'application/javascript', body: `
        export const COMPANY_ENABLED=true;
        export const companyClient={
          from:(table)=>{const query={select:()=>query,eq:()=>query,order:async()=>({data:[],error:null}),update:payload=>{window.harness.updates.push({table,payload});return query},then:resolve=>resolve({data:[],error:null})};return query},
          rpc:async(name,args)=>{
            if(name==='get_plan_usage')return {data:{plan:{id:'business',name:'Business',limits:{agents:50}},usage:{agents:0}},error:null};
            if(name==='hire_agent'){window.harness.calls.push({name,args});return window.harness.fail?{data:null,error:{message:'plan_limit:premium_agent'}}:{data:'new-agent',error:null}};
            throw new Error('Unexpected RPC '+name);
          }
        };
        export function requireClient(){return companyClient;}
      ` });
      return route.continue();
    });
    await page.goto(`${origin}/agency-test.html?lang=${lang}`);
    await page.getByText('Business', { exact: true }).waitFor();
    await page.locator('li details').first().waitFor({ state: 'attached' });
    assert.equal(await page.locator('li details').count(), 5);
    assert.equal(await page.locator('html').getAttribute('lang'), lang);
    const labels = await page.evaluate(() => window.harness.labels);
    const search = page.locator('input').first();
    await search.fill(labels.research);
    const card = page.locator('li').filter({ has: page.locator('details') });
    assert.equal(await card.count(), 1);
    await card.locator('summary').focus();
    await page.keyboard.press('Enter');
    await card.locator('details[open] a').waitFor();
    assert.match(await card.locator('details a').getAttribute('href'), new RegExp(`/blob/${manifest.commit}/research/research-synthesist.md$`));
    await card.getByRole('button', { name: labels.hire, exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    assert.equal(await dialog.locator('details[open]').count(), 1);
    await dialog.getByLabel(labels.instructions, { exact: true }).fill('Use Greek and source links.');
    await page.screenshot({ path: `${evidence}/hire-${lang}-${width}.png`, fullPage: true });
    const dimensions = await dialog.evaluate(node => ({ width: innerWidth, left: node.getBoundingClientRect().left, right: node.getBoundingClientRect().right, scroll: node.scrollWidth, client: node.clientWidth }));
    assert.ok(dimensions.left >= -1 && dimensions.right <= width + 1 && dimensions.scroll <= dimensions.client + 1, JSON.stringify(dimensions));
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    const calls = await page.evaluate(() => window.harness.calls);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].args.p_org, 'company-a');
    assert.equal(calls[0].args.p_slug, 'deep-research');
    assert.ok(calls[0].args.p_prompt.includes('Trace repeated claims'));
    assert.ok(calls[0].args.p_prompt.includes('Use Greek and source links.'));
    assert.ok(calls[0].args.p_prompt.includes(manifest.commit));
    assert.ok(calls[0].args.p_tools.every(tool => !['computer_use', 'shell_exec'].includes(tool.tool)));
    // A server-denied hire keeps the form; it cannot be relabelled as successful.
    await page.evaluate(() => { window.harness.fail = true; });
    await card.getByRole('button', { name: labels.hire, exact: true }).click();
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).click();
    await page.waitForFunction(() => window.harness.calls.length === 2);
    await dialog.getByRole('button', { name: labels.confirm, exact: true }).waitFor();
    assert.equal(await dialog.isVisible(), true);
    assert.equal(await page.evaluate(() => window.harness.updates.length), 1); // budget only for first successful hire
    assert.deepEqual(errors, []);
    console.log(`PASS ${lang} ${width}px: catalog, keyboard disclosure, localized hire, exact company prompt/policies, denial, reflow`);
    await context.close();
  }
} finally {
  await browser.close();
  for (const file of files) await rm(file, { force: true });
}
