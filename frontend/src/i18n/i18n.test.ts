import { describe, expect, it } from 'vitest';
import { dirOf, interpolate, LANGUAGES, matchLanguage, pickLanguage, placeholdersOf, translate, type Dict, type Lang } from './core';
import { makeFormatters } from './format';
import { en } from './locales/en';
import { agentLabel, categoryLabel } from '../lib/company/labels';
import { describeAudit } from '../lib/company/audit';
import { buildFeed, timeAgo } from '../lib/company/feed';
import type { AuditRow } from '../lib/company/types';

const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  el: () => import('./locales/el'),
  es: () => import('./locales/es'),
  'pt-BR': () => import('./locales/pt-BR'),
  de: () => import('./locales/de'),
  fr: () => import('./locales/fr'),
  'zh-CN': () => import('./locales/zh-CN'),
  ar: () => import('./locales/ar'),
};
const codes = Object.keys(loaders) as Exclude<Lang, 'en'>[];
const load = async (l: Exclude<Lang, 'en'>) => (await loaders[l]()).default;
const PLURAL_EXTRA = /_(zero|two|few|many)$/;
const isPluralKey = (k: string) => /_(zero|one|two|few|many|other)$/.test(k);
const enDict = en as Dict;

describe('language registry', () => {
  it('ships English plus the seven requested languages', () => {
    expect(LANGUAGES.map((l) => l.code)).toEqual(['en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar']);
  });

  it('marks only Arabic as right-to-left', () => {
    expect(LANGUAGES.filter((l) => l.dir === 'rtl').map((l) => l.code)).toEqual(['ar']);
    expect(dirOf('ar')).toBe('rtl');
    expect(dirOf('el')).toBe('ltr');
  });

  it('maps browser language tags to supported languages', () => {
    expect(matchLanguage('el-GR')).toBe('el');
    expect(matchLanguage('pt-PT')).toBe('pt-BR');
    expect(matchLanguage('zh-Hans-CN')).toBe('zh-CN');
    expect(matchLanguage('zh-TW')).toBe('zh-CN');
    expect(matchLanguage('ar-EG')).toBe('ar');
    expect(matchLanguage('EN-us')).toBe('en');
    expect(matchLanguage('ja')).toBeNull();
    expect(matchLanguage('')).toBeNull();
  });

  it('picks the first supported candidate, defaulting to English', () => {
    expect(pickLanguage([null, 'ja', 'de-AT', 'fr'])).toBe('de');
    expect(pickLanguage(['ja', undefined])).toBe('en');
    expect(pickLanguage(['xx', 'el'])).toBe('el');
  });
});

describe.each(codes)('locale %s', (code) => {
  it('has every English key and no unknown keys', async () => {
    const d = await load(code);
    const missing = Object.keys(enDict).filter((k) => !(k in d));
    const unknown = Object.keys(d).filter((k) => !(k in enDict) && !(PLURAL_EXTRA.test(k) && `${k.replace(PLURAL_EXTRA, '')}_other` in enDict));
    expect({ missing, unknown }).toEqual({ missing: [], unknown: [] });
  });

  it('keeps every {placeholder} (names are code, not text)', async () => {
    const d = await load(code);
    const bad: string[] = [];
    for (const [k, v] of Object.entries(d)) {
      const base = PLURAL_EXTRA.test(k) ? enDict[`${k.replace(PLURAL_EXTRA, '')}_other`] : enDict[k];
      const want = placeholdersOf(base);
      const got = placeholdersOf(v);
      // plural forms such as "one model" or "no tools" may legitimately drop {count} and other numbers
      const required = isPluralKey(k) ? [] : want;
      if (got.some((p) => !want.includes(p)) || required.some((p) => !got.includes(p))) bad.push(`${k}: ${want} vs ${got}`);
    }
    expect(bad).toEqual([]);
  });

  it('has no blank values and never mentions the old brand', async () => {
    const d = await load(code);
    for (const [k, v] of Object.entries(d)) {
      expect(v.trim(), k).not.toBe('');
      expect(v, k).not.toMatch(/jarvis/i);
    }
  });

  it('translates the vast majority of strings (not copied English)', async () => {
    const d = await load(code);
    const same = Object.keys(enDict).filter((k) => d[k] === enDict[k] && /[a-z]{4}/i.test(enDict[k]));
    // Brand names, protocol terms and "AI Gateway"-style labels may legitimately match.
    expect(same.length / Object.keys(enDict).length).toBeLessThan(0.1);
  });
});

describe('English source', () => {
  it('only uses plural groups that have both one and other', () => {
    for (const k of Object.keys(enDict).filter((x) => x.endsWith('_one'))) expect(enDict[`${k.slice(0, -4)}_other`], k).toBeDefined();
    for (const k of Object.keys(enDict).filter((x) => x.endsWith('_other'))) expect(enDict[`${k.slice(0, -6)}_one`], k).toBeDefined();
  });
});

