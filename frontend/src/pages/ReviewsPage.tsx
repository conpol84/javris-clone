import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ReviewScene } from '../components/scenes/ReviewScene';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents, listTasks, loadDecisionStats, loadMonthlySpend, updateAgent } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { reviewAgents, type AgentReview, type Verdict } from '../lib/company/reviews';
import { agentColor } from '../lib/company/status';
import { MANAGER_ROLES, type AgentRow, type Autonomy, type TaskRow } from '../lib/company/types';
import '../styles/firbo.css';

const NEXT: Partial<Record<Autonomy, Autonomy>> = { suggest: 'approval', approval: 'notify' };
const TONE: Record<Verdict, string> = { promote: '#34d399', steady: '#22d3ee', coach: '#fbbf24', idle: '#64748b' };

/** Performance reviews: a transparent score per AI employee and a promotion recommendation. */
export function ReviewsPage() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [decisions, setDecisions] = useState<Record<string, { approved: number; rejected: number }>>({});
  const [spend, setSpend] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [a, tk, d, sp] = await Promise.all([
        listAgents(orgId),
        listTasks(orgId),
        loadDecisionStats(orgId),
        canManage ? loadMonthlySpend(orgId) : Promise.resolve({} as Record<string, number>),
      ]);
      setAgents(a);
      setTasks(tk);
      setDecisions(d);
      setSpend(sp);
    } catch (err) {
      console.error(err);
      toast.error(t('chat.loadError'));
    } finally {
      setLoaded(true);
    }
  }, [orgId, canManage, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviews = useMemo(() => reviewAgents({ agents, tasks, decisions, spend }), [agents, tasks, decisions, spend]);
  const byId = useMemo(() => new Map(reviews.map((r) => [r.agentId, r])), [reviews]);
  const ranked = useMemo(() => [...agents].sort((a, b) => (byId.get(b.id)?.score ?? -1) - (byId.get(a.id)?.score ?? -1)), [agents, byId]);
  const towers = ranked.map((a) => ({ id: a.id, name: agentLabel(a, i18n).name, score: byId.get(a.id)?.score ?? null, color: agentColor(a.type, a.slug) }));

  const promote = async (a: AgentRow) => {
    const next = NEXT[a.autonomy];
    if (!next) return;
    try {
      await updateAgent(a.id, { autonomy: next });
      toast.success(t('drawer.autonomyToast', { agent: agentLabel(a, i18n).name, level: t(`autonomy.${next}.label` as TKey) }));
      void load();
    } catch (err) {
      console.error(err);
      toast.error(t('drawer.saveError'));
    }
  };

  const row = (a: AgentRow, r: AgentReview) => {
    const name = agentLabel(a, i18n).name;
    return (
      <li key={a.id}>
        <div
          role="button"
          tabIndex={0}
          aria-pressed={selected === a.id}
          onClick={() => setSelected(a.id)}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setSelected(a.id)}
          className="fb-row fb-col cursor-pointer gap-2 p-3"
          style={selected === a.id ? { borderColor: 'var(--fb-border-strong)' } : undefined}
        >
          <div className="flex items-center gap-3">
            <span className="fb-dot" style={{ background: agentColor(a.type, a.slug), boxShadow: `0 0 10px ${agentColor(a.type, a.slug)}` }} />
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{name}</span>
            <span className="text-lg font-semibold tabular-nums" style={{ color: TONE[r.verdict] }}>{r.score ?? '–'}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="fb-chip" style={{ color: TONE[r.verdict], borderColor: TONE[r.verdict] }}>{t(`rev.v.${r.verdict}` as TKey)}</span>
            <span className="fb-dim">{t('rev.stats', { done: r.done, failed: r.failed, ok: r.approved, no: r.rejected })}</span>
            {canManage && <span className="fb-dim">{fmt.currency(r.cost)}</span>}
          </div>
          {r.verdict === 'promote' && canManage && NEXT[a.autonomy] && (
            <button className="fb-btn fb-btn--primary" style={{ height: 30 }} onClick={(e) => (e.stopPropagation(), void promote(a))}>
              {t('rev.promote', { level: t(`autonomy.${NEXT[a.autonomy]}.label` as TKey) })}
            </button>
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="fb-root fb-col gap-4 p-4 lg:p-6" style={{ minHeight: '100%' }}>
      <header>
        <div className="fb-eyebrow">{t('rev.eyebrow')}</div>
        <h1 className="fb-grad-text text-2xl font-semibold">{t('rev.title')}</h1>
        <p className="fb-muted mt-1 max-w-2xl text-sm">{t('rev.intro')}</p>
      </header>
      {loaded && agents.length === 0 ? (
        <div className="fb-glass p-6 text-sm">{t('rev.none')}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="fb-glass relative overflow-hidden" style={{ minHeight: 420 }}>
            <div className="absolute inset-0">
              <ReviewScene towers={towers} selected={selected} onSelect={setSelected} labels={{ noWebgl: t('office.noWebgl') }} />
            </div>
          </section>
          <section className="fb-glass fb-col gap-3 p-4">
            <p className="fb-dim text-xs">{t('rev.formula')}</p>
            <ul className="fb-col gap-2 overflow-y-auto" style={{ maxHeight: 460 }}>
              {ranked.map((a) => row(a, byId.get(a.id)!))}
            </ul>
          </section>
        </div>
      )}
    </div>
  );
}
