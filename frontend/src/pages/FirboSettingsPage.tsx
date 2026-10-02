import { Moon, Monitor, Sun } from 'lucide-react';
import { LanguageSwitcher } from '../components/brand/LanguageSwitcher';
import { Panel } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { getBase } from '../lib/api';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { useAppStore } from '../lib/store';
import '../styles/firbo.css';

const GATEWAY_DASHBOARD = (import.meta.env.VITE_OMNIROUTE_URL as string | undefined) || '';
const THEMES = [
  { id: 'light', icon: Sun },
  { id: 'dark', icon: Moon },
  { id: 'system', icon: Monitor },
] as const;

/** Workspace settings for the hosted Firbo product (the legacy settings page belongs to the desktop build). */
export function FirboSettingsPage() {
  const { t } = useI18n();
  const { current, user, signOut } = useCompanyAuth();
  const theme = useAppStore((s) => s.settings.theme);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const api = getBase();
  const apiHost = api ? api.replace(/^https?:\/\//, '') : '';

  const row = (label: string, value: string) => (
    <div className="flex flex-wrap items-center justify-between gap-2 py-2" style={{ borderTop: '1px solid var(--fb-border)' }}>
      <span className="fb-muted text-sm">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('settings.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('settings.sub')}</p>
        </header>

        <Panel title={t('settings.account')}>
          {row(t('settings.email'), user?.email ?? '–')}
          {row(t('settings.company'), current?.organization.name ?? '–')}
          {row(t('settings.role'), current ? t(`role.${current.role}` as TKey) : '–')}
          <button className="fb-btn fb-btn--ghost mt-3" onClick={() => void signOut()}>
            {t('common.signOut')}
          </button>
        </Panel>

        <Panel title={t('settings.language')}>
          <p className="fb-muted mb-3 text-sm">{t('settings.languageHint')}</p>
          <LanguageSwitcher />
        </Panel>

        <Panel title={t('settings.appearance')}>
          <div role="radiogroup" aria-label={t('settings.appearance')} className="flex flex-wrap gap-2">
            {THEMES.map(({ id, icon: Icon }) => (
              <button
                key={id}
                role="radio"
                aria-checked={theme === id}
                onClick={() => updateSettings({ theme: id })}
                className="fb-chip cursor-pointer"
                style={theme === id ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(74, 222, 128,.1)' } : undefined}
              >
                <Icon size={13} /> {t(`settings.theme.${id}` as TKey)}
              </button>
            ))}
          </div>
        </Panel>

        <Panel title={t('settings.shortcuts')}>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="fb-muted">{t('settings.shortcutCmd')}</span>
            <kbd dir="ltr" className="fb-chip font-mono">⌘ / Ctrl + K</kbd>
          </div>
        </Panel>

        <Panel title={t('settings.server')}>
          <p className="fb-muted text-sm">{t('settings.serverText')}</p>
          {row(t('settings.apiAddress'), apiHost || t('settings.notConfigured'))}
          {GATEWAY_DASHBOARD && (
            <a className="fb-btn fb-btn--ghost mt-3 inline-flex" href={GATEWAY_DASHBOARD} target="_blank" rel="noopener noreferrer">
              {t('gw.openDashboard')} →
            </a>
          )}
        </Panel>

        <p className="fb-dim text-center text-xs">Firbo AI · © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}
