// Render the actual MissionsPage with synthetic data in a fixed-height phone
// shell: no FIRBO production auth, external internet, provider cost or writes.
import assert from 'node:assert/strict';
import {chromium} from '../../tools/firbo-browser-runtime/node_modules/playwright/index.mjs';
import {mkdir,writeFile,rm} from 'node:fs/promises';
const origin='http://127.0.0.1:5227';
const evidence='/tmp/firbo-jarvis-responsive-evidence';
const scripts={"/src/lib/company/AuthProvider.tsx":"export function useCompanyAuth(){return {current:{organization:{id:'company-a',name:'Demo company'},role:'owner'},user:{id:'owner-a'}};}","/src/lib/company/data.ts":"export const listAgents=async()=>[\n {id:'ceo-a',name:'AI CEO',slug:'ceo',type:'ceo',enabled:true,persona:null},\n {id:'research-a',name:'Research Agent',slug:'research',type:'research',enabled:true,persona:null}\n];","/src/lib/company/missions.ts":"const base={id:'demo-mission',title:'Global research and competitive analysis — multi-market strategy for the new product',\n description:'Research the market and report the evidence',status:'completed',\n created_at:'2026-10-11T00:00:00Z',assigned_agent_id:'ceo-a',\n result:{summary:'Completed analysis from verified sources',report:'Public research reviewed, final evidence logged.'}};\nexport async function listMissions(){return [base,...Array.from({length:9},(_,i)=>({...base,id:'old-'+i,title:'Historical mission '+i+' with a long description'}))];}\nexport async function getMission(){return base;}\nexport async function listSteps(){return [\n {id:'step-a',title:'Research worldwide regulatory markets and build a clear comparison across regions',description:'Review evidence.',status:'completed',assigned_agent_id:'research-a',result:{report:'Found two primary groups.'}},\n {id:'step-b',title:'Compile next actions for the operating team',description:'Apply approved plan.',status:'completed',assigned_agent_id:'ceo-a',result:{report:'Prepared next steps.'}}];}\nexport function isMeeting(m){return m?.metadata?.meeting===true;}\nexport function missionStepWaiting(){return false;}\nexport async function runMission(){throw Error('No real work in synthetic acceptance');}\nexport async function createMeeting(){throw Error('No writes in synthetic acceptance');}\nexport async function createMission(){throw Error('No writes in synthetic acceptance');}"};
const frontend=new URL('../../frontend/',import.meta.url);
const files=[];
await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const generated=[
   ['jarvis-missions-test.html',"<!doctype html><html><head><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><style>html,body,#root{height:100%;width:100%;min-height:0;margin:0;overflow:hidden}</style></head><body><div id=\"root\"></div><script type=\"module\" src=\"/jarvis-missions-harness.jsx\"></script></body></html>"],
   ['jarvis-missions-harness.jsx',"import React from 'react';\nimport {createRoot} from 'react-dom/client';\nimport {MemoryRouter} from 'react-router';\nimport {I18nProvider} from '/src/i18n/I18nProvider.tsx';\nimport {MissionsPage} from '/src/pages/MissionsPage.tsx';\nimport '/src/index.css';\ncreateRoot(document.getElementById('root')).render(\n  <I18nProvider><MemoryRouter initialEntries={['/missions?m=demo-mission']}>\n    <main data-firbo-route=\"/missions\" style={{height:'100%',width:'100%',display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden'}}>\n      <MissionsPage/>\n    </main>\n  </MemoryRouter></I18nProvider>\n);"],
 ];
 for(const [filename,source] of generated){
  const p=new URL(filename,frontend);
  await writeFile(p,source,{flag:'wx'});files.push(p);
 }
 for(const [width,lang] of [[320,'el'],[390,'ar'],[768,'en'],[1280,'en']]){
  const context=await browser.newContext({viewport:{width,height:800},serviceWorkers:'block'});
  const page=await context.newPage();
  page.setDefaultTimeout(20000);
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(url.origin!==origin)return route.abort();
   const mock=scripts[url.pathname];
   return mock?route.fulfill({contentType:'application/javascript',body:mock}):route.continue();
  });
  await page.goto(origin+'/jarvis-missions-test.html?lang='+lang);
  const root=page.locator('[data-jarvis-missions="true"]');
  await root.locator('[data-mission-history] li').first().waitFor();
  await root.locator('[data-mission-stage]').waitFor();
  await root.locator('[data-mission-step-title]').first().waitFor();
  const dimensions=await root.evaluate(el=>{
   const aside=el.querySelector('aside').getBoundingClientRect();
   const detail=el.querySelector('[data-mission-detail]').getBoundingClientRect();
   const stage=el.querySelector('[data-mission-stage]').getBoundingClientRect();
   const history=el.querySelector('[data-mission-history]');
   const input=el.querySelector('form input').getBoundingClientRect();
   return {client:el.clientWidth,scroll:el.scrollWidth,scrollHeight:el.scrollHeight,height:el.clientHeight,
    docWidth:document.documentElement.scrollWidth,width:innerWidth,
    asideLeft:aside.left,asideRight:aside.right,asideBottom:aside.bottom,
    detailRight:detail.right,stageRight:stage.right,inputBottom:input.bottom,
    historyHeight:history.clientHeight,historyScroll:history.scrollHeight};
  });
  assert.ok(dimensions.client>0 && dimensions.scroll<=dimensions.client+2,JSON.stringify(dimensions));
  assert.ok(dimensions.docWidth<=width+2,JSON.stringify(dimensions));
  assert.ok(dimensions.asideLeft>=-2 && dimensions.asideRight<=width+2,JSON.stringify(dimensions));
  assert.ok(dimensions.detailRight<=width+2&&dimensions.stageRight<=width+2,JSON.stringify(dimensions));
  if(width<=390){
   assert.ok(dimensions.scrollHeight>dimensions.height+100,'phone must scroll within fixed shell');
   assert.ok(dimensions.inputBottom<=dimensions.asideBottom+2,'form may not be cropped by sidebar');
   assert.ok(dimensions.historyHeight<=190,'history is bounded separately');
  }
  await root.locator('[data-mission-step-title]').first().scrollIntoViewIfNeeded();
  assert.equal(await root.locator('[data-mission-step-title]').first().isVisible(),true);
  await page.screenshot({path:evidence+'/missions-'+lang+'-'+width+'.png'});
  assert.deepEqual(errors,[],'no React/runtime errors');
  console.log('PASS Missions '+lang+' '+width+'px, goal/history/3D scene/results reachability');
  await context.close();
 }
}finally{
 await browser.close();
 for(const f of files)await rm(f,{force:true});
}
