import { Globe } from 'lucide-react';
import { isLang } from '../../i18n/core';
import { useI18n } from '../../i18n/I18nProvider';

/** Native <select>: accessible everywhere, and each language is shown in its own script. */
export function LanguageSwitcher({ className = '' }: { className?: string }) {
  const { lang, setLang, languages, t } = useI18n();
  return (
    <label className={`fb-lang ${className}`} title={t('lang.label')}>
      <Globe size={14} aria-hidden />
      <span className="sr-only">{t('lang.label')}</span>
      <select
        value={lang}
        aria-label={t('lang.label')}
        onChange={(e) => isLang(e.target.value) && setLang(e.target.value)}
      >
        {languages.map((l) => (
          <option key={l.code} value={l.code} lang={l.code}>
            {l.name}
          </option>
        ))}
      </select>
    </label>
  );
}
