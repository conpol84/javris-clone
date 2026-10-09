import { test } from 'node:test';
import assert from 'node:assert/strict';
import { devicePresence, formatComputerResult, RequestGeneration } from '../../frontend/src/lib/company/computer-state.ts';
import { computerManagerLabels } from '../../frontend/src/lib/company/computer-manager-labels.ts';
const now=Date.parse('2026-10-03T12:00:00Z');
const d={paired:true,revoked_at:null,last_seen_at:new Date(now-1000).toISOString()};
for(const [name,changes,clock,result] of [
 ['recent',{},now,'online'], ['boundary',{},now+59000,'offline'], ['stale',{},now+60000,'offline'],
 ['future',{last_seen_at:new Date(now+1).toISOString()},now,'offline'], ['missing',{last_seen_at:null},now,'offline'],
 ['invalid',{last_seen_at:'not-a-date'},now,'offline'], ['revoked',{revoked_at:'2026-10-03'},now,'revoked'],
 ['unpaired',{paired:false},now,'unpaired'], ['invalid-clock',{},NaN,'offline'],['epoch',{last_seen_at:'1970-01-01T00:00:00Z'},now,'offline'],
])test('device presence: '+name,()=>assert.equal(devicePresence({...d,...changes},clock),result));
test('old request cannot overwrite new data',()=>{const g=new RequestGeneration();const a=g.begin(),b=g.begin();assert.equal(g.isCurrent(a),false);assert.equal(g.isCurrent(b),true);});
test('cleanup invalidates last response',()=>{const g=new RequestGeneration();const a=g.begin();g.invalidate();assert.equal(g.isCurrent(a),false);});
test('re-entered scope cannot revive old response',()=>{const g=new RequestGeneration();const a=g.begin();g.invalidate();g.begin();assert.equal(g.isCurrent(a),false);});
test('malformed listing does not crash page',()=>{assert.doesNotThrow(()=>formatComputerResult({kind:'list',result:{entries:'unexpected'}}));assert.equal(formatComputerResult({kind:'list',result:null}),'');});
test('null list entries rejected without losing actual file',()=>assert.equal(formatComputerResult({kind:'list',result:{entries:[null,{name:'hello.txt',type:'file',size:1}]}}),'📄 hello.txt  (1 B)'));
test('output is text, not executable html',()=>assert.equal(formatComputerResult({kind:'read',result:{content:'<script>unsafe()</script>'}}),'<script>unsafe()</script>'));
test('eight-language Computer Manager labels complete',()=>{assert.equal(Object.keys(computerManagerLabels).length,8);const keys=Object.keys(computerManagerLabels.en).sort();for(const l of Object.values(computerManagerLabels)){assert.deepEqual(Object.keys(l).sort(),keys);assert.ok(Object.values(l).every(v=>typeof v==='string'&&v.trim()));}});
