// Optional Firbo browser executor. No shell, remote debugging listener, personal
// browser profile, arbitrary evaluation, cookies export or implicit file access.
import { resolve4 } from 'node:dns/promises';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

export const BROWSER_ACTIONS = ['open', 'read', 'snapshot', 'screenshot', 'click', 'fill', 'scroll', 'upload', 'download'];
const MUTATIONS = new Set(['click', 'fill', 'upload']);
const CAPTURES = new Set(['snapshot', 'screenshot']);
const MAX_BYTES = 4 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137,80,78,71,13,10,26,10]);
const check = signal => { if (signal?.aborted) throw new Error('operation_stopped'); };
const hash = data => createHash('sha256').update(data).digest('hex');
const byteClip = (value, limit) => Buffer.from(String(value)).subarray(0, Math.max(0, limit)).toString('utf8');
const fail = () => { throw new Error('invalid_browser_plan'); };
const bounded = (v, n) => typeof v === 'string' && v.length > 0 && v.length <= n && !/[\u0000-\u001f\u007f]/.test(v);

export function browserOrigin(value) {
  if (!bounded(value, 2048)) fail();
  let u; try { u = new URL(value); } catch { fail(); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !u.hostname.includes('.')
    || !/^[a-z0-9.-]+$/.test(u.hostname) || /^\d+(\.\d+){3}$/.test(u.hostname)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(u.hostname)) fail();
  return u.origin;
}

/** Closed schema. A page or queued job cannot widen the locally selected sites. */
export function validateBrowserPlan(raw, localSites, ownerFullControl=false) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some(k => !['steps', 'timeout_ms'].includes(k))) fail();
  if (!ownerFullControl && (!Array.isArray(localSites) || !localSites.length || localSites.length > 12)) throw new Error('browser_control_disabled');
  if (ownerFullControl && Array.isArray(localSites) && localSites.length > 12) fail();
  const sites = new Set((Array.isArray(localSites)?localSites:[]).map(s => { if (s !== browserOrigin(s)) fail(); return s; }));
  const timeout = raw.timeout_ms ?? 120_000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 300_000 || !Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 20) fail();
  const steps = raw.steps.map(s => {
    if (!s || typeof s !== 'object' || Array.isArray(s) || !BROWSER_ACTIONS.includes(s.action)) fail();
    const keys = {open:['url'], read:[], snapshot:[], screenshot:['path'], click:['selector'], fill:['selector','text'], scroll:['pixels'], upload:['selector','path'], download:['url','path']}[s.action];
    if (Object.keys(s).some(k => k !== 'action' && !keys.includes(k)) || keys.some(k => !Object.hasOwn(s, k))) fail();
    if (keys.includes('url')) { const origin=browserOrigin(s.url); if (!ownerFullControl && !sites.has(origin)) throw new Error('browser_site_denied'); sites.add(origin); }
    // Only CSS locators; no arbitrary Playwright selector engine or frame traversal.
    if (keys.includes('selector') && (!bounded(s.selector, 200) || />>|(?:^|\s)(?:text|xpath|id|data-testid)=/i.test(s.selector))) fail();
    if (keys.includes('path') && !bounded(s.path, 500)) fail();
    if (s.action === 'screenshot' && !/\.png$/i.test(s.path)) fail();
    if (s.action === 'fill' && (typeof s.text !== 'string' || s.text.length > 4000 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(s.text))) fail();
    if (s.action === 'scroll' && (!Number.isInteger(s.pixels) || Math.abs(s.pixels) > 4000)) fail();
    return Object.freeze({ ...s });
  });
  if (steps[0].action !== 'open') fail();
  return Object.freeze({ steps: Object.freeze(steps), timeout_ms: timeout, sites: Object.freeze([...sites]), max_cost: 0 });
}

export function isPublicIPv4(ip) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const [a,b,c,d] = ip.split('.').map(Number);
  if ([a,b,c,d].some(n=>n>255)) return false;
  return !(a===0 || a===10 || a===127 || a>=224 || (a===169&&b===254) || (a===172&&b>=16&&b<=31)
    || (a===192&&b===168) || (a===100&&b>=64&&b<=127) || (a===198&&(b===18||b===19))
    || (a===192&&b===0) || (a===192&&b===88&&c===99) || (a===198&&b===51&&c===100) || (a===203&&b===0&&c===113));
}

