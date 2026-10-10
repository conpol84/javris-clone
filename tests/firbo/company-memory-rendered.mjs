// Rendered owner review acceptance, local synthetic data only. No user tokens or
// production memory imported, and never a real public/company publication.
import assert from 'node:assert/strict';
import {chromium} from '../../tools/firbo-browser-runtime/node_modules/playwright/index.mjs';
import {mkdir,writeFile,rm} from 'node:fs/promises';

const root=new URL('../../frontend/',import.meta.url),origin='http://127.0.0.1:5227';
const evidence='/tmp/firbo-company-memory-evidence';
const testFiles=[
 {name:'company-memory-harness.html',data:'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/company-memory-harness.jsx"></script></body></html>'},
 {name:'company-memory-harness.jsx',data:[
  "import React from 'react';",
  "import {createRoot} from 'react-dom/client';",
  "import {I18nProvider,useI18n} from '/src/i18n/I18nProvider.tsx';",
  "import {CompanyMemoryReview} from '/src/components/company/CompanyMemoryReview.tsx';",
  "import '/src/index.css';",
  "function App(){const {t}=useI18n(); window.harness.labels={title:t('mem.review.title'), edit:t('mem.review.edit'),publish:t('mem.review.publish'),revoke:t('mem.review.revoke')};return <CompanyMemoryReview orgId='synthetic-company-a'/>;}",
  "createRoot(document.getElementById('root')).render(<I18nProvider><App/></I18nProvider>);",
 ].join('\n')},
];
const mockModule=[
 "window.harness={calls:[],denied:false,proposals:[{id:'proposal-one',content:'Unverified model suggestion about the refund procedure',memory_type:'fact',created_at:'2026-10-09'}],publications:[],labels:{}};",
 "const call=async (slug,{body})=>{",
 " if(slug!=='company-memory-review')throw Error('wrong API function');",
 " window.harness.calls.push({...body});",
 " if(body.organization_id!=='synthetic-company-a')throw Error('tenant mismatch');",
 " if(body.action==='list_proposals')return{data:{proposals:window.harness.proposals},error:null};",
 " if(body.action==='list_published')return{data:{publications:window.harness.publications},error:null};",
 " if(window.harness.denied)return{data:null,error:{message:'forbidden'}};",
 " if(body.action==='publish'||body.action==='publish_manual'){",
 "  if(body.confirm_reviewed!==true)throw Error('missing review');",
 "  const id='synthetic-approved-'+(window.harness.publications.length+1);",
 "  window.harness.publications.push({id,content:body.content,memory_type:body.memory_type,importance:body.importance,source_memory_id:body.source_memory_id||null,approved_at:'2026-10-10'});",
 "  return{data:{published_id:id},error:null};}",
 " if(body.action==='revoke'){const before=window.harness.publications.length;window.harness.publications=window.harness.publications.filter(x=>x.id!==body.publication_id);",
 "  if(window.harness.publications.length===before)return{data:null,error:{message:'not found'}};",
 "  return{data:{revoked_id:body.publication_id},error:null};}",
 " throw Error('unexpected action '+body.action);",
 "};",
 "export const requireClient=()=>({functions:{invoke:call}});",
].join('\n');

await mkdir(evidence,{recursive:true});
const files=[];
const browser=await chromium.launch({headless:true});
try{
 for(const t of testFiles){
  const path=new URL(t.name,root);
  await writeFile(path,t.data,{flag:'wx'});files.push(path);
 }
 for(const [lang,width] of [['el',320],['ar',390],['en',1280]]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block'});
  const page=await context.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   if(url.pathname==='/src/lib/company/client.ts')
    return route.fulfill({contentType:'application/javascript',body:mockModule});
   return route.continue();
  });
  try{
   await page.goto(origin+'/company-memory-harness.html?lang='+lang);
   const root=page.locator('[data-company-memory-review]');
   await root.waitFor({timeout:25000});
   const labels=await page.evaluate(()=>window.harness.labels);
   await page.getByText(labels.title,{exact:true}).waitFor();
   const reviewButtons=root.locator('button[aria-pressed]');
   assert.equal(await reviewButtons.count(),1);
   await reviewButtons.first().click();
   const text=page.getByRole('textbox',{name:labels.edit});
   await text.fill('Owner verified company refund procedure with current policy.');
   const button=page.getByRole('button',{name:labels.publish});
   assert.equal(await button.isEnabled(),false,'Publish must require explicit review');
   await root.locator('input[type=checkbox]').check();
   assert.equal(await button.isEnabled(),true);
   await button.click();
   await page.waitForFunction(()=>window.harness.publications.length===1);
   const check=await page.evaluate(()=>window.harness.calls.filter(x=>x.action==='publish'));
   assert.equal(check.length,1);
   assert.equal(check[0].organization_id,'synthetic-company-a');
   assert.equal(check[0].source_memory_id,'proposal-one');
   assert.equal(check[0].confirm_reviewed,true);
   await page.waitForFunction(()=>document.querySelectorAll('[data-company-memory-review] button[aria-pressed]').length===0,undefined,{timeout:10000});
   page.once('dialog',dialog=>void dialog.accept());
   await root.getByRole('button',{name:labels.revoke}).click();
   await page.waitForFunction(()=>window.harness.publications.length===0);
   const audit=await page.evaluate(()=>window.harness.calls.filter(x=>x.action==='revoke'));
   assert.equal(audit.length,1);
   // Backend errors are shown as errors, never published successes.
   await page.evaluate(()=>window.harness.denied=true);
   await text.fill('Another manually authored, verified company knowledge note.');
   await root.locator('input[type=checkbox]').check();
   await button.click();
   await page.waitForFunction(()=>window.harness.calls.filter(x=>x.action==='publish_manual').length===1);
   assert.equal(await page.evaluate(()=>window.harness.publications.length),0);
   const box=await root.boundingBox();
   assert.ok(box&&box.x>=-2&&box.x+box.width<=width+2,'review panel clipped');
   assert.deepEqual(errors,[],'client-side exception');
   await page.screenshot({path:evidence+'/company-review-'+lang+'-'+width+'.png',fullPage:true,animations:'disabled'});
   console.log('PASS '+lang+' '+width+'px: owner review, explicit approval, revoke and denial');
  }finally{await context.close();}
 }
}finally{
 await browser.close();
 for(const path of files)await rm(path,{force:true});
}
