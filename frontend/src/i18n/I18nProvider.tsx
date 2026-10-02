import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { DEFAULT_LANG, dirOf, isLang, LANGUAGES, pickLanguage, STORAGE_KEY, translate, type Dict, type Lang, type Vars } from './core';
import { makeFormatters, type Formatters } from './format';
import { en, type TKey } from './locales/en';

type RichVars = Record<string, string | number | ReactNode>;

export interface I18n {
  lang: Lang;
  dir: 'ltr' | 'rtl';
  t: (key: TKey, vars?: Vars) => string;
  /** Like `t`, but placeholders may be React nodes (for styled fragments inside a sentence). */
  rich: (key: TKey, vars: RichVars) => ReactNode;
  has: (key: string) => boolean;
  setLang: (lang: Lang, opts?: { remote?: boolean }) => void;
  languages: typeof LANGUAGES;
  fmt: Formatters;
}

const loaders: Record<Exclude<Lang, 'en'>, () => Promise<{ default: Dict }>> = {
  el: () => import('./locales/el'),
  es: () => import('./locales/es'),
  'pt-BR': () => import('./locales/pt-BR'),
  de: () => import('./locales/de'),
  fr: () => import('./locales/fr'),
  'zh-CN': () => import('./locales/zh-CN'),
  ar: () => import('./locales/ar'),
};

function build(lang: Lang, dict: Dict, setLang: I18n['setLang']): I18n {
  const t: I18n['t'] = (key, vars) => translate(lang, dict, en, key, vars);
  const rich: I18n['rich'] = (key, vars) => {
    const primitives: Vars = {};
    for (const [k, v] of Object.entries(vars)) if (typeof v === 'string' || typeof v === 'number') primitives[k] = v;
    // Node-valued placeholders stay as {name} through translate(), then are swapped for the nodes here.
    const template = translate(lang, dict, en, key, primitives);
    return template.split(/(\{\w+\})/g).map((p, i) => {
      const m = /^\{(\w+)\}$/.exec(p);
      return m && m[1] in vars && typeof vars[m[1]] !== 'string' && typeof vars[m[1]] !== 'number' ? (
        <Fragment key={i}>{vars[m[1]] as ReactNode}</Fragment>
      ) : (
        p
      );
    });
  };
  return {
    lang,
    dir: dirOf(lang),
    t,
    rich,
    has: (key) => key in dict || key in en,
    setLang,
    languages: LANGUAGES,
    fmt: makeFormatters(lang),
  };
}

const defaultValue: I18n = build(DEFAULT_LANG, en, () => {});
/** English translator for non-React code and tests; components should use useI18n(). */
export const defaultI18n = defaultValue;
const Ctx = createContext<I18n>(defaultValue);
export const useI18n = (): I18n => useContext(Ctx);

function detect(): Lang {
  try {
    const param = new URLSearchParams(window.location.search).get('lang');
    return pickLanguage([param, localStorage.getItem(STORAGE_KEY), ...(navigator.languages ?? []), navigator.language]);
  } catch {
    return DEFAULT_LANG;
  }
}

export function I18nProvider({ children, onLangChange }: { children: ReactNode; onLangChange?: (lang: Lang) => void }) {
  const [lang, setLangState] = useState<Lang>(detect);
  const [dict, setDict] = useState<Dict | null>(lang === 'en' ? en : null);

  useEffect(() => {
    let live = true;
    if (lang === 'en') {
      setDict(en);
    } else {
      loaders[lang]()
        .then((m) => live && setDict(m.default))
        .catch(() => live && setDict(en)); // a failed chunk must never blank the app
    }
    return () => {
      live = false;
    };
  }, [lang]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }, [lang]);

  const setLang = useCallback(
    (next: Lang, opts?: { remote?: boolean }) => {
      if (!isLang(next)) return;
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* storage unavailable: the choice lasts for this session */
      }
      setLangState(next);
      if (opts?.remote !== false) onLangChange?.(next);
    },
    [onLangChange],
  );

  const value = useMemo(() => (dict ? build(lang, dict, setLang) : null), [lang, dict, setLang]);
  if (!value) return <div style={{ background: '#04100a', height: '100%' }} aria-busy="true" />;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
