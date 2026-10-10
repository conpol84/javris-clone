// Read-only real public OpenJarvis VPS login rendered acceptance.
// Never submit the form, store a cookie, use credentials or run a native tool.
import assert from 'node:assert/strict';
import {chromium} from '../../tools/firbo-browser-runtime/node_modules/playwright/index.mjs';
import {mkdir} from 'node:fs/promises';

const url='https://jarvis.firboai.app/_firbo/login';
await mkdir('/tmp/firbo-vps-login-evidence',{recursive:true});
const browser=await chromium.launch({headless:true});
try{
 for(const width of [390,1280]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',permissions:[]});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try{
   const res=await page.goto(url,{waitUntil:'domcontentloaded',timeout:20000});
   assert.equal(res?.status(),200,'The actual public server login must render');
   const username=page.getByLabel('Username',{exact:true});
   const password=page.getByLabel('Password',{exact:true});
   const signIn=page.getByRole('button',{name:'Sign in',exact:true});
   await username.waitFor({state:'visible'});
   await password.waitFor({state:'visible'});
   assert.equal(await password.getAttribute('type'),'password');
   assert.equal(await signIn.isVisible(),true);
   const form=page.locator('form');
   assert.equal(await form.getAttribute('method'),'post');
   assert.equal(await form.getAttribute('action'),'/_firbo/login');
   const geometry=await page.evaluate(()=>({
    overflow:document.documentElement.scrollWidth-innerWidth,
    form:document.querySelector('form')?.getBoundingClientRect()?.toJSON(),
   }));
   assert.ok(geometry.overflow<=2,'Login should not be horizontally clipped');
   assert.ok(geometry.form&&geometry.form.left>=-1&&geometry.form.right<=width+1,
    'Login must fit screen');
   assert.deepEqual(errors,[],'Public login must not throw client exceptions');
   await page.screenshot({path:'/tmp/firbo-vps-login-evidence/public-login-'+width+'.png',
    fullPage:true,animations:'disabled'});
   console.log('PASS '+width+'px real VPS login rendered: HTTP200, labeled controls, POST form, no overflow');
  }finally{await context.close()}
 }
}finally{await browser.close()}
