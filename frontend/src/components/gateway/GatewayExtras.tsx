import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePlatformAdmin } from '../../lib/company/admin';
import { Panel, StatusDot } from '../command/Panel';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { listAgents, loadMonthlySpend } from '../../lib/company/data';
import { agentLabel } from '../../lib/company/labels';
import { agentColor } from '../../lib/company/status';
import type { AgentRow } from '../../lib/company/types';
import { gatewayPost, useGatewayData, type FreeModel, type GatewayCombo, type GatewayHealthRow, type GatewaySavings, type GatewayCall, type GatewayKey, type GatewayUsage, type QuotaProvider } from '../../lib/gateway';

const RANGES = ['1d', '7d', '30d', '90d'] as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="fb-glass p-4">
      <div className="fb-eyebrow">{label}</div>
      <div className="fb-grad-text mt-2 text-2xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

function reasonText(error: string, t: ReturnType<typeof useI18n>['t']): string {
  return error === 'not_json' ? t('gw.reason.notJson') : error === 'unauthorized' ? t('gw.needKey') : error;
}

/** What each AI employee has spent this month against its budget (Firbo's own data, from Supabase). */
function AgentSpend() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [spend, setSpend] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!orgId) return;
    let live = true;
    Promise.all([listAgents(orgId), loadMonthlySpend(orgId)])
      .then(([a, s]) => {
        if (live) {
          setAgents(a);
          setSpend(s);
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId]);
  const rows = agents.map((a) => ({ a, spent: spend[a.id] ?? 0 })).sort((x, y) => y.spent - x.spent);
  const total = rows.reduce((s, r) => s + r.spent, 0);
  return (
    <Panel title={t('gw.usage.agents')} right={<span className="fb-chip">{fmt.currency(total)}</span>}>
      {total === 0 ? (
        <p className="fb-dim text-sm">{t('gw.usage.agentsEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {rows
            .filter((r) => r.spent > 0 || r.a.monthly_budget_usd != null)
            .map(({ a, spent }) => {
              const budget = a.monthly_budget_usd;
              const pct = budget ? Math.min(100, (spent / budget) * 100) : total ? (spent / total) * 100 : 0;
              const color = agentColor(a.type, a.slug);
              return (
                <li key={a.id}>
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{agentLabel(a, i18n).name}</span>
                    <span className="fb-dim shrink-0 text-xs">
                      {budget != null ? t('gw.usage.of', { spent: fmt.currency(spent), budget: fmt.currency(budget) }) : fmt.currency(spent)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.06)' }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: budget && pct > 90 ? 'var(--fb-err)' : color }} />
                  </div>
                </li>
              );
            })}
        </ul>
      )}
    </Panel>
  );
}

export function UsageTab() {
  const { t, fmt } = useI18n();
  const [range, setRange] = useState<(typeof RANGES)[number]>('7d');
  const { data, error, loading } = useGatewayData<GatewayUsage>(`/v1/gateway/usage?range=${range}`, 30_000);
  const maxDaily = useMemo(() => Math.max(0.0001, ...(data?.daily ?? []).map((d) => d.cost || d.requests / 1000)), [data]);
  return (
    <div className="space-y-4">
      <AgentSpend />
      <Panel
        title={t('gw.usage.title')}
        right={
          <div role="tablist" className="flex gap-1.5">
            {RANGES.map((r) => (
              <button
                key={r}
                role="tab"
                aria-selected={range === r}
                onClick={() => setRange(r)}
                className="fb-chip cursor-pointer"
                style={range === r ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}
              >
                {t(`gw.range.${r}` as TKey)}
              </button>
            ))}
          </div>
        }
      >
        {error ? (
          <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
        ) : loading && !data ? (
          <p className="fb-dim text-sm">{t('common.loading')}</p>
        ) : !data?.available ? (
          <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
            {t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Stat label={t('gw.usage.requests')} value={fmt.number(data.requests)} />
              <Stat label={t('gw.usage.tokens')} value={fmt.number(data.tokens_in + data.tokens_out)} />
              <Stat label={t('gw.usage.cost')} value={fmt.currency(data.cost)} />
              <Stat label={t('gw.usage.success')} value={data.success_rate == null ? '–' : `${fmt.number(Math.round(data.success_rate * 100))}%`} />
              <Stat label={t('gw.usage.latency')} value={`${fmt.number(Math.round(data.avg_latency_ms))} ms`} />
              <Stat label={t('gw.usage.fallbacks')} value={fmt.number(data.fallbacks)} />
            </div>
            {data.daily.length > 0 && (
              <div className="mt-5">
                <div className="fb-eyebrow mb-2">{t('gw.usage.daily')}</div>
                <div className="flex h-28 items-end gap-1" role="img" aria-label={t('gw.usage.daily')}>
                  {data.daily.map((d) => (
                    <div key={d.date} className="flex h-full flex-1 items-end" title={`${d.date} · ${fmt.currency(d.cost)} · ${fmt.number(d.requests)}`}>
                      <div
                        className="w-full rounded-t"
                        style={{ height: `${Math.max(3, ((d.cost || d.requests / 1000) / maxDaily) * 100)}%`, background: 'linear-gradient(180deg,var(--fb-accent),rgba(0, 212, 255,.25))' }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-5 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="fb-eyebrow mb-2">{t('gw.usage.byModel')}</div>
                {data.models.length === 0 ? (
                  <p className="fb-dim text-sm">{t('gw.usage.none')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="fb-table">
                      <thead>
                        <tr><th>{t('gw.calls.model')}</th><th>{t('gw.col.requests')}</th><th>{t('gw.col.tokens')}</th><th>{t('gw.usage.cost')}</th></tr>
                      </thead>
                      <tbody>
                        {data.models.map((m) => (
                          <tr key={`${m.provider}/${m.model}`}>
                            <td className="font-medium">{m.model}</td><td>{fmt.number(m.requests)}</td><td>{fmt.number(m.tokens)}</td><td>{fmt.currency(m.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <div>
                <div className="fb-eyebrow mb-2">{t('gw.usage.byProvider')}</div>
                {data.providers.length === 0 ? (
                  <p className="fb-dim text-sm">{t('gw.usage.none')}</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="fb-table">
                      <thead>
                        <tr><th>{t('gw.col.provider')}</th><th>{t('gw.col.requests')}</th><th>{t('gw.col.tokens')}</th><th>{t('gw.usage.cost')}</th></tr>
                      </thead>
                      <tbody>
                        {data.providers.map((p) => (
                          <tr key={p.provider}>
                            <td className="font-medium">{p.provider}</td><td>{fmt.number(p.requests)}</td><td>{fmt.number(p.tokens)}</td><td>{fmt.currency(p.cost)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

export function CallsTab() {
  const { t, fmt } = useI18n();
  const { data, error, loading } = useGatewayData<{ available: boolean; error: string | null; calls: GatewayCall[] }>('/v1/gateway/calls?limit=40', 8_000);
  return (
    <Panel
      title={t('gw.tab.calls')}
      right={
        <span className="fb-chip">
          <StatusDot tone="ok" live /> {t('cc.live')}
        </span>
      }
    >
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : !data?.available ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
          {t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}
        </p>
      ) : data.calls.length === 0 ? (
        <p className="fb-dim text-sm">{t('gw.calls.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="fb-table">
            <thead>
              <tr><th>{t('gw.calls.time')}</th><th>{t('gw.col.provider')}</th><th>{t('gw.calls.model')}</th><th>{t('gw.calls.status')}</th><th>{t('gw.col.latency')}</th><th>{t('gw.col.tokens')}</th></tr>
            </thead>
            <tbody>
              {data.calls.map((c) => (
                <tr key={c.id || `${c.at}-${c.model}`}>
                  <td className="whitespace-nowrap">{c.at ? fmt.time(new Date(c.at)) : '–'}</td>
                  <td>{c.provider}</td>
                  <td className="font-medium">
                    {c.model}
                    {c.combo ? <span className="fb-chip ms-2">{c.combo}</span> : null}
                  </td>
                  <td style={{ color: c.active ? 'var(--fb-accent)' : c.failed ? 'var(--fb-err)' : 'var(--fb-ok)' }}>
                    {c.active ? t('gw.calls.live') : c.failed ? `${t('gw.calls.failed')} (${c.status})` : c.status}
                  </td>
                  <td>{c.duration_ms ? `${fmt.number(c.duration_ms)} ms` : '–'}</td>
                  <td>{fmt.number(c.tokens_in + c.tokens_out)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function FreeModelsTab() {
  const { t, fmt } = useI18n();
  const { data, error, loading } = useGatewayData<{ available: boolean; error: string | null; models: FreeModel[] }>('/v1/gateway/free-models');
  const [q, setQ] = useState('');
  const shown = (data?.models ?? [])
    .filter((m) => `${m.provider} ${m.name} ${m.model}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 80);
  return (
    <Panel title={t('gw.free.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.free.hint')}</p>
      <input className="fb-input mb-3" placeholder={t('gw.free.search')} aria-label={t('gw.free.search')} value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : shown.length === 0 ? (
        <p className="fb-dim text-sm">{t('gw.free.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="fb-table">
            <thead>
              <tr><th>{t('gw.col.provider')}</th><th>{t('gw.free.model')}</th><th>{t('gw.free.allowance')}</th></tr>
            </thead>
            <tbody>
              {shown.map((m) => (
                <tr key={`${m.provider}/${m.model}`}>
                  <td className="font-medium">{m.provider}</td>
                  <td>{m.name}</td>
                  <td>{m.monthly_tokens == null ? m.free_type || '–' : `${fmt.number(m.monthly_tokens)} ${t('gw.col.tokens')}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function QuotaTab() {
  const { t, fmt } = useI18n();
  const { data, error, loading } = useGatewayData<{ available: boolean; error: string | null; providers: QuotaProvider[] }>('/v1/gateway/quota', 60_000);
  return (
    <Panel title={t('gw.quota.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.quota.hint')}</p>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : !data?.available ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
          {t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}
        </p>
      ) : data.providers.length === 0 ? (
        <p className="fb-dim text-sm">{t('gw.quota.empty')}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.providers.map((p) => (
            <li key={`${p.provider}-${p.name}`} className="fb-row flex-col items-stretch gap-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-semibold">{p.name || p.provider}</span>
                {p.plan && <span className="fb-chip">{p.plan}</span>}
              </div>
              {p.windows.map((w) => {
                const left = w.unlimited ? 100 : w.remaining_pct;
                return (
                  <div key={w.name}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="fb-dim truncate">{w.name}</span>
                      <span>{w.unlimited ? t('gw.quota.unlimited') : left == null ? '–' : t('gw.quota.left', { pct: fmt.number(Math.round(left)) })}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.06)' }}>
                      <div className="h-full rounded-full" style={{ width: `${left ?? 0}%`, background: left != null && left < 15 ? 'var(--fb-err)' : left != null && left < 40 ? 'var(--fb-warn)' : 'var(--fb-ok)' }} />
                    </div>
                    {w.reset_at && <div className="fb-dim mt-0.5 text-[11px]">{t('gw.quota.resets', { when: fmt.dateTime(w.reset_at) })}</div>}
                  </div>
                );
              })}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function KeysTab() {
  const { t, fmt } = useI18n();
  const { data, error, loading } = useGatewayData<{ available: boolean; error: string | null; keys: GatewayKey[] }>('/v1/gateway/keys');
  return (
    <Panel title={t('gw.keys.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.keys.hint')}</p>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : !data?.available ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
          {t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}
        </p>
      ) : data.keys.length === 0 ? (
        <p className="fb-dim text-sm">{t('gw.keys.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="fb-table">
            <thead>
              <tr><th>{t('gw.keys.name')}</th><th>{t('gw.calls.status')}</th><th>{t('gw.keys.perDay')}</th><th>{t('gw.keys.perMin')}</th><th>{t('gw.keys.created')}</th></tr>
            </thead>
            <tbody>
              {data.keys.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td style={{ color: k.active ? 'var(--fb-ok)' : 'var(--fb-err)' }}>{k.active ? t('gw.keys.active') : t('gw.keys.disabled')}</td>
                  <td>{k.max_per_day ? fmt.number(k.max_per_day) : t('gw.keys.noLimit')}</td>
                  <td>{k.max_per_minute ? fmt.number(k.max_per_minute) : t('gw.keys.noLimit')}</td>
                  <td>{k.created_at ? fmt.dateTime(k.created_at) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}


const HEALTH_TONE = { healthy: 'var(--fb-ok)', degraded: 'var(--fb-warn)', down: 'var(--fb-err)', idle: 'var(--fb-dim)' } as const;

export function HealthTab() {
  const { t, fmt } = useI18n();
  const { data, error, loading } = useGatewayData<{ available: boolean; error: string | null; providers: GatewayHealthRow[] }>('/v1/gateway/health', 20_000);
  return (
    <Panel title={t('gw.health.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.health.hint')}</p>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : !data?.available ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}</p>
      ) : data.providers.length === 0 ? (
        <p className="fb-dim text-sm">{t('gw.health.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="fb-table">
            <thead>
              <tr><th>{t('gw.health.provider')}</th><th>{t('gw.calls.status')}</th><th>{t('gw.health.requests')}</th><th>{t('gw.health.success')}</th><th>{t('gw.health.latency')}</th><th>{t('gw.health.lastError')}</th></tr>
            </thead>
            <tbody>
              {data.providers.map((p) => (
                <tr key={p.provider}>
                  <td className="font-medium">{p.provider}</td>
                  <td style={{ color: HEALTH_TONE[p.status] }}><StatusDot tone={p.status === 'healthy' ? 'ok' : p.status === 'idle' ? 'idle' : p.status === 'degraded' ? 'warn' : 'err'} live={p.status === 'healthy'} /> {t(`gw.health.s.${p.status}` as TKey)}</td>
                  <td>{fmt.number(p.requests)}</td>
                  <td>{p.success_rate == null ? '–' : `${p.success_rate}%`}</td>
                  <td>{p.avg_latency_ms == null ? '–' : `${fmt.number(Math.round(p.avg_latency_ms))} ms`}</td>
                  <td>{p.last_error_at ? fmt.dateTime(p.last_error_at) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function RoutingTab() {
  const { t } = useI18n();
  const { data, error, loading } = useGatewayData<{ available: boolean; error: string | null; combos: GatewayCombo[] }>('/v1/gateway/routing');
  return (
    <Panel title={t('gw.routing.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.routing.hint')}</p>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : !data?.available ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}</p>
      ) : data.combos.length === 0 ? (
        <p className="fb-dim text-sm">{t('gw.routing.empty')}</p>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {data.combos.map((c) => (
            <li key={c.name} className="fb-row fb-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{c.name}</span>
                <span className="fb-chip">{c.strategy}</span>
                {!c.enabled && <span className="fb-chip" style={{ color: 'var(--fb-warn)' }}>{t('gw.keys.disabled')}</span>}
              </div>
              <ol className="fb-muted list-decimal ps-5 text-xs">
                {c.models.map((m, i) => (
                  <li key={`${m}-${i}`}>{m}</li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
      <p className="fb-dim mt-3 text-xs">{t('gw.routing.edit')}</p>
    </Panel>
  );
}

export function SavingsTab() {
  const { t, fmt } = useI18n();
  const isAdmin = usePlatformAdmin();
  const { data, error, loading, reload } = useGatewayData<GatewaySavings>('/v1/gateway/savings');
  const [busy, setBusy] = useState(false);
  const save = async (patch: { enabled?: boolean; mode?: string }) => {
    setBusy(true);
    try {
      await gatewayPost('/v1/gateway/savings', patch);
      toast.success(t('gw.savings.saved'));
      reload();
    } catch (err) {
      console.error(err);
      toast.error(t('gw.savings.saveError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t('gw.savings.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.savings.hint')}</p>
      {error ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{reasonText(error, t)}</p>
      ) : loading && !data ? (
        <p className="fb-dim text-sm">{t('common.loading')}</p>
      ) : !data?.available ? (
        <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('gw.usage.unavailable')} {data?.error ? reasonText(data.error, t) : ''}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="fb-row fb-col gap-3 p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold">{t('gw.savings.compression')}</span>
              <span className="fb-chip" style={{ color: data.compression.enabled ? 'var(--fb-ok)' : 'var(--fb-dim)' }}>{data.compression.enabled ? t('gw.savings.on') : t('gw.savings.off')}</span>
            </div>
            <label className="fb-muted flex items-center gap-2 text-xs">
              {t('gw.savings.mode')}
              <select className="fb-input" style={{ width: 'auto' }} disabled={!isAdmin || busy} value={data.compression.mode} onChange={(e) => void save({ mode: e.target.value })}>
                {data.modes.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            {isAdmin ? (
              <button className="fb-btn fb-btn--primary self-start" disabled={busy} onClick={() => void save({ enabled: !data.compression.enabled })}>
                {data.compression.enabled ? t('gw.savings.turnOff') : t('gw.savings.turnOn')}
              </button>
            ) : (
              <p className="fb-dim text-xs">{t('gw.savings.adminOnly')}</p>
            )}
          </div>
          <div className="fb-row fb-col gap-2 p-4">
            <span className="text-sm font-semibold">{t('gw.savings.cache')}</span>
            {Object.keys(data.cache).length === 0 ? (
              <p className="fb-dim text-xs">{t('gw.savings.noCache')}</p>
            ) : (
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {Object.entries(data.cache).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="fb-dim">{k}</dt>
                    <dd className="text-end tabular-nums">{fmt.number(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function PlaygroundTab() {
  const { t, fmt } = useI18n();
  const [model, setModel] = useState('auto');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ model: string; reply: string; tokens_in: number; tokens_out: number; latency_ms: number } | null>(null);
  const send = async () => {
    if (!message.trim() || busy) return;
    setBusy(true);
    try {
      setOut(await gatewayPost('/v1/gateway/playground', { model, message }));
    } catch (err) {
      const status = (err as { status?: number }).status;
      toast.error(t(status === 403 ? 'gw.play.adminsOnly' : status === 429 ? 'gw.play.rate' : 'gw.play.error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title={t('gw.play.title')}>
      <p className="fb-muted mb-3 text-sm">{t('gw.play.hint')}</p>
      <div className="fb-col gap-3">
        <label className="block text-xs">
          <span className="fb-dim">{t('coding.model')}</span>
          <input className="fb-input mt-1" value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
        </label>
        <textarea className="fb-input" rows={3} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('gw.play.placeholder')} aria-label={t('gw.play.placeholder')} />
        <button className="fb-btn fb-btn--primary self-start" disabled={busy || !message.trim()} onClick={() => void send()}>
          {busy ? t('common.loading') : t('gw.play.send')}
        </button>
        {out && (
          <div className="fb-row fb-col gap-2 p-3">
            <p className="whitespace-pre-wrap text-sm">{out.reply}</p>
            <p className="fb-dim text-xs">{out.model} · {fmt.number(out.tokens_in)} → {fmt.number(out.tokens_out)} tokens · {fmt.number(out.latency_ms)} ms</p>
          </div>
        )}
      </div>
    </Panel>
  );
}
