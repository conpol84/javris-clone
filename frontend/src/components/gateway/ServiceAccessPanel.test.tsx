import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
const locale = vi.hoisted(() => ({ lang: 'en' }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: locale.lang, t: (key: string) => key }) }));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: null }) }));
vi.mock('../../lib/company/client', () => ({ requireClient: () => ({ functions: { invoke } }) }));

describe('shared Jarvis management entrypoints', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); locale.lang = 'en'; });
  afterEach(() => { vi.unstubAllEnvs(); });
  it.each([undefined, 'https://javris.firboai.app/coding', 'javascript:alert(1)', 'https://admin:secret@jarvis.firboai.app/'])('uses the real management domain in both server and service panels for %s', async value => {
    vi.stubEnv('VITE_SERVER_AGENT_DASHBOARD', value);
    const { ServerJarvisPanel } = await import('../admin/ServerJarvisPanel');
    const html = renderToStaticMarkup(<MemoryRouter><ServerJarvisPanel /></MemoryRouter>);
    expect(html.match(/href="https:\/\/jarvis\.firboai\.app\/"/g)).toHaveLength(2);
    expect(html).not.toContain('href="https://javris.firboai.app/coding');
    expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('admin:secret');
    expect(html.match(/target="_blank" rel="noopener noreferrer"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(invoke).not.toHaveBeenCalled();
  });
  it('uses one valid configured management location consistently without proxying native APIs', async () => {
    vi.stubEnv('VITE_SERVER_AGENT_DASHBOARD', 'https://management.example/jarvis/');
    const { ServerJarvisPanel } = await import('../admin/ServerJarvisPanel');
    const html = renderToStaticMarkup(<MemoryRouter><ServerJarvisPanel /></MemoryRouter>);
    expect(html.match(/href="https:\/\/management\.example\/jarvis\/"/g)).toHaveLength(2);
    expect(html).toContain('href="/admin?tab=jarvis"'); expect(html).toContain('href="/admin?tab=console"');
    expect(invoke).not.toHaveBeenCalled();
  });
});


describe('private FreeLLMAPI and OmniRoute logins in FIRBO platform admin', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); locale.lang = 'en'; });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('shows both real logins and a deliberate owner-local tunnel without leaking any credential', async () => {
    vi.stubEnv('VITE_OMNIROUTE_URL', undefined);
    vi.stubEnv('VITE_FREELLMAPI_DASHBOARD_URL', undefined);
    const { ServiceAccessPanel, FREELLMAPI_OWNER_TUNNEL } = await import('./ServiceAccessPanel');
    const html = renderToStaticMarkup(<MemoryRouter><ServiceAccessPanel /></MemoryRouter>);
    expect(FREELLMAPI_OWNER_TUNNEL).toBe('http://127.0.0.1:13001/');
    expect(html).toContain('href="https://gateway.firboai.app/"');
    expect(html).toContain('href="http://127.0.0.1:13001/"');
    expect(html).toContain('data-service-login="freellmapi"');
    expect(html).toContain('data-service-login="omniroute"');
    expect(html).toContain('data-free-ssh-tunnel="true"');
    expect(html).toContain('ssh -N -L 13001:127.0.0.1:3001 root@YOUR_VPS_PUBLIC_IP');
    expect(html).not.toContain('href="http://0.0.0.0:3001');
    expect(html).not.toContain('127.0.0.1:3001/"');
    expect(html).not.toContain('password=');
    expect(html).not.toContain('api_key=');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('never silently treats unsafe remote dashboard configuration as a public FreeLLMAPI login', async () => {
    for (const bad of ['http://vps.example/login', 'https://admin:secret@free.example/login', 'javascript:alert(1)', 'https://127.0.0.1:3001/', 'https://example.org/login?api_key=secret']) {
      vi.resetModules();
      vi.stubEnv('VITE_FREELLMAPI_DASHBOARD_URL', bad);
      const { ServiceAccessPanel } = await import('./ServiceAccessPanel');
      const html = renderToStaticMarkup(<MemoryRouter><ServiceAccessPanel /></MemoryRouter>);
      expect(html).toContain('href="http://127.0.0.1:13001/"');
      expect(html).toContain('data-free-ssh-tunnel="true"');
      expect(html).not.toContain(bad);
    }
  });

  it('uses an explicitly configured HTTPS management dashboard without displaying the private tunnel', async () => {
    vi.stubEnv('VITE_FREELLMAPI_DASHBOARD_URL', 'https://approved-dashboard.example/login/');
    const { ServiceAccessPanel } = await import('./ServiceAccessPanel');
    const html = renderToStaticMarkup(<MemoryRouter><ServiceAccessPanel /></MemoryRouter>);
    expect(html).toContain('href="https://approved-dashboard.example/login/"');
    expect(html).not.toContain('href="http://127.0.0.1:13001/"');
    expect(html).not.toContain('data-free-ssh-tunnel="true"');
    expect(html).toContain('referrerPolicy="no-referrer"');
  });

  it.each(['en', 'el', 'es', 'pt-BR', 'fr', 'de', 'zh-CN', 'ar'])('always preserves both login controls in %s', async lang => {
    locale.lang = lang;
    const { ServiceAccessPanel } = await import('./ServiceAccessPanel');
    const html = renderToStaticMarkup(<MemoryRouter><ServiceAccessPanel /></MemoryRouter>);
    expect(html).toContain('data-service-login="omniroute"');
    expect(html).toContain('data-service-login="freellmapi"');
    expect(html).toContain('data-free-ssh-tunnel="true"');
    expect(html).not.toContain('Connection pending');
  });
});
