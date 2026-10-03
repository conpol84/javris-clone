import { en, type TKey } from '../../i18n/locales/en';
import type { I18n } from '../../i18n/I18nProvider';
import { AGENT_TEMPLATES } from './templates';

type T = Pick<I18n, 't'>;

/** Template slug for an agent row: its own slug, or a hired copy such as "recruiter-2". */
function templateSlug(slug: string): string | null {
  return AGENT_TEMPLATES.find((tpl) => slug === tpl.slug || slug.startsWith(`${tpl.slug}-`))?.slug ?? null;
}

/**
 * Built-in agents and marketplace hires are stored with English names; show them in the viewer's language.
 * A name the user changed (anything not equal to the stored English default) is shown untouched.
 */
export function agentLabel(a: { slug: string; name: string; description?: string | null }, { t }: T): { name: string; description: string } {
  const base = templateSlug(a.slug) ?? a.slug;
  const nameKey = `agent.${base}.name`;
  const descKey = `agent.${base}.desc`;
  const tplNameKey = `tpl.${base}.name`;
  const tplTagKey = `tpl.${base}.tagline`;
  const known = en as Record<string, string>;
  const suffix = a.slug.slice(base.length); // "-2" for duplicate hires
  let name = a.name;
  let description = a.description ?? '';
  if (known[nameKey] !== undefined && a.name === known[nameKey]) {
    name = t(nameKey as TKey);
    if (known[descKey] !== undefined && description === known[descKey]) description = t(descKey as TKey);
  } else if (known[tplNameKey] !== undefined && (a.name === known[tplNameKey] || a.name === `${known[tplNameKey]} ${suffix.slice(1)}`)) {
    name = t(tplNameKey as TKey) + (suffix ? ` ${suffix.slice(1)}` : '');
    if (description === known[tplTagKey]) description = t(tplTagKey as TKey);
  }
  return { name, description };
}

const CATEGORY_KEY = {
  Growth: 'cat.growth',
  Operations: 'cat.operations',
  Engineering: 'cat.engineering',
  Intelligence: 'cat.intelligence',
  'Finance & Legal': 'cat.legal',
} as const satisfies Record<string, TKey>;

export function categoryLabel(category: string, { t }: T): string {
  const key = (CATEGORY_KEY as Record<string, TKey>)[category];
  return key ? t(key) : category;
}
