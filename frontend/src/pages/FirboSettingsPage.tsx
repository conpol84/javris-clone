import { LanguageSwitcher } from '../components/brand/LanguageSwitcher';
import { Panel } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { getBase } from '../lib/api';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { useAppStore } from '../lib/store';
import { Avatar, PageHeader, Pill, Segmented } from '../components/ui/kit';
import '../styles/firbo.css';

const GATEWAY_DASHBOARD = (import.meta.env.VITE_OMNIROUTE_URL as string | undefined) || '';
const THEMES = [{ id: 'light' }, { id: 'dark' }, { id: 'system' }] as const;

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
      <div className="mx-auto max-w-4xl space-y-5 px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader eyebrow={current?.organization.name} title={t('settings.title')} sub={t('settings.sub')} />

        <section className="fb-glass flex flex-wrap items-center gap-4 p-5">
          <Avatar name={user?.email ?? '?'} color="#22d3ee" size={56} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-base font-semibold">{user?.email ?? '–'}</div>
            <div className="fb-dim mt-0.5 text-sm">{current?.organization.name ?? '–'}</div>
          </div>
          {current && <Pill tone="accent">{t(`role.${current.role}` as TKey)}</Pill>}
          <button className="fb-btn fb-btn--ghost" onClick={() => void signOut()}>
            {t('common.signOut')}
          </button>
        </section>

        <div className="grid gap-5 md:grid-cols-2">
          <Panel title={t('settings.language')}>
            <p className="fb-muted mb-3 text-sm">{t('settings.languageHint')}</p>
            <LanguageSwitcher />
          </Panel>

          <Panel title={t('settings.appearance')}>
            <Segmented
              value={theme as 'light' | 'dark' | 'system'}
              onChange={(id) => updateSettings({ theme: id })}
              label={t('settings.appearance')}
              options={THEMES.map(({ id }) => ({ id, label: t(`settings.theme.${id}` as TKey) }))}
            />
          </Panel>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
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
        </div>

        <p className="fb-dim text-center text-xs">Firbo AI · © {new Date().getFullYear()}</p>
      </div>
    </div>
  );
}
