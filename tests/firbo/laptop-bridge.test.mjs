import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseVoiceLaptop,dispatchLaptopBrowserCommand,parseLaptopBrowserCommand,setVoiceLaptop} from '../../frontend/src/lib/company/laptop-bridge.ts';

const now=Date.parse('2026-10-04T10:00:00Z');
const device=(id,name='Laptop')=>({id,name,platform:'Windows',paired:true,last_seen_at:new Date(now-1000).toISOString(),capabilities:{job_kinds:['browser_open']},revoked_at:null,created_at:''});
const memory=()=>{const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)}};

test('Greek website voice browser request is parsed without an LLM',()=>{
  assert.equal(parseLaptopBrowserCommand('Άνοιξε το browser στο example.com').url,'https://example.com/');
});
test('ordinary conversation remains an AI chat turn',()=>{
  assert.equal(parseLaptopBrowserCommand('Πες μου τι έγινε σήμερα'),null);
});
test('open-browser command without target uses a public start page',()=>{
  assert.equal(parseLaptopBrowserCommand('άνοιξε το browser εδώ').url,'https://www.google.com/');
});
test('one browser-ready online laptop auto-selects but several require a stored selection',()=>{
  assert.equal(chooseVoiceLaptop([device('d1')],null,now)?.id,'d1');
  assert.equal(chooseVoiceLaptop([device('d1'),device('d2')],null,now),null);
});
test('stored Voice laptop receives browser_open and success waits for device receipt',async()=>{
  const store=memory();setVoiceLaptop('org','d2',store);let queued;
  const out=await dispatchLaptopBrowserCommand('org','open browser to example.com','en',undefined,{
    storage:store,now:()=>now,loadDevices:async()=>[device('d1'),device('d2','Work laptop')],
    queue:async(deviceId,kind,params)=>(queued={deviceId,kind,params},{job_id:'j1'}),
    loadJobs:async()=>[{id:'j1',device_id:'d2',kind:'browser_open',params:{url:'https://example.com/'},status:'done',result:{launched:true},error:null,created_at:'',finished_at:''}],
    sleep:async()=>{},
  });
  assert.deepEqual(queued,{deviceId:'d2',kind:'browser_open',params:{url:'https://example.com/'}});
  assert.equal(out.status,'done');assert.match(out.reply,/Work laptop/);
});
test('no receipt never becomes a false opened-success',async()=>{
  const out=await dispatchLaptopBrowserCommand('org','άνοιξε το browser','el',undefined,{
    storage:memory(),now:()=>now,loadDevices:async()=>[device('d1')],
    queue:async()=>({job_id:'j1'}),loadJobs:async()=>[],sleep:async()=>{},
  });
  assert.notEqual(out.status,'done');assert.doesNotMatch(out.reply,/Άνοιξα/);
});
