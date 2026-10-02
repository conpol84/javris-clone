import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { Panel } from '../components/command/Panel';
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
  const maxDay = Math.max(0.0001, ...daily.map(([, v]) => v));

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

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-4 px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="fb-eyebrow">{current?.organization.name}</div>
            <h1 className="mt-1 text-2xl font-semibold">{t('an.title')}</h1>
            <p className="fb-muted mt-1 text-sm">{t('an.sub')}</p>
          </div>
          <div role="tablist" className="flex gap-1.5">
            {RANGES.map((d) => (
              <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)} className="fb-chip cursor-pointer"
                style={days === d ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>
                {t('an.days', { count: d })}
              </button>
            ))}
          </div>
        </header>

        {!canSee ? (
          <Panel title={t('an.title')}><p className="fb-muted text-sm">{t('an.managersOnly')}</p></Panel>
        ) : error ? (
          <Panel title={t('an.title')}><p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('an.error')}</p></Panel>
        ) : rows === null ? (
          <p className="fb-dim text-sm">{t('common.loading')}</p>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[
                [t('an.cost'), fmt.currency(totals.cost)],
                [t('an.tokens'), fmt.number(totals.tokens)],
                [t('an.runs'), fmt.number(totals.runs)],
                [t('an.avg'), fmt.currency(totals.avg)],
              ].map(([label, value]) => (
                <div key={label} className="fb-glass p-4">
                  <div className="fb-eyebrow">{label}</div>
                  <div className="fb-grad-text mt-2 text-2xl font-bold tabular-nums">{value}</div>
                </div>
              ))}
            </section>

            <Panel title={t('an.daily')}>
              {rows.length === 0 ? (
                <p className="fb-dim text-sm">{t('an.noData')}</p>
              ) : (
                <div className="flex h-36 items-end gap-[3px]" role="img" aria-label={t('an.daily')}>
                  {daily.map(([d, v]) => (
                    <div key={d} className="flex h-full flex-1 items-end" title={`${fmt.date(d)} · ${fmt.currency(v)}`}>
                      <div className="w-full rounded-t" style={{ height: `${v ? Math.max(4, (v / maxDay) * 100) : 2}%`, background: v ? 'linear-gradient(180deg,var(--fb-accent),rgba(0, 245, 138,.25))' : 'rgba(255,255,255,.06)' }} />
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title={t('an.byAgent')}>
              {perAgent.length === 0 ? (
                <p className="fb-dim text-sm">{t('an.noData')}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="fb-table">
                    <thead>
                      <tr><th>{t('an.col.agent')}</th><th>{t('an.runs')}</th><th>{t('an.tokens')}</th><th>{t('an.cost')}</th></tr>
                    </thead>
                    <tbody>
                      {perAgent.map((p) => (
                        <tr key={p.id || 'none'}>
                          <td className="font-medium">
                            <span className="fb-dot me-2 inline-block" style={{ background: p.agent ? agentColor(p.agent.type, p.agent.slug) : 'var(--fb-dim)' }} />
                            {p.agent ? agentLabel(p.agent, i18n).name : t('unassigned')}
                          </td>
                          <td>{fmt.number(p.runs)}</td>
                          <td>{fmt.number(p.tokens)}</td>
                          <td>{fmt.currency(p.cost)}</td>
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
