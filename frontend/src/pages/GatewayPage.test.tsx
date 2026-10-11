import {renderToStaticMarkup} from 'react-dom/server';
import {beforeEach,describe,expect,it,vi} from 'vitest';

const gate=vi.hoisted(()=>({
 authorized:false,loading:false,platformAdmin:false,sessionCalls:0,adminMounts:0,sessionLoading:false,
}));
vi.mock('../lib/company/admin',()=>({
 usePlatformAdminAccess:()=>({authorized:gate.authorized,loading:gate.loading}),
}));
vi.mock('../i18n/I18nProvider',()=>({useI18n:()=>({t:(key:string)=>key})}));
vi.mock('react-router',()=>({Navigate:()=> <div data-redirect="home"/>}));
vi.mock('./GatewayLegacyPanel',()=>({GatewayPage:()=> <div data-admin-gateway="true"/>}));
vi.mock('../components/gateway/NativeGatewayConsole',()=>({
 useFirboSession:()=>{gate.sessionCalls++;return{
   loading:gate.sessionLoading,data:{platform_admin:gate.platformAdmin},reload:vi.fn(),
 };},
 GatewayUnavailable:()=> <div data-gateway-unavailable="true"/>,
}));
import {GatewayPage} from './GatewayPage';
describe('platform-only Gateway access',()=>{
 beforeEach(()=>{gate.authorized=false;gate.loading=false;gate.platformAdmin=false;gate.sessionCalls=0;gate.sessionLoading=false;});
 it('does not mount gateway transport while platform-admin RPC is pending',()=>{
  gate.loading=true;const html=renderToStaticMarkup(<GatewayPage/>);
  expect(html).toContain('common.loading');
  expect(gate.sessionCalls).toBe(0);
 });
 it('does not mount gateway transport for a company owner without platform-admin grant',()=>{
  const html=renderToStaticMarkup(<GatewayPage/>);
  expect(html).toContain('data-redirect="home"');
  expect(gate.sessionCalls).toBe(0);
  expect(html).not.toContain('data-admin-gateway');
 });
 it('also respects the backend platform_admin claim after the client grant',()=>{
  gate.authorized=true;
  const html=renderToStaticMarkup(<GatewayPage/>);
  expect(html).toContain('data-redirect="home"');
  expect(gate.sessionCalls).toBe(1);
 });
 it('only allows a verified platform admin to mount the global gateway UI',()=>{
  gate.authorized=true;gate.platformAdmin=true;
  const html=renderToStaticMarkup(<GatewayPage/>);
  expect(html).toContain('data-admin-gateway="true"');
  expect(gate.sessionCalls).toBe(1);
 });
});