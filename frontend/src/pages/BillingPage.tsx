import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Check, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { usePlatformAdmin } from '../lib/company/admin';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import {
  BillingError, LIMIT_KEYS, loadPlans, loadPlanUsage, openPortal, setPlanManually, startCheckout, type PlanRow, type PlanUsage,
} from '../lib/company/billing';
import '../styles/firbo.css';

const ACCENT: Record<string, string> = { free: '#8aa4c4', pro: '#00d4ff', business: '#a3e635', enterprise: '#f59e0b' };

/** Plans, live usage against the plan's limits, and upgrading. Limits are enforced by the database and Edge Functions. */
export function BillingPage() {
  const { t, fmt } = useI18n();
  const { current } = useCompanyAuth();
  const isPlatformAdmin = usePlatformAdmin();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const canBill = ['owner', 'admin'].includes(current?.role ?? '');
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [info, setInfo] = useState<PlanUsage | null>(null);
  const [interval, setIntervalMode] = useState<'month' | 'year'>('month');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      const [p, u] = await Promise.all([loadPlans(), loadPlanUsage(orgId)]);
      setPlans(p);
      setInfo(u);
    } catch (err) {
      console.error(err);
      toast.error(t('bill.loadError'));
    }
  }, [orgId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const s = params.get('status');
    if (!s) return;
    toast[s === 'success' ? 'success' : 'message'](t(s === 'success' ? 'bill.success' : 'bill.cancelled'));
    setParams({}, { replace: true });
    if (s === 'success') window.setTimeout(() => void load(), 2500);
  }, [params, setParams, t, load]);

  const errText = (err: unknown) => t(`bill.err.${err instanceof BillingError ? err.code : 'unknown'}` as TKey);

  const upgrade = async (plan: PlanRow) => {
    setBusy(plan.id);
    try {
      const { url } = await startCheckout(orgId, plan.id, interval);
      window.location.href = url;
    } catch (err) {
      toast.error(errText(err));
      setBusy(null);
    }
  };
  const manage = async () => {
    setBusy('portal');
    try {
      const { url } = await openPortal(orgId);
      window.location.href = url;
    } catch (err) {
      toast.error(errText(err));
      setBusy(null);
    }
  };
  const force = async (plan: PlanRow) => {
    setBusy(plan.id);
    try {
      await setPlanManually(orgId, plan.id);
      toast.success(t('bill.planSet', { plan: plan.name }));
      await load();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(null);
    }
  };

  const price = (p: PlanRow) => {
    if (p.id === 'enterprise') return t('bill.custom');
    const v = interval === 'year' ? p.price_year_usd : p.price_month_usd;
    return v === 0 ? t('bill.free') : `${fmt.currency(Number(v), 'USD')}`;
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1180px] space-y-5 px-4 pb-10 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="fb-grad-text mt-1 text-2xl font-semibold">{t('bill.title')}</h1>
          <p className="fb-muted mt-1 max-w-2xl text-sm">{t('bill.sub')}</p>
        </header>

        {info && (
          <section className="fb-glass p-5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="fb-chip" style={{ color: ACCENT[info.plan.id], borderColor: ACCENT[info.plan.id] }}>
                <Sparkles size={12} /> {t('bill.current', { plan: info.plan.name })}
              </span>
              {info.status !== 'active' && <span className="fb-chip" style={{ color: 'var(--fb-warn)' }}>{t(`bill.status.${info.status}` as TKey)}</span>}
              {info.renews_at && <span className="fb-dim text-xs">{t('bill.renews', { date: fmt.date(info.renews_at) })}</span>}
              {info.has_subscription && canBill && (
                <button className="fb-btn fb-btn--ghost ms-auto" disabled={busy !== null} onClick={() => void manage()}>
                  {busy === 'portal' ? t('common.loading') : t('bill.manage')}
                </button>
              )}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {LIMIT_KEYS.map((k) => {
                const used = info.usage?.[k] ?? 0;
                const cap = info.plan?.limits?.[k] ?? 0;
                const pct = cap > 0 ? Math.min(100, (used / cap) * 100) : 100;
                const tone = pct >= 100 ? 'var(--fb-err)' : pct >= 80 ? 'var(--fb-warn)' : 'var(--fb-accent)';
                return (
                  <div key={k} className="fb-row fb-col gap-1.5 p-3">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="fb-muted">{t(`bill.limit.${k}` as TKey)}</span>
                      <span className="font-semibold tabular-nums">{fmt.number(used)} / {fmt.number(cap)}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.07)' }} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={t(`bill.limit.${k}` as TKey)}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone, boxShadow: `0 0 10px ${tone}` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {info.plan.id !== 'enterprise' && <p className="fb-dim mt-3 text-xs">{t('bill.enforced')}</p>}
          </section>
        )}

        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{t('bill.choose')}</h2>
          <div className="fb-glass flex gap-1 p-1" role="group" aria-label={t('bill.interval')}>
            {(['month', 'year'] as const).map((m) => (
              <button key={m} className="fb-btn" style={{ height: 30, padding: '0 14px', ...(interval === m ? { background: 'rgba(0, 212, 255,.16)', color: 'var(--fb-accent)' } : {}) }} aria-pressed={interval === m} onClick={() => setIntervalMode(m)}>
                {t(m === 'month' ? 'bill.monthly' : 'bill.yearly')}
              </button>
            ))}
          </div>
        </div>

        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {plans.map((p) => {
            const isCurrent = info?.plan.id === p.id;
            const color = ACCENT[p.id];
            return (
              <li key={p.id} className="fb-glass fb-col gap-4 p-5" style={{ borderColor: isCurrent || p.id === 'pro' ? color : undefined, boxShadow: isCurrent ? `0 0 40px -12px ${color}` : p.id === 'pro' ? `0 0 50px -18px ${color}` : undefined, background: p.id === 'pro' ? `linear-gradient(180deg, ${color}14, transparent 45%), rgba(9,17,31,.74)` : undefined }}>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="fb-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
                    <span className="text-base font-semibold">{p.name}</span>
                    {p.id === 'pro' && <span className="fb-chip ms-auto" style={{ color }}>{t('bill.popular')}</span>}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-semibold tracking-tight">{price(p)}</span>
                    {p.purchasable && <span className="fb-dim text-xs">/ {t(interval === 'month' ? 'bill.perMonth' : 'bill.perYear')}</span>}
                  </div>
                  {p.id === 'enterprise' && <p className="fb-dim mt-1 text-xs">{t('bill.enterpriseNote')}</p>}
                </div>
                <ul className="fb-col gap-2 text-sm">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check size={15} className="mt-0.5 shrink-0" style={{ color }} />
                      <span>{t(`bill.feat.${f}` as TKey)}</span>
                    </li>
                  ))}
                </ul>
                <ul className="fb-col flex-1 gap-1.5 border-t pt-3 text-[13px]" style={{ borderColor: 'var(--fb-border)' }}>
                  {LIMIT_KEYS.map((k) => (
                    <li key={k} className="flex items-center justify-between gap-2">
                      <span className="fb-dim">{t(`bill.limit.${k}` as TKey)}</span>
                      <span className="font-semibold tabular-nums">{fmt.number(p.limits?.[k] ?? 0)}</span>
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <button className="fb-btn fb-btn--ghost w-full justify-center" disabled>{t('bill.yourPlan')}</button>
                ) : p.purchasable && canBill ? (
                  <button className="fb-btn fb-btn--primary w-full justify-center" disabled={busy !== null} onClick={() => void upgrade(p)}>
                    {busy === p.id ? t('common.loading') : t('bill.upgrade', { plan: p.name })}
                  </button>
                ) : p.purchasable ? (
                  <p className="fb-dim text-xs">{t('bill.ownersOnly')}</p>
                ) : null}
                {isPlatformAdmin && !isCurrent && (
                  <button className="fb-link fb-muted cursor-pointer text-xs underline" disabled={busy !== null} onClick={() => void force(p)}>
                    {t('bill.adminSet')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
