import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Panel } from '../components/command/Panel';
import { NativeGatewayConsole } from '../components/gateway/NativeGatewayConsole';
import { ServerJarvisPanel } from '../components/admin/ServerJarvisPanel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { AdminError, loadAdminOverview, type AdminOverview } from '../lib/company/admin';
import '../styles/firbo.css';

const TABS = ['overview', 'companies', 'users', 'jarvis', 'console'] as const;
type Tab = (typeof TABS)[number];

/** One Firbo login. Both overview and native engine controls are server-authorized. */
export function AdminPage() {
  const { t, fmt } = useI18n();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '') ? params.get('tab') as Tab : 'overview';
  const [data, setData] = useState<AdminOverview | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'forbidden' | 'error'>('loading');

  useEffect(() => {
    let live = true;
    loadAdminOverview().then(value => {
      if (live) { setData(value); setState('ok'); }
    }).catch(error => {
      if (live) setState(error instanceof AdminError && error.code === 'forbidden' ? 'forbidden' : 'error');
    });
    return () => { live = false; };
  }, []);

  // Do not mount controls while permission checks are pending or failed.
  if (state !== 'ok' || !data) return <div className="fb-root h-full overflow-y-auto"><div className="mx-auto max-w-xl px-4 pt-20">
    <Panel title={t('adm.title')}><p className="fb-muted text-sm" role={state === 'loading' ? 'status' : 'alert'}>
      {state === 'loading' ? t('common.loading') : state === 'forbidden' ? t('adm.forbidden') : t('adm.error')}
    </p></Panel></div></div>;

  if (tab === 'console') return <NativeGatewayConsole />;

  const stat = (label: string, value: string) => <div key={label} className="fb-glass p-4">
    <div className="fb-eyebrow">{label}</div><div className="fb-grad-text mt-2 text-2xl font-bold tabular-nums">{value}</div>
  </div>;

  return <div className="fb-root flex h-full flex-col">
    <div className="mx-auto w-full max-w-[1300px] px-4 pb-3 pt-14 md:px-6 md:pt-6">
      <div className="fb-eyebrow">{t('adm.eyebrow')}</div><h1 className="mt-1 text-2xl font-semibold">{t('adm.title')}</h1><p className="fb-muted mt-1 text-sm">{t('adm.sub')}</p>
      <div role="tablist" className="mt-4 flex flex-wrap gap-2">{TABS.map(k => <button key={k} role="tab" aria-selected={tab === k}
        onClick={() => setParams({ tab: k }, { replace: true })} className="fb-chip cursor-pointer"
        style={tab === k ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>{t(`adm.tab.${k}` as TKey)}</button>)}</div>
    </div>
    <div className="mx-auto min-h-0 w-full max-w-[1300px] flex-1 space-y-4 overflow-y-auto px-4 pb-8 md:px-6">
      {tab === 'jarvis' ? <ServerJarvisPanel /> : tab === 'overview' ? <>
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {stat(t('adm.stat.companies'), fmt.number(data.totals.companies))}
          {stat(t('adm.stat.users'), fmt.number(data.totals.users))}
          {stat(t('adm.stat.agents'), fmt.number(data.totals.agents))}
          {stat(t('adm.stat.openTasks'), fmt.number(data.totals.open_tasks))}
          {stat(t('adm.stat.cost'), fmt.currency(data.totals.cost30d))}
          {stat(t('adm.stat.tokens'), fmt.number(data.totals.tokens30d))}
          {stat(t('adm.stat.runs'), fmt.number(data.totals.runs30d))}
        </section>
        <Panel title={t('adm.topSpenders')}><ol className="flex flex-col gap-2">{[...data.companies].sort((a, b) => b.cost30d - a.cost30d).slice(0, 5).map(c =>
          <li key={c.id} className="fb-row"><span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span><span className="fb-dim text-xs">{fmt.number(c.runs30d)} · {fmt.currency(c.cost30d)}</span></li>)}</ol></Panel>
      </> : tab === 'companies' ? <Panel title={t('adm.tab.companies')}><div className="overflow-x-auto"><table className="fb-table">
        <thead><tr><th>{t('adm.col.company')}</th><th>{t('adm.col.members')}</th><th>{t('adm.col.agents')}</th><th>{t('adm.col.tasks')}</th><th>{t('adm.col.runs')}</th><th>{t('adm.col.cost')}</th><th>{t('adm.col.created')}</th></tr></thead>
        <tbody>{data.companies.map(c => <tr key={c.id}><td className="font-medium">{c.name}{c.status !== 'active' && <span className="fb-chip ms-2">{c.status}</span>}</td>
          <td>{fmt.number(c.members)}</td><td>{fmt.number(c.agents)}</td><td>{fmt.number(c.open_tasks)}</td><td>{fmt.number(c.runs30d)}</td><td>{fmt.currency(c.cost30d)}</td><td>{fmt.date(c.created_at)}</td></tr>)}</tbody>
      </table></div></Panel> : <Panel title={t('adm.tab.users')}><div className="overflow-x-auto"><table className="fb-table">
        <thead><tr><th>{t('adm.col.email')}</th><th>{t('adm.col.created')}</th><th>{t('adm.col.lastSeen')}</th></tr></thead>
        <tbody>{data.users.map(u => <tr key={u.id}><td className="font-medium">{u.email}</td><td>{fmt.date(u.created_at)}</td><td>{u.last_sign_in_at ? fmt.dateTime(u.last_sign_in_at) : t('adm.never')}</td></tr>)}</tbody>
      </table></div></Panel>}
    </div>
  </div>;
}
