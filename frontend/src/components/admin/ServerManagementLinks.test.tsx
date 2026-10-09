import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ lang: 'en', current: { role: 'owner', organization: { id: 'company-a', name: 'Company A' } } as { role: string; organization: { id: string; name: string } } | null }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: fixture.lang, t: (key: string) => key }) }));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: fixture.current }) }));
import { MANAGEMENT_COPY, ServerManagementLinks } from './ServerManagementLinks';

const render = () => renderToStaticMarkup(<MemoryRouter><ServerManagementLinks /></MemoryRouter>);
describe('company management navigation', () => {
  beforeEach(() => { fixture.lang = 'en'; fixture.current = { role: 'owner', organization: { id: 'company-a', name: 'Company A' } }; });
  it('opens the existing scoped management pages rather than native server endpoints', () => {
    const html = render();
    for (const path of ['/memory', '/studio', '/integrations', '/activity', '/computers', '/inbox']) expect(html).toContain(`href="${path}"`);
    expect(html.match(/href=/g)).toHaveLength(6); expect(html).toContain('Company: Company A');
    expect(html).not.toContain('/v1/'); expect(html).not.toContain('/api/'); expect(html).not.toContain('target="_blank"');
  });
  it('follows the currently selected company and its role instead of retaining another company identity', () => {
    expect(render()).toContain('Company A');
    fixture.current = { role: 'viewer', organization: { id: 'company-b', name: 'Company B' } };
    const html = render(); expect(html).toContain('Company B'); expect(html).not.toContain('Company A'); expect(html).toContain('current company permissions');
  });
  it('does not offer unscoped company management links when no company is selected', () => {
    fixture.current = null; const html = render(); expect(html).toContain(MANAGEMENT_COPY.en.missing); expect(html).not.toContain('href=');
  });
  it('escapes company names instead of injecting markup', () => {
    fixture.current!.organization.name = '<script>company</script>'; expect(render()).toContain('&lt;script&gt;company&lt;/script&gt;'); expect(render()).not.toContain('<script>');
  });
  it.each(['en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar'])('offers every management action with complete %s labels', lang => {
    fixture.lang = lang;
    const copy = MANAGEMENT_COPY[lang]; expect(Object.keys(copy)).toEqual(Object.keys(MANAGEMENT_COPY.en));
    for (const label of Object.values(copy)) expect(label.trim()).not.toBe('');
    const html = render(); expect(html).toContain(copy.title); expect(html.match(/href=/g)).toHaveLength(6); expect(html).not.toContain('{company}');
  });
});
