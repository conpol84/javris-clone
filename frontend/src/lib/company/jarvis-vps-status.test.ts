import {describe,expect,it} from 'vitest';
import {diagnoseNativeJarvis,nativeJarvisLabels,NATIVE_JARVIS_LOGIN} from './jarvis-vps-status';

describe('Real OpenJarvis VPS status is distinct from the dashboard page',()=>{
 it('never mistakes publicly reachable login or /health for an authenticated native API',()=>{
  expect(diagnoseNativeJarvis(null)).toBe('checking');
  expect(diagnoseNativeJarvis(null,true)).toBe('bridge_unavailable');
  expect(diagnoseNativeJarvis({configured:false})).toBe('not_configured');
  expect(diagnoseNativeJarvis({configured:true,online:true})).toBe('online');
  expect(NATIVE_JARVIS_LOGIN).toBe('https://jarvis.firboai.app/_firbo/login');
 });
 it.each([
  ['http_401','native_api_unauthorized'],
  ['http_403','native_api_forbidden'],
  ['http_404','native_api_not_found'],
  ['http_429','native_api_unavailable'],
  ['http_503','native_api_unavailable'],
  ['provider-secret-key-xyz','native_api_unavailable'],
  [null,'native_api_unavailable'],
 ])('classifies native API error %s without reproducing secret-bearing text', (reason,expected)=>{
  expect(diagnoseNativeJarvis({configured:true,online:false,reason})).toBe(expected);
  expect(nativeJarvisLabels('el').details[expected as keyof ReturnType<typeof nativeJarvisLabels>['details']]).not.toContain('provider-secret-key');
 });
 it('reminds owner that VPS admin login is separate from API authentication in Greek',()=>{
  const el=nativeJarvisLabels('el');
  expect(el.separation).toContain('διαφορετικό');
  expect(el.details.native_api_unauthorized).toContain('server-side API key');
 });
});
