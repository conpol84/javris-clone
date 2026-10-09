import { describe, expect, it } from 'vitest';
import { DEFAULT_JARVIS_DASHBOARD, dashboardUrl, jarvisDashboardUrl } from './service-dashboards';

describe('management dashboard navigation', () => {
  it.each([undefined, '', 'http://jarvis.firboai.app/', 'javascript:alert(1)', 'https://admin:secret@jarvis.firboai.app/', 'https://jarvis.firboai.app/?key=secret', 'https://jarvis.firboai.app/#secret', 'https://localhost/', 'https://127.0.0.1/', 'https://10.0.0.1/', 'https://172.17.0.1/', 'https://192.168.1.1/', 'https://computer.local/'])('keeps unsafe or missing dashboard configuration %s out of management links', value => {
    expect(dashboardUrl(value)).toBeNull(); expect(jarvisDashboardUrl(value)).toBe(DEFAULT_JARVIS_DASHBOARD);
  });
  it.each(['https://javris.firboai.app/coding', 'https://firboai.app/coding', 'https://www.firboai.app/admin', 'https://javris.firboai.app/', 'https://jarvis.firboai.app/coding/', 'https://custom.example/coding'])('replaces a hosted self-link %s with the server dashboard', value => {
    expect(jarvisDashboardUrl(value)).toBe(DEFAULT_JARVIS_DASHBOARD);
  });
  it('preserves a valid dedicated management dashboard or its HTML sign-in path', () => {
    expect(jarvisDashboardUrl('https://management.example/jarvis/')).toBe('https://management.example/jarvis/');
    expect(jarvisDashboardUrl('https://jarvis.firboai.app/_firbo/login')).toBe('https://jarvis.firboai.app/_firbo/login');
  });
});
