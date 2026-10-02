import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Panel } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { AdminError, loadAdminOverview, usePlatformAdmin, type AdminOverview } from '../lib/company/admin';
import '../styles/firbo.css';

const CONSOLE_URL = (import.meta.env.VITE_OMNIROUTE_URL as string | undefined) || 'https://gateway.firboai.app';
const TABS = ['overview', 'companies', 'users', 'console'] as const;
type Tab = (typeof TABS)[number];

/** Firbo platform administration. Everything here is checked on the server; the page only renders for platform admins. */
export function AdminPage() {
  const { t, fmt } = useI18n();
  const isAdmin = usePlatformAdmin();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'overview';
  const [data, setData] = useState<AdminOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');
  const [frameKey, setFrameKey] = useState(0);

  useEffect(() => {
    let live = true;
    loadAdminOverview()
      .then((d) => {
        if (live) {
          setData(d);
          setState('ok');
        }
      })
      .catch((err) => live && setState(err instanceof AdminError && err.code === 'forbidden' ? 'forbidden' : 'error'));
    return () => {
      live = false;
    };
  }, []);

  if (state === 'forbidden' || (!isAdmin && state !== 'loading' && state !== 'ok')) {
    return (
      <div className="fb-root h-full overflow-y-auto">
        <div className="mx-auto max-w-xl px-4 pt-20">
          <Panel title={t('adm.title')}>
            <p className="fb-muted text-sm">{t('adm.forbidden')}</p>
          </Panel>
        </div>
      </div>
    );
  }

  const stat = (label: string, value: string) => (
    <div key={label} className="fb-glass p-4">
      <div className="fb-eyebrow">{label}</div>
      <div className="fb-grad-text mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );

  return (
    <div className="fb-root flex h-full flex-col">
      <div className="mx-auto w-full max-w-[1300px] px-4 pb-3 pt-14 md:px-6 md:pt-6">
        <div className="fb-eyebrow">{t('adm.eyebrow')}</div>
        <h1 className="mt-1 text-2xl font-semibold">{t('adm.title')}</h1>
        <p className="fb-muted mt-1 text-sm">{t('adm.sub')}</p>
        <div role="tablist" className="mt-4 flex flex-wrap gap-2">
          {TABS.map((k) => (
            <button
              key={k}
              role="tab"
              aria-selected={tab === k}
              onClick={() => setParams({ tab: k }, { replace: true })}
              className="fb-chip cursor-pointer"
              style={tab === k ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}
            >
              {t(`adm.tab.${k}` as TKey)}
            </button>
          ))}
        </div>
      </div>

      {tab === 'console' ? (
        <div className="mx-auto flex min-h-0 w-full max-w-[1300px] flex-1 flex-col px-4 pb-4 md:px-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="fb-dim text-xs">{t('adm.console.hint')}</p>
            <button className="fb-btn fb-btn--ghost" style={{ height: 30, padding: '0 12px', fontSize: 12 }} onClick={() => setFrameKey((k) => k + 1)}>
              {t('adm.console.reload')}
            </button>
          </div>
          <iframe
            key={frameKey}
            title={t('adm.tab.console')}
            src={CONSOLE_URL}
            className="min-h-[520px] w-full flex-1 rounded-xl"
            style={{ border: '1px solid var(--fb-border)', background: '#0b0f1a' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads allow-modals"
            referrerPolicy="no-referrer"
          />
        </div>
      ) : (
        <div className="mx-auto min-h-0 w-full max-w-[1300px] flex-1 space-y-4 overflow-y-auto px-4 pb-8 md:px-6">
          {state === 'loading' ? (
            <p className="fb-dim text-sm">{t('common.loading')}</p>
          ) : state === 'error' || !data ? (
            <Panel title={t('adm.title')}><p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('adm.error')}</p></Panel>
          ) : tab === 'overview' ? (
            <>
              <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {stat(t('adm.stat.companies'), fmt.number(data.totals.companies))}
                {stat(t('adm.stat.users'), fmt.number(data.totals.users))}
                {stat(t('adm.stat.agents'), fmt.number(data.totals.agents))}
                {stat(t('adm.stat.openTasks'), fmt.number(data.totals.open_tasks))}
                {stat(t('adm.stat.cost'), fmt.currency(data.totals.cost30d))}
                {stat(t('adm.stat.tokens'), fmt.number(data.totals.tokens30d))}
                {stat(t('adm.stat.runs'), fmt.number(data.totals.runs30d))}
              </section>
              <Panel title={t('adm.topSpenders')}>
                <ol className="flex flex-col gap-2">
                  {[...data.companies].sort((a, b) => b.cost30d - a.cost30d).slice(0, 5).map((c) => (
                    <li key={c.id} className="fb-row">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                      <span className="fb-dim text-xs">{fmt.number(c.runs30d)} · {fmt.currency(c.cost30d)}</span>
                    </li>
                  ))}
                </ol>
              </Panel>
            </>
          ) : tab === 'companies' ? (
            <Panel title={t('adm.tab.companies')}>
              <div className="overflow-x-auto">
                <table className="fb-table">
                  <thead>
                    <tr><th>{t('adm.col.company')}</th><th>{t('adm.col.members')}</th><th>{t('adm.col.agents')}</th><th>{t('adm.col.tasks')}</th><th>{t('adm.col.runs')}</th><th>{t('adm.col.cost')}</th><th>{t('adm.col.created')}</th></tr>
                  </thead>
                  <tbody>
                    {data.companies.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.name}{c.status !== 'active' && <span className="fb-chip ms-2">{c.status}</span>}</td>
                        <td>{fmt.number(c.members)}</td><td>{fmt.number(c.agents)}</td><td>{fmt.number(c.open_tasks)}</td><td>{fmt.number(c.runs30d)}</td><td>{fmt.currency(c.cost30d)}</td><td>{fmt.date(c.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          ) : (
            <Panel title={t('adm.tab.users')}>
              <div className="overflow-x-auto">
                <table className="fb-table">
                  <thead>
                    <tr><th>{t('adm.col.email')}</th><th>{t('adm.col.created')}</th><th>{t('adm.col.lastSeen')}</th></tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td className="font-medium">{u.email}</td>
                        <td>{fmt.date(u.created_at)}</td>
                        <td>{u.last_sign_in_at ? fmt.dateTime(u.last_sign_in_at) : t('adm.never')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
