import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import type { Lang } from '../../i18n/core';
const language = vi.hoisted(() => ({ current: 'en' as Lang }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: language.current }) }));
import { AGENCY_COPY } from '../../lib/company/agencyCopy';
import { AGENCY_SOURCE } from '../../lib/company/agencySpecialists';
import { AgencySpecialistDetails } from './AgencySpecialistDetails';

it.each(Object.keys(AGENCY_COPY) as Lang[])('renders the method in %s with an immutable source link and no runtime-ready claim', lang => {
  language.current = lang;
  const html = renderToStaticMarkup(<AgencySpecialistDetails slug="deep-research" expanded />);
  expect(html).toContain('<details');
  expect(html).toContain('open=""');
  expect(html).toContain(AGENCY_COPY[lang].method);
  expect(html).toContain(AGENCY_COPY[lang].research);
  expect(html).toContain(`/blob/${AGENCY_SOURCE.commit}/research/research-synthesist.md`);
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain('<script');
});

it('starts collapsed on catalog cards and renders nothing for non-specialist templates', () => {
  language.current = 'en';
  expect(renderToStaticMarkup(<AgencySpecialistDetails slug="qa-engineer" />)).not.toContain('open=');
  expect(renderToStaticMarkup(<AgencySpecialistDetails slug="customer-support" />)).toBe('');
});
