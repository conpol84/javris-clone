import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fixture=vi.hoisted(()=>({lang:'en'}));
vi.mock('../../i18n/I18nProvider',()=>({useI18n:()=>({lang:fixture.lang,t:(key:string)=>key})}));

const markup=async()=>{
  const {ServiceAccessPanel}=await import('./ServiceAccessPanel');
  return renderToStaticMarkup(<MemoryRouter><ServiceAccessPanel /></MemoryRouter>);
};
describe('platform admin gateway links and private FreeLLMAPI owner tunnel',()=>{
  beforeEach(()=>{fixture.lang='en';vi.resetModules();vi.unstubAllEnvs();});
  afterEach(()=>{vi.unstubAllEnvs();});
  it('always gives usable gateway login and the private FreeLLMAPI SSH tunnel link without environment configuration',async()=>{
    const html=await markup();
    expect(html).toContain('data-service-login="omniroute"');
    expect(html).toContain('href="https://gateway.firboai.app/"');
    expect(html).toContain('data-service-login="freellmapi"');
    expect(html).toContain('href="http://127.0.0.1:13001/"');
    expect(html).toContain('data-free-ssh-tunnel="true"');
    expect(html).toContain('ssh -N -L 13001:127.0.0.1:3001 root@YOUR_VPS_PUBLIC_IP');
    expect(html).toContain('same computer');
    expect(html).toContain('href="/admin?tab=console"');
    expect(html).toContain('href="/gateway?tab=free"');
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)).toHaveLength(3);
    expect(html).not.toContain('http://127.0.0.1:3001"');
    expect(html).not.toContain('freellmapi:3001');
    expect(html).not.toContain('/v1/chat/completions');
  });
  it.each([
    'javascript:alert(1)','http://public.example/','https://admin:secret@public.example/',
    'https://public.example/?token=secret','http://127.0.0.1:3001',
    'https://localhost:3001','https://10.0.0.5:3001',
  ])('rejects unsafe configured external FreeLLMAPI dashboard URLs: %s',async bad=>{
    vi.stubEnv('VITE_FREELLMAPI_DASHBOARD_URL',bad);
    const html=await markup();
    expect(html).toContain('href="http://127.0.0.1:13001/"');
    expect(html).toContain('data-free-ssh-tunnel="true"');
    expect(html).not.toContain('href="'+bad+'"');
    expect(html).not.toContain('admin:secret');
  });
  it('uses an explicitly configured HTTPS FreeLLMAPI management portal if ever deployed',async()=>{
    vi.stubEnv('VITE_FREELLMAPI_DASHBOARD_URL','https://private-management.example/sign-in');
    const html=await markup();
    expect(html).toContain('href="https://private-management.example/sign-in"');
    expect(html).not.toContain('data-free-ssh-tunnel="true"');
    expect(html).not.toContain('href="http://127.0.0.1:13001/"');
    expect(html).toContain('data-service-login="freellmapi"');
  });
  it('rejects poisoned OmniRoute URL and uses the reviewed domain',async()=>{
    vi.stubEnv('VITE_OMNIROUTE_URL','javascript:alert(1)');
    const html=await markup();
    expect(html).toContain('href="https://gateway.firboai.app/"');
    expect(html).not.toContain('href="javascript:');
  });
  it.each(['en','el','es','pt-BR','fr','de','zh-CN','ar'])('keeps both login links available and described in %s',async lang=>{
    fixture.lang=lang;
    const html=await markup();
    expect(html).toContain('data-service-login="omniroute"');
    expect(html).toContain('data-service-login="freellmapi"');
    expect(html).toContain('data-free-ssh-tunnel="true"');
    expect(html).toContain('href="http://127.0.0.1:13001/"');
    expect(html).not.toContain('Connection pending');
    expect(html).not.toContain('Αναμονή σύνδεσης');
    expect(html).not.toContain('undefined');
  });
});