/** Resolve and pin a public IPv4 address in the actual TLS socket, preventing DNS
 * rebinding. Never follow redirects here; Chromium sends each hop through routing.
 * No ambient proxy, client certificates or local authentication are inherited.
 */
export async function publicRequest(input, { signal, lookup = resolve4, request = https.request } = {}) {
  const origin = browserOrigin(input.url);
  if (!input.sites.includes(origin)) throw new Error('browser_site_denied');
  check(signal);
  const u = new URL(input.url), addresses = await lookup(u.hostname);
  check(signal);
  if (!addresses.length || addresses.some(ip => !isPublicIPv4(ip))) throw new Error('browser_network_denied');
  const headers = { ...input.headers };
  for (const k of Object.keys(headers)) if (/^(host|connection|proxy-.*|transfer-encoding|content-length)$/i.test(k)) delete headers[k];
  if (input.body && input.body.length > MAX_BYTES) throw new Error('browser_transfer_too_large');
  return await new Promise((resolve, reject) => {
    const req = request(u, {method:input.method, headers, signal, agent:false, family:4, autoSelectFamily:false,
      lookup:(_host, options, done)=>options.all?done(null,[{address:addresses[0],family:4}]):done(null, addresses[0], 4), timeout:15_000}, res => {
      const chunks=[]; let size=0;
      res.on('data', chunk => { size+=chunk.length; if (size>MAX_BYTES) req.destroy(new Error('browser_transfer_too_large')); else chunks.push(chunk); });
      res.on('error', reject);
      res.on('aborted', ()=>reject(new Error('browser_network_denied')));
      res.on('end', ()=>resolve({status:res.statusCode, headers:res.headers, body:Buffer.concat(chunks)}));
    });
    req.on('timeout', ()=>req.destroy(new Error('browser_network_timeout')));
    req.on('error', reject);
    req.end(input.body || undefined);
  });
}

async function installedChromium() {
  // A fixed local installation, never a package/path supplied in the remote job.
  const require = createRequire(path.join(os.homedir(), '.firbo-browser-runtime', 'package.json'));
  let pkg; try { pkg = require('playwright/package.json'); } catch { throw new Error('browser_runtime_missing'); }
  if (pkg.version !== '1.63.0') throw new Error('browser_runtime_version');
  return require('playwright').chromium;
}

export async function verifyBrowserRuntime() {
  const engine = await installedChromium();
  const { access } = await import('node:fs/promises');
  try { await access(engine.executablePath()); } catch { throw new Error('browser_runtime_missing'); }
}

/** Each call has a fresh visible session and a bounded, locally reviewed plan.
 * Browser-only grants cannot read/write files. File helpers enforce separate roots.
 * All page-derived output is explicitly untrusted. It never changes this plan.
 */
