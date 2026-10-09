import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: null }) }));
vi.mock('../../lib/company/client', () => ({ requireClient: () => ({ functions: { invoke } }) }));

describe('shared Jarvis management entrypoints', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); });
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