describe('translate', () => {
  it('interpolates and leaves unknown placeholders intact', () => {
    expect(interpolate('Hi {name} {x}', { name: 'Ana' })).toBe('Hi Ana {x}');
  });

  it('picks English plural forms', () => {
    expect(translate('en', enDict, enDict, 'team.subtitle', { count: 1 })).toMatch(/^1 employee ·/);
    expect(translate('en', enDict, enDict, 'team.subtitle', { count: 3 })).toMatch(/^3 employees ·/);
  });

  it('uses all six Arabic plural categories', async () => {
    const ar = await load('ar');
    const t = (n: number) => translate('ar', ar, enDict, 'chip.tools', { count: n });
    expect(t(0)).toBe('بلا أدوات');
    expect(t(1)).toBe('أداة واحدة');
    expect(t(2)).toBe('أداتان');
    expect(t(3)).toBe('3 أدوات');
    expect(t(11)).toBe('11 أداة');
    expect(t(100)).toBe('100 أداة');
  });

  it('keeps Chinese (single plural form) readable for any count', async () => {
    const zh = await load('zh-CN');
    expect(translate('zh-CN', zh, enDict, 'chip.tools', { count: 1 })).toBe('1 个工具');
    expect(translate('zh-CN', zh, enDict, 'chip.tools', { count: 5 })).toBe('5 个工具');
  });

  it('falls back to English, then to the key, instead of rendering blanks', () => {
    expect(translate('el', {}, enDict, 'common.close')).toBe('Close');
    expect(translate('el', {}, enDict, 'no.such.key')).toBe('no.such.key');
    expect(translate('el', {}, enDict, 'team.subtitle', { count: 2 })).toMatch(/^2 employees/);
  });
});

describe('formatting', () => {
  it('formats currency and numbers per locale', () => {
    expect(makeFormatters('en').currency(1234.5)).toBe('$1,234.50');
    expect(makeFormatters('de').currency(1234.5)).toMatch(/1\.234,50/);
    expect(makeFormatters('de').number(1234567)).toBe('1.234.567');
  });

  it('keeps Western digits in Arabic so figures match the rest of the product', () => {
    const n = makeFormatters('ar').number(2026);
    expect(n).toMatch(/^2.?026$/);
    expect(n).not.toMatch(/[٠-٩]/);
    expect(makeFormatters('ar').relative(Date.now() - 5 * 60_000)).toMatch(/5/);
  });

  it('renders relative time in the viewer language', () => {
    const now = 1_700_000_000_000;
    expect(makeFormatters('en').relative(now - 5 * 60_000, now)).toBe('5 min. ago');
    expect(makeFormatters('es').relative(now - 3 * 3_600_000, now)).toMatch(/3/);
    expect(timeAgo(now - 10_000, now, makeFormatters('en'))).toBe('now');
  });
});

describe('domain labels', () => {
  const i18nFor = async (code: Exclude<Lang, 'en'>) => {
    const d = await load(code);
    return { t: (k: string, v?: Record<string, string | number>) => translate(code, d, enDict, k, v), fmt: makeFormatters(code) };
  };

  it('translates seeded and marketplace agents but keeps names the user chose', async () => {
    const el = await i18nFor('el');
    const ceo = { slug: 'ceo', name: 'CEO Agent', description: enDict['agent.ceo.desc'] };
    expect(agentLabel(ceo, el as never).name).toBe('Agent CEO');
    expect(agentLabel({ slug: 'recruiter-2', name: 'Recruiting Agent 2', description: null }, el as never).name).toBe('Agent Προσλήψεων 2');
    expect(agentLabel({ slug: 'ceo', name: 'Boss Bot', description: 'mine' }, el as never)).toEqual({ name: 'Boss Bot', description: 'mine' });
    expect(agentLabel({ slug: 'my-own', name: 'Zed', description: null }, el as never).name).toBe('Zed');
  });

  it('translates marketplace categories', async () => {
    const de = await i18nFor('de');
    expect(categoryLabel('Finance & Legal', de as never)).toBe('Finanzen und Recht');
    expect(categoryLabel('Unknown', de as never)).toBe('Unknown');
  });

  it('describes audit rows in the viewer language', async () => {
    const fr = await i18nFor('fr');
    const row: AuditRow = { id: '1', action: 'approval.approved', entity: null, actor_id: 'u', metadata: { action: 'send_email', note: 'ok' }, created_at: '2026-10-01T00:00:00Z' };
    const who = { agent: () => 'A', person: () => 'Ana' };
    expect(describeAudit(row, who, fr as never).text).toBe('Ana a validé « send_email » — « ok »');
    const upd: AuditRow = { ...row, action: 'agent.updated', metadata: { name: 'S', changed: ['autonomy', 'budget'], autonomy: 'notify', budget: 50 } };
    expect(describeAudit(upd, who, fr as never).text).toContain('Agit et prévient');
  });

  it('builds the feed with translated tags', async () => {
    const es = await i18nFor('es');
    const feed = buildFeed(
      [],
      [{ id: 'a', agent_id: null, action: 'x', status: 'pending', requested_at: '2026-10-01T00:00:00Z' } as never],
      [],
      Date.parse('2026-10-01T01:00:00Z'),
      8,
      es as never,
    );
    expect(feed[0].tag).toBe('Aprobación');
    expect(feed[0].title).toBe('Sin asignar necesita aprobación: x');
  });
});
