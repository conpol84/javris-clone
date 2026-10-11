import {describe,it,expect} from 'vitest';
import {jarvisPreferenceKey,readJarvisAutopilot,writeJarvisAutopilot,canAutostartJarvisDelegation} from './jarvis-autopilot';
const org='33333333-3333-4333-8333-333333333333';
const alice='11111111-1111-4111-8111-111111111111';
const bob='22222222-2222-4222-8222-222222222222';
const agent='44444444-4444-4444-8444-444444444444';
const message='55555555-5555-4555-8555-555555555555';
const storage=()=>{const cache=new Map();return{getItem:(k:string)=>cache.get(k)??null,setItem:(k:string,v:string)=>{cache.set(k,v)},removeItem:(k:string)=>{cache.delete(k)}}};
describe('personal Jarvis mode preference',()=>{
 it('does not share state between two users in one company',()=>{
  const s=storage();expect(readJarvisAutopilot(org,alice,s)).toBe(false);
  expect(writeJarvisAutopilot(org,alice,true,s)).toBe(true);
  expect(readJarvisAutopilot(org,alice,s)).toBe(true);
  expect(readJarvisAutopilot(org,bob,s)).toBe(false);
  expect(writeJarvisAutopilot(org,alice,false,s)).toBe(true);
  expect(readJarvisAutopilot(org,alice,s)).toBe(false);
 });
 it('missing identity and inaccessible storage fail closed',()=>{
  expect(jarvisPreferenceKey('',alice)).toBeNull();
  expect(readJarvisAutopilot(org,alice,null)).toBe(false);
  expect(writeJarvisAutopilot(org,alice,true,null)).toBe(false);
 });
 it('only the newest assistant turn and an Auto employee may start',()=>{
  const eligible=(part:Record<string,unknown>={})=>canAutostartJarvisDelegation({
   modeEnabled:true,freshResponse:true,messageId:message,role:'owner',companyPlanReady:true,
   agent:{id:agent,enabled:true,autonomy:'auto'},...part,
  });
  expect(eligible()).toBe(true);
  for(const args of [{modeEnabled:false},{freshResponse:false},{messageId:null},{role:'viewer'},{companyPlanReady:false}])expect(eligible(args)).toBe(false);
  for(const autonomy of ['suggest','approval','notify'])expect(eligible({agent:{id:agent,enabled:true,autonomy}})).toBe(false);
 });
});