import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSession, parseControl, parseModelLines } from '../../frontend/src/components/gateway/nativeControl.ts';
const data = () => ({ contract: 'firbo-control/v1', reachable: true, available: true, writes_enabled: false,
  providers: [{id:'a',provider:'provider',name:'Production',active:true,status:'active'}], models:[{id:'provider/a',provider:'provider'}],
  combos:[{name:'firbo-economy',strategy:'priority',models:['provider/a'],revision:'0'.repeat(64),managed:true,editable:true}],errors:{} });
test('valid control contract', () => assert.equal(parseControl(data()).available, true));
test('reject legacy HTML and wrong-shape mock data', () => {
  for (const value of ['<!doctype html>', {}, null, {contract:'firbo-control/v0'}]) assert.throws(() => parseControl(value));
});
test('reject unexpected provider shape', () => { const v = data(); v.providers = [{apiKey:'secret'}]; assert.throws(() => parseControl(v)); });
test('do not enable writes with incomplete verification', () => { const v = data(); v.writes_enabled = true; v.errors = {models:'unavailable'}; assert.throws(() => parseControl(v)); });
test('reject invalid revisions', () => { const v = data(); v.combos[0].revision = 'invalid'; assert.throws(() => parseControl(v)); });
test('valid scoped session', () => assert.equal(parseSession({contract:'firbo-control/v1',platform_admin:false,companies:[],has_more:false}).platform_admin, false));
test('do not infer admin from truthy strings', () => assert.throws(() => parseSession({contract:'firbo-control/v1',platform_admin:'true',companies:[],has_more:false})));
test('model ordering preserved', () => assert.deepEqual(parseModelLines(' provider/b \r\nprovider/a\n'), ['provider/b','provider/a']));
test('reject empty duplicates and too many model steps', () => {
  for (const value of ['', 'provider/a\nprovider/a', Array.from({length:13}, (_,i) => `p/${i}`).join('\n')]) assert.throws(() => parseModelLines(value));
});
test('reject control characters', () => assert.throws(() => parseModelLines('provider/\u0000a')));

test('all eight control label dictionaries have non-empty matching keys', async () => {
  const { controlLabels } = await import('../../frontend/src/components/gateway/firboControlLabels.ts');
  assert.deepEqual(Object.keys(controlLabels).sort(), ['en','el','es','pt-BR','de','fr','zh-CN','ar'].sort());
  const keys = Object.keys(controlLabels.en).sort();
  for (const dictionary of Object.values(controlLabels)) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    assert.ok(Object.values(dictionary).every(value => typeof value === 'string' && value.trim()));
  }
});
