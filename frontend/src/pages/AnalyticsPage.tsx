import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Panel } from '../components/command/Panel';
import { AreaChart, Avatar, Donut, PageHeader, Segmented, Stat } from '../components/ui/kit';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents, loadUsageSince, type UsageRow } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { agentColor } from '../lib/company/status';
import { MANAGER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

const RANGES = [7, 30, 90] as const;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

/** Cost, tokens and runs per day and per AI employee. */
export function AnalyticsPage() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canSee = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [rows, setRows] = useState<UsageRow[] | null>(null);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!orgId || !canSee) return;
    let live = true;
    setRows(null);
    setError(false);
    Promise.all([loadUsageSince(orgId, days), listAgents(orgId)])
      .then(([r, a]) => {
        if (live) {
          setRows(r);
          setAgents(a);
        }
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [orgId, days, canSee]);

  const totals = useMemo(() => {
    const r = rows ?? [];
    const cost = r.reduce((n, x) => n + x.cost_usd, 0);
    const tokens = r.reduce((n, x) => n + x.input_tokens + x.output_tokens, 0);
    return { cost, tokens, runs: r.length, avg: r.length ? cost / r.length : 0 };
  }, [rows]);

  const daily = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) map.set(dayKey(new Date(Date.now() - i * 86_400_000).toISOString()), 0);
    for (const x of rows ?? []) {
      const k = dayKey(x.created_at);
      if (map.has(k)) map.set(k, (map.get(k) ?? 0) + x.cost_usd);
    }
    return [...map.entries()];
  }, [rows, days]);
  const perAgent = useMemo(() => {
    const map = new Map<string, { runs: number; tokens: number; cost: number }>();
    for (const x of rows ?? []) {
      const k = x.agent_id ?? '';
      const e = map.get(k) ?? { runs: 0, tokens: 0, cost: 0 };
      e.runs += 1;
      e.tokens += x.input_tokens + x.output_tokens;
      e.cost += x.cost_usd;
      map.set(k, e);
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, agent: agents.find((a) => a.id === id), ...v }))
      .sort((a, b) => b.cost - a.cost);
  }, [rows, agents]);

  const series = useMemo(() => {
    const cost = new Map<string, number>(), tokens = new Map<string, number>(), runs = new Map<string, number>();
    for (let i = days - 1; i >= 0; i--) {
      const k = dayKey(new Date(Date.now() - i * 86_400_000).toISOString());
      cost.set(k, 0); tokens.set(k, 0); runs.set(k, 0);
    }
    for (const x of rows ?? []) {
      const k = dayKey(x.created_at);
      if (!cost.has(k)) continue;
      cost.set(k, (cost.get(k) ?? 0) + x.cost_usd);
      tokens.set(k, (tokens.get(k) ?? 0) + x.input_tokens + x.output_tokens);
      runs.set(k, (runs.get(k) ?? 0) + 1);
    }
    return { cost: [...cost.values()], tokens: [...tokens.values()], runs: [...runs.values()] };
  }, [rows, days]);
  /** Second half of the period against the first half. */
  const trend = (v: number[]) => {
    const h = Math.floor(v.length / 2);
    const a = v.slice(0, h).reduce((n, x) => n + x, 0);
    const b = v.slice(h).reduce((n, x) => n + x, 0);
    if (!a) return undefined;
    const pct = Math.round(((b - a) / a) * 100);
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, good: pct <= 0 };
  };


  const shareColor = (p: (typeof perAgent)[number]) => (p.agent ? agentColor(p.agent.type, p.agent.slug) : '#64748b');
  const top = perAgent.slice(0, 5);
  const rest = perAgent.slice(5).reduce((n, p) => n + p.cost, 0);
  const donut = [...top.map((p) => ({ value: p.cost, color: shareColor(p) })), ...(rest > 0 ? [{ value: rest, color: '#475569' }] : [])];
  const maxAgentCost = Math.max(0.0001, ...perAgent.map((p) => p.cost));
  const range: [string, string] = [fmt.date(daily[0]?.[0] ?? ''), fmt.date(daily[daily.length - 1]?.[0] ?? '')];

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="fb-wide mx-auto space-y-4 px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader
          eyebrow={current?.organization.name}
          title={t('an.title')}
          sub={t('an.sub')}
          right={<Segmented value={String(days) as '7' | '30' | '90'} onChange={(v) => setDays(Number(v) as (typeof RANGES)[number])} options={RANGES.map((d) => ({ id: String(d) as '7' | '30' | '90', label: t('an.days', { count: d }) }))} />}
        />

        {!canSee ? (
          <Panel title={t('an.title')}><p className="fb-muted text-sm">{t('an.managersOnly')}</p></Panel>
        ) : error ? (
          <Panel title={t('an.title')}><p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('an.error')}</p></Panel>
        ) : rows === null ? (
          <p className="fb-dim text-sm">{t('common.loading')}</p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label={t('an.cost')} value={fmt.currency(totals.cost)} spark={series.cost} delta={trend(series.cost)} color="#22d3ee" />
              <Stat label={t('an.tokens')} value={fmt.number(totals.tokens)} spark={series.tokens} delta={trend(series.tokens)} color="#a78bfa" />
              <Stat label={t('an.runs')} value={fmt.number(totals.runs)} spark={series.runs} delta={trend(series.runs)} color="#34d399" />
              <Stat label={t('an.avg')} value={fmt.currency(totals.avg)} color="#fbbf24" />
            </section>

            <div className="grid gap-4 lg:grid-cols-[1.7fr_1fr]">
              <Panel title={t('an.daily')}>
                {rows.length === 0 ? <p className="fb-dim text-sm">{t('an.noData')}</p> : <AreaChart values={series.cost} labels={range} format={(v) => fmt.currency(v)} />}
              </Panel>
              <Panel title={t('an.byAgent')}>
                {perAgent.length === 0 ? (
                  <p className="fb-dim text-sm">{t('an.noData')}</p>
                ) : (
                  <div className="fb-col items-center gap-4">
                    <Donut parts={donut} center={fmt.currency(totals.cost)} sub={t('an.cost')} />
                    <ul className="w-full space-y-1.5">
                      {top.map((p) => (
                        <li key={p.id || 'none'} className="flex items-center gap-2 text-xs">
                          <span className="fb-dot" style={{ background: shareColor(p) }} />
                          <span className="min-w-0 flex-1 truncate">{p.agent ? agentLabel(p.agent, i18n).name : t('unassigned')}</span>
                          <span className="fb-dim tabular-nums">{Math.round((p.cost / (totals.cost || 1)) * 100)}%</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Panel>
            </div>

            <Panel title={t('an.byAgent')}>
              {perAgent.length === 0 ? (
                <p className="fb-dim text-sm">{t('an.noData')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="fb-table">
                    <thead>
                      <tr><th>{t('an.col.agent')}</th><th>{t('an.runs')}</th><th>{t('an.tokens')}</th><th style={{ width: '32%' }}>{t('an.cost')}</th></tr>
                    </thead>
                    <tbody>
                      {perAgent.map((p) => (
                        <tr key={p.id || 'none'}>
                          <td className="font-medium">
                            <span className="inline-flex items-center gap-2.5">
                              <Avatar name={p.agent ? agentLabel(p.agent, i18n).name : '?'} color={shareColor(p)} size={26} />
                              {p.agent ? agentLabel(p.agent, i18n).name : t('unassigned')}
                            </span>
                          </td>
                          <td className="tabular-nums">{fmt.number(p.runs)}</td>
                          <td className="tabular-nums">{fmt.number(p.tokens)}</td>
                          <td>
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 overflow-hidden rounded-full" style={{ background: 'rgba(148,180,220,.1)' }}>
                                <div className="h-full rounded-full" style={{ width: `${(p.cost / maxAgentCost) * 100}%`, background: shareColor(p) }} />
                              </div>
                              <span className="w-14 text-end tabular-nums">{fmt.currency(p.cost)}</span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </>
        )}
      </div>
    </div>
  );
}