export async function executeBrowserPlan(raw, cfg, {
  signal, confirm = async()=>false, readFile, writeFile, onProgress=()=>{},
  chromium, transport = publicRequest,
} = {}) {
  // A page can issue parallel requests. Only one local approval prompt may own
  // stdin at a time, and abort/expiry is rechecked after waiting for that prompt.
  const reviewer=confirm;let reviewQueue=Promise.resolve();
  confirm=(kind,details,reviewSignal)=>{
    const next=reviewQueue.then(async()=>{check(reviewSignal);const accepted=await reviewer(kind,details,reviewSignal);check(reviewSignal);return accepted;});
    reviewQueue=next.catch(()=>{});return next;
  };
  if (cfg.allowBrowser !== true || cfg.allowBrowserControl !== true) throw new Error('browser_control_disabled');
  const ownerFullControl=cfg?.fullControl===true;
  const plan = validateBrowserPlan(raw, cfg.browserSites, ownerFullControl);
  if (plan.steps.some(s=>s.action==='upload') && (!cfg.roots?.length || !readFile)) throw new Error('browser_file_denied');
  if (plan.steps.some(s=>s.action==='download'||s.action==='screenshot') && (!cfg.allowWrite || !cfg.roots?.length || !writeFile)) throw new Error('browser_file_denied');
  check(signal);
  if (!await confirm('browser_plan', {steps:plan.steps, sites:plan.sites, owner_full_control:ownerFullControl, timeout_ms:plan.timeout_ms, max_cost:0,
    disclosure:'Page text and accessibility snapshots return to your Firbo company. A screenshot can contain sensitive visible content and is saved only to the locally selected allowed path. Capture steps ask again. Credentials are never filled or exported.'}, signal)) throw new Error('declined_on_this_computer');
  check(signal);
  const stop = new AbortController(), abort = ()=>stop.abort();
  signal?.addEventListener('abort', abort, {once:true});
  const timer=setTimeout(abort, plan.timeout_ms);
  let browser, context, page, activeAction='', networkFailure='', transferred=0, requests=0, finished=false, textBudget=20_000;
  const close = ()=>{ void browser?.close().catch(()=>{}); };
  stop.signal.addEventListener('abort', close, {once:true});
  const ensure = () => { check(stop.signal); if (networkFailure) throw new Error(networkFailure); };
  const results=[];
  try {
    const engine=chromium ?? await installedChromium();
    ensure();
    browser=await engine.launch({headless:false, args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp']});
    ensure();
    context=await browser.newContext({acceptDownloads:false, serviceWorkers:'block', permissions:[], viewport:null});
    context.setDefaultTimeout(10_000);
    // WebSockets do not pass through the ordinary HTTP route.
    await context.routeWebSocket('**/*', socket=>socket.close());
    await context.route('**/*', async route=>{
      try {
        ensure();
        const req=route.request();
        if (++requests>200) throw new Error('browser_request_limit');
        if (!plan.sites.includes(browserOrigin(req.url()))) throw new Error('browser_site_denied');
        if (!['GET','HEAD'].includes(req.method())) {
          // Actual writes are locally reviewed, even if a page tries to disguise
          // publishing/payment as a routine click. --auto never approves these.
          if (!MUTATIONS.has(activeAction) || !await confirm('browser_request', {
            url:req.url(),method:req.method(),body_sha256:hash(req.postDataBuffer()??Buffer.alloc(0)),
            body_preview:(req.postData()??'').slice(0,2000),
          },stop.signal)) throw new Error('browser_write_denied');
        }
        ensure();
        const out=await transport({url:req.url(),method:req.method(),headers:await req.allHeaders(),body:req.postDataBuffer(),sites:plan.sites},{signal:stop.signal});
        transferred+=out.body.length;
        if (transferred>20*MAX_BYTES) throw new Error('browser_transfer_too_large');
        const headers={};
        for (const [k,v] of Object.entries(out.headers)) if (!['connection','transfer-encoding','content-length','set-cookie'].includes(k.toLowerCase()) && v!==undefined) headers[k]=Array.isArray(v)?v.join(','):String(v);
        // Cookies can contain multiple Set-Cookie lines; never merge them as CSV.
        if (out.headers['set-cookie']) headers['set-cookie']=[out.headers['set-cookie']].flat().join('\n');
        await route.fulfill({status:out.status,headers,body:out.body});
      } catch (e) {
        networkFailure=/^browser_[a-z_]+$/.test(e?.message??'')?e.message:'browser_network_denied';
        await route.abort().catch(()=>{});
      }
    });
    context.on('page', p=>{ if (page && p!==page) void p.close(); });
    page=await context.newPage();
    page.on('dialog', d=>void d.dismiss());
    page.on('download', d=>void d.cancel());
    page.on('close', ()=>{if(!finished)abort();});
    for (const [index,s] of plan.steps.entries()) {
      ensure();
      if (s.action!=='open' && !ownerFullControl && !plan.sites.includes(browserOrigin(page.url()))) throw new Error('browser_site_denied');
      activeAction=s.action;
      if (MUTATIONS.has(s.action) && !await confirm('browser_action', {url:page.url(),step:s},stop.signal)) throw new Error('declined_on_this_computer');
      if (CAPTURES.has(s.action) && !await confirm('browser_capture', {
        url:page.url(),step:s,scope:s.action==='screenshot'?'visible_viewport':'accessibility_tree',
        retention:s.action==='screenshot'?'local_file_only':'company_job_receipt',max_bytes:s.action==='screenshot'?MAX_BYTES:20_000,
      },stop.signal)) throw new Error('declined_on_this_computer');
      ensure();
      onProgress({step:index+1,total:plan.steps.length,action:s.action,status:'running'});
      let result={};
      if (s.action==='open') { await page.goto(s.url,{waitUntil:'domcontentloaded'}); result={url:byteClip(page.url(),2048)}; }
      if (s.action==='read') {
        const raw=await page.locator('body').innerText(),text=byteClip(raw,Math.min(4000,textBudget));
        textBudget=Math.max(0,textBudget-Buffer.byteLength(text));
        result={untrusted_page_data:true,url:byteClip(page.url(),2048),title:byteClip(await page.title(),500),text,truncated:text!==raw};
      }
      if (s.action==='snapshot') {
        const raw=await page.locator('body').ariaSnapshot({depth:12}),accessibility=byteClip(raw,Math.min(6000,textBudget));
        textBudget=Math.max(0,textBudget-Buffer.byteLength(accessibility));
        result={untrusted_page_data:true,url:byteClip(page.url(),2048),title:byteClip(await page.title(),500),accessibility,truncated:accessibility!==raw};
      }
      if (s.action==='screenshot') {
        const bytes=await page.screenshot({type:'png',fullPage:false});
        if(!Buffer.isBuffer(bytes)||bytes.length>MAX_BYTES)throw new Error('browser_transfer_too_large');
        if(bytes.length<PNG_SIGNATURE.length||!bytes.subarray(0,PNG_SIGNATURE.length).equals(PNG_SIGNATURE))throw new Error('browser_capture_failed');
        ensure();
        result={...await writeFile(s.path,bytes),local_only:true,capture:'visible_viewport_png'};
      }
      if (s.action==='scroll') await page.mouse.wheel(0,s.pixels);
      if (['click','fill','upload'].includes(s.action)) {
        const target=page.locator('css='+s.selector);
        if(await target.count()!==1) throw new Error('browser_ambiguous_target');
        if (s.action==='click') await target.click({noWaitAfter:false});
        if (s.action==='fill') {
          const kind=(await target.getAttribute('type')??'').toLowerCase();
          const autocomplete=(await target.getAttribute('autocomplete')??'').toLowerCase();
          if (['password','file','hidden'].includes(kind)||/password|cc-|one-time-code/.test(autocomplete)) throw new Error('browser_sensitive_field');
          await target.fill(s.text);
        }
        if (s.action==='upload') {
          const file=await readFile(s.path,MAX_BYTES);
          if(!Buffer.isBuffer(file.bytes)||file.bytes.length>MAX_BYTES)throw new Error('browser_transfer_too_large');
          ensure();
          await target.setInputFiles({name:path.basename(s.path),mimeType:'application/octet-stream',buffer:file.bytes});
          result={bytes:file.bytes.length,sha256:hash(file.bytes)};
        }
      }
      if (s.action==='download') {
        if(!await confirm('browser_download',{url:s.url,path:s.path},stop.signal))throw new Error('declined_on_this_computer');
        ensure();
        const out=await transport({url:s.url,method:'GET',headers:{},sites:plan.sites},{signal:stop.signal});
        if(out.status!==200||out.body.length>MAX_BYTES)throw new Error('browser_download_failed');
        ensure();
        result=await writeFile(s.path,out.body); // exclusive creation + read-back hash
      }
      ensure();
      results.push({step:index+1,action:s.action,...result});
      onProgress({step:index+1,total:plan.steps.length,action:s.action,status:'done'});
      activeAction='';
    }
    finished=true;
    const hasText=plan.steps.some(s=>s.action==='read'),hasAccessibility=plan.steps.some(s=>s.action==='snapshot'),hasScreenshot=plan.steps.some(s=>s.action==='screenshot');
    const capture=hasScreenshot?`${hasText?'text-':''}${hasAccessibility?'accessibility-':''}local-screenshot`:hasAccessibility?(hasText?'text-accessibility':'accessibility'):'text-only';
    return {completed:true,steps:results,cost:0,profile:'isolated-temporary',capture,transferred_bytes:transferred};
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',abort);stop.signal.removeEventListener('abort',close);
    await browser?.close().catch(()=>{});
  }
}
