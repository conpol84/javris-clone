import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { CallsTab, FreeModelsTab, UsageTab } from '../components/gateway/GatewayExtras';
import { Panel, StatusDot } from '../components/command/Panel';
import { ProviderTopology } from '../components/command/ProviderTopology';
import { STRATEGY_INFO, useGateway } from '../lib/gateway';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import '../styles/firbo.css';

/** Full OmniRoute dashboard (providers, keys, routes): set VITE_OMNIROUTE_URL to show the shortcut. */
const GATEWAY_DASHBOARD = (import.meta.env.VITE_OMNIROUTE_URL as string | undefined) || '';

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="fb-glass p-4">
      <div className="fb-eyebrow">{label}</div>
      <div className="fb-grad-text mt-2 text-3xl font-bold tabular-nums">{value}</div>
      {hint && <div className="fb-dim mt-1 text-xs">{hint}</div>}
    </div>
  );
}

export function GatewayPage() {
  const { t, fmt: f } = useI18n();
  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '–' : f.number(n));
  const strategyText = (k: string) => (t(`strategy.${k}` as TKey) === `strategy.${k}` ? STRATEGY_INFO[k] ?? t('gw.combo.custom') : t(`strategy.${k}` as TKey));
  const gw = useGateway();
  const [tab, setTab] = useState<'overview' | 'usage' | 'calls' | 'free'>('overview');
  const data = gw.status === 'ready' ? gw.data : null;
  const online = !!data?.connected;

  const modelsByProvider = new Map(data?.models.providers.map((p) => [p.provider, p.models]));
  const stats = new Map((data?.stats ?? []).map((s) => [s.provider.toLowerCase(), s]));
  const requests = (data?.stats ?? []).reduce((sum, s) => sum + s.requests, 0);

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] space-y-4 px-4 pb-6 pt-14 md:px-6 md:pt-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="fb-eyebrow">{t('gw.eyebrow')}</div>
            <h1 className="mt-1 text-2xl font-semibold">{t('gw.title')}</h1>
            <p className="fb-muted mt-1 text-sm">{t('gw.sub')}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="fb-chip">
              <StatusDot tone={gw.status === 'loading' ? 'idle' : online ? 'ok' : 'err'} live={online} />
              {gw.status === 'loading' ? t('gw.status.checking') : gw.status === 'unreachable' ? t('gw.status.unreachable') : online ? t('gw.status.connected') : t('gw.status.offline')}
            </span>
            <button className="fb-btn fb-btn--ghost" style={{ height: 34, padding: '0 12px' }} onClick={gw.reload} aria-label={t('common.refresh')}>
              <RefreshCw size={14} />
            </button>
          </div>
        </header>


        <div className="flex flex-wrap gap-2" role="tablist">
          {(['overview', 'usage', 'calls', 'free'] as const).map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className="fb-chip cursor-pointer"
              style={tab === k ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>
              {t(`gw.tab.${k}` as TKey)}
            </button>
          ))}
        </div>

        {tab === 'usage' && <UsageTab />}
        {tab === 'calls' && <CallsTab />}
        {tab === 'free' && <FreeModelsTab />}
        {tab === 'overview' && (
          <>
        {gw.status === 'unreachable' && (
          <Panel title={t('gw.backendTitle')}>
            <p className="fb-muted text-sm">
              {t('gw.backendText', { reason: gw.reason === 'not_json' ? t('gw.reason.notJson') : gw.reason })}
            </p>
          </Panel>
        )}

        {data && !online && (
          <Panel title={t('gw.offlineTitle')}>
            <p className="fb-muted text-sm">
              {t('gw.offlineText', { host: data.host })}
            </p>
            <pre className="mt-3 overflow-x-auto rounded-xl p-3 text-xs" style={{ background: 'rgba(5,10,20,.8)', border: '1px solid var(--fb-border)' }}>
{`OMNIROUTE_HOST=http://localhost:20128
OMNIROUTE_MANAGEMENT_KEY=<API key with manage scope>`}
            </pre>
          </Panel>
        )}

        {data && online && Object.keys(data.errors).length > 0 && (
          <p className="fb-chip" style={{ color: 'var(--fb-warn)' }}>
            {t('gw.partial', { list: Object.entries(data.errors).map(([k, v]) => `${k} (${v})`).join(', ') })}
            {data.errors.providers === 'unauthorized' && ` ${t('gw.needKey')}`}
          </p>
        )}

        {GATEWAY_DASHBOARD && (
          <Panel title={t('gw.dashboardTitle')}>
            <p className="fb-muted text-sm">{t('gw.dashboardHint')}</p>
            <a className="fb-btn fb-btn--primary mt-3 inline-flex" href={GATEWAY_DASHBOARD} target="_blank" rel="noopener noreferrer">
              {t('gw.openDashboard')} →
            </a>
          </Panel>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label={t('gw.stat.providers')} value={data ? data.connections.length : '–'} />
          <Stat label={t('gw.stat.models')} value={data ? fmt(data.models.total) : '–'} />
          <Stat label={t('gw.stat.combos')} value={data ? data.combos.length : '–'} hint={t('gw.stat.combosHint')} />
          <Stat label={t('gw.stat.requests')} value={data ? fmt(requests) : '–'} />
        </section>

        <Panel title={t('gw.topology')} className="!p-2">
          <div className="h-[420px] md:h-[500px]">
            <ProviderTopology data={data} online={online} />
          </div>
        </Panel>

        <Panel title={t('gw.providers')}>
          {!data || data.connections.length === 0 ? (
            <p className="fb-dim text-sm">{online ? t('gw.providers.empty') : t('gw.providers.connectFirst')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="fb-table">
                <thead>
                  <tr>
                    {(['provider', 'accounts', 'healthy', 'limited', 'models', 'requests', 'success', 'latency', 'tokens'] as const).map((h) => (
                      <th key={h}>{t(`gw.col.${h}` as TKey)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.connections.map((c) => {
                    const s = stats.get(c.provider.toLowerCase());
                    return (
                      <tr key={c.provider}>
                        <td className="font-medium">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot tone={c.limited ? 'warn' : c.healthy ? 'ok' : 'idle'} />
                            {c.provider}
                          </span>
                        </td>
                        <td>{c.active}/{c.connections}</td>
                        <td>{c.healthy}</td>
                        <td style={{ color: c.limited ? 'var(--fb-warn)' : undefined }}>{c.limited}</td>
                        <td>{fmt(modelsByProvider.get(c.provider))}</td>
                        <td>{fmt(s?.requests)}</td>
                        <td>{s?.success_rate == null ? '–' : f.number(s.success_rate, { style: 'percent', maximumFractionDigits: 0 })}</td>
                        <td>{s?.avg_latency_ms == null ? '–' : `${f.number(s.avg_latency_ms)} ms`}</td>
                        <td>{s ? fmt(s.tokens_in + s.tokens_out) : '–'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title={t('gw.combos')}>
          {data && data.combos.length > 0 ? (
            <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {data.combos.map((c) => (
                <li key={c.name} className="fb-row fb-col gap-1">
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <span className="fb-chip">{c.strategy}</span>
                  </div>
                  <div className="fb-dim text-xs">
                    {t('gw.combo.steps', { count: c.steps })} · {strategyText(c.strategy)}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fb-dim text-sm">
              {online ? t('gw.combos.empty') : t('gw.combos.connectFirst')}
            </p>
          )}
        </Panel>

        <Panel title={t('gw.strategies')}>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Object.keys(STRATEGY_INFO).map((k) => (
              <li key={k} className="fb-row py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{k}</div>
                  <div className="fb-dim truncate text-xs">{strategyText(k)}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
          </>
        )}
      </div>
    </div>
  );
}
