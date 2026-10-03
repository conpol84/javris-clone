import { Avatar, PageHeader, Pill, Segmented } from '../components/ui/kit';
import { useEffect, useMemo, useState } from 'react';
import { Crown, Lock, Search, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { HireDialog } from '../components/team/HireDialog';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { categoryLabel } from '../lib/company/labels';
import { loadPlanUsage, type PlanUsage } from '../lib/company/billing';
import { AGENT_TEMPLATES, isPremium, TEMPLATE_CATEGORIES, type AgentTemplate } from '../lib/company/templates';
import { MANAGER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

/** Browse every AI employee you can hire, with search and categories. */
export function StorePage() {
  const i18n = useI18n();
  const { t } = i18n;
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canHire = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [cat, setCat] = useState('All');
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<AgentTemplate | null>(null);
  const [version, setVersion] = useState(0);
  const [plan, setPlan] = useState<PlanUsage | null>(null);
  const [tier, setTier] = useState<'all' | 'starter' | 'pro'>('all');

  useEffect(() => {
    if (!orgId) return;
    listAgents(orgId).then(setAgents).catch(() => toast.error(t('chat.loadError')));
  }, [orgId, version, t]);

  useEffect(() => {
    if (!orgId) return;
    loadPlanUsage(orgId).then(setPlan).catch(() => undefined);
  }, [orgId, version]);
  const isFree = (plan?.plan.id ?? 'free') === 'free';
  const limit = plan?.plan?.limits?.agents ?? 0;
  const used = plan?.usage?.agents ?? agents.length;
  const full = !!plan && used >= limit;

  const hired = (tpl: AgentTemplate) => agents.filter((a) => a.slug === tpl.slug || a.slug.startsWith(`${tpl.slug}-`)).length;
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return AGENT_TEMPLATES.filter((x) => {
      if (cat !== 'All' && x.category !== cat) return false;
      if (tier === 'starter' && isPremium(x.slug)) return false;
      if (tier === 'pro' && !isPremium(x.slug)) return false;
      if (!needle) return true;
      const text = `${t(`tpl.${x.slug}.name` as TKey)} ${t(`tpl.${x.slug}.tagline` as TKey)} ${x.tools.map((k) => k.tool).join(' ')}`.toLowerCase();
      return text.includes(needle);
    });
  }, [cat, q, tier, t]);

  return (
    <div className="fb-root fb-col gap-4 p-4 lg:p-6" style={{ minHeight: '100%' }}>
      <PageHeader eyebrow={t('store.eyebrow')} title={t('store.title')} sub={t('store.intro', { n: AGENT_TEMPLATES.length })} right={<Segmented value={tier} onChange={setTier} label={t('store.tier')} options={(['all', 'starter', 'pro'] as const).map((k) => ({ id: k, label: t(`store.tier.${k}` as TKey) }))} />} />
      {plan && (
        <section className="fb-glass flex flex-wrap items-center gap-4 p-4" aria-label={t('store.plan')}>
          <span className="grid h-12 w-12 place-items-center rounded-2xl" style={{ background: 'rgba(0,212,255,.12)', border: '1px solid var(--fb-border-strong)' }}><Crown size={22} style={{ color: 'var(--fb-accent)' }} /></span>
          <div className="min-w-[180px] flex-1">
            <div className="fb-eyebrow">{t('store.plan')}</div>
            <div className="text-lg font-semibold">{plan.plan.name}</div>
            <div className="fb-dim text-xs">{t('store.slots', { used, total: limit })}</div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%`, background: full ? 'var(--fb-warn)' : 'var(--fb-accent)' }} />
            </div>
          </div>
          <p className="fb-muted hidden max-w-xs text-xs md:block">{t('store.ladder')}</p>
          {(isFree || full) && (
            <Link to="/billing" className="fb-btn fb-btn--primary"><Sparkles size={14} /> {t('store.upgrade')}</Link>
          )}
        </section>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <label className="fb-input flex min-w-[220px] flex-1 items-center gap-2">
          <Search size={15} aria-hidden />
          <input className="w-full bg-transparent outline-none" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('store.search')} aria-label={t('store.search')} />
        </label>
        {['All', ...TEMPLATE_CATEGORIES].map((c) => (
          <button
            key={c}
            className="fb-chip cursor-pointer"
            aria-pressed={cat === c}
            onClick={() => setCat(c)}
            style={cat === c ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(0, 212, 255,0.1)' } : undefined}
          >
            {c === 'All' ? t('cat.all') : categoryLabel(c, i18n)}
          </button>
        ))}
      </div>
      {list.length === 0 && <div className="fb-glass p-6 text-sm">{t('store.none')}</div>}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((tpl) => {
          const n = hired(tpl);
          const ask = tpl.tools.filter((x) => x.policy === 'approval').length;
          const pro = isPremium(tpl.slug);
          const locked = pro && isFree;
          return (
            <li key={tpl.slug} className="fb-glass fb-glass--hover fb-col gap-3 p-5" style={{ ['--tpl' as string]: tpl.color }}>
              <div className="flex items-start gap-3">
                <Avatar name={t(`tpl.${tpl.slug}.name` as TKey)} color={tpl.color} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t(`tpl.${tpl.slug}.name` as TKey)}</div>
                  <div className="fb-dim text-xs">{categoryLabel(tpl.category, i18n)}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Pill tone={pro ? 'warn' : 'ok'}>{pro ? <><Crown size={11} /> {t('store.tier.pro')}</> : t('store.tier.starter')}</Pill>
                  {n > 0 && <Pill tone="accent">{t('store.hired', { n })}</Pill>}
                </div>
              </div>
              <p className="fb-muted flex-1 text-sm leading-relaxed">{t(`tpl.${tpl.slug}.tagline` as TKey)}</p>
              <div className="flex flex-wrap gap-1.5">
                {tpl.tools.slice(0, 3).map((k) => (
                  <span key={k.tool} className="fb-chip">{k.tool}</span>
                ))}
                {tpl.tools.length > 3 && <span className="fb-chip">+{tpl.tools.length - 3}</span>}
              </div>
              <div className="flex items-center justify-between gap-2 border-t pt-3" style={{ borderColor: 'var(--fb-border)' }}>
                <span className="fb-dim text-xs">{t('hire.meta', { tools: tpl.tools.length, ask })}</span>
                {locked || full ? (
                  <Link to="/billing" className="fb-btn fb-btn--ghost" title={locked ? t('store.lockedHint') : t('store.fullHint')}>
                    <Lock size={13} /> {t(locked ? 'store.unlock' : 'store.full')}
                  </Link>
                ) : (
                  <button className="fb-btn fb-btn--primary" disabled={!canHire} onClick={() => setPick(tpl)}>
                    {n > 0 ? t('hire.another') : t('hire.btn')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {pick && (
        <HireDialog
          orgId={orgId}
          existing={agents}
          initial={pick}
          onClose={() => setPick(null)}
          onHired={() => {
            setPick(null);
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
