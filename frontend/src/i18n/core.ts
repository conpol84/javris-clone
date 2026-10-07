export const LANGUAGES = [
  { code: 'en', name: 'English', dir: 'ltr' },
  { code: 'el', name: 'Ελληνικά', dir: 'ltr' },
  { code: 'es', name: 'Español', dir: 'ltr' },
  { code: 'pt-BR', name: 'Português (Brasil)', dir: 'ltr' },
  { code: 'de', name: 'Deutsch', dir: 'ltr' },
  { code: 'fr', name: 'Français', dir: 'ltr' },
  { code: 'zh-CN', name: '简体中文', dir: 'ltr' },
  { code: 'ar', name: 'العربية', dir: 'rtl' },
] as const;

export type Lang = (typeof LANGUAGES)[number]['code'];
export type Dict = Record<string, string>;
export type Vars = Record<string, string | number>;

export const DEFAULT_LANG: Lang = 'en';
export const STORAGE_KEY = 'firbo-lang';

export const isLang = (x: unknown): x is Lang => LANGUAGES.some((l) => l.code === x);
export const dirOf = (lang: Lang): 'ltr' | 'rtl' => LANGUAGES.find((l) => l.code === lang)?.dir ?? 'ltr';

/** Map any BCP-47 tag ("pt-PT", "zh-Hans", "ar-EG", "el-GR") to the closest supported language. */
export function matchLanguage(tag: string): Lang | null {
  const t = tag.trim().toLowerCase();
  if (!t) return null;
  const exact = LANGUAGES.find((l) => l.code.toLowerCase() === t);
  if (exact) return exact.code;
  const base = t.split('-')[0];
  if (base === 'pt') return 'pt-BR';
  if (base === 'zh') return 'zh-CN';
  return LANGUAGES.find((l) => l.code.toLowerCase() === base)?.code ?? null;
}

/** First supported language among the candidates (stored choice, ?lang=, browser preferences), else English. */
export function pickLanguage(candidates: readonly (string | null | undefined)[]): Lang {
  for (const c of candidates) {
    const m = c ? matchLanguage(c) : null;
    if (m) return m;
  }
  return DEFAULT_LANG;
}

export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

const pluralRulesCache = new Map<string, Intl.PluralRules>();
function pluralRule(lang: Lang, n: number): string {
  let rules = pluralRulesCache.get(lang);
  if (!rules) {
    rules = new Intl.PluralRules(lang);
    pluralRulesCache.set(lang, rules);
  }
  return rules.select(n);
}

/**
 * Resolve a key. With a numeric `count` the plural form `key_<rule>` (zero/one/two/few/many/other) is used,
 * falling back to `key_other`, then to English, then to the key itself so a gap never renders blank.
 */
export function translate(lang: Lang, dict: Dict, fallback: Dict, key: string, vars?: Vars): string {
  let template: string | undefined;
  if (vars && typeof vars.count === 'number') {
    const rule = pluralRule(lang, vars.count);
    template = dict[`${key}_${rule}`] ?? dict[`${key}_other`] ?? fallback[`${key}_${pluralRule('en', vars.count)}`] ?? fallback[`${key}_other`];
  }
  template ??= dict[key] ?? fallback[key] ?? key;
  return interpolate(template, vars);
}

export function placeholdersOf(template: string): string[] {
  return [...new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}
