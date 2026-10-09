import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { AccountingError, loadAccountingSnapshot, type AccountingSnapshot } from '../../lib/company/accounting';

interface LoadState { orgId: string; revision: number; value?: AccountingSnapshot; error?: 'forbidden' | 'unavailable' }

export function InferenceAccounting({ orgId, allowed }: { orgId: string; allowed: boolean }) {
  if (!allowed || !orgId) return null;
  // Remount on company/permission transitions; no previous snapshot survives.
  return <CompanyInferenceAccounting key={orgId} orgId={orgId} />;
}

function CompanyInferenceAccounting({ orgId }: { orgId: string }) {
  const { t, fmt } = useI18n();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<LoadState | null>(null);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    void loadAccountingSnapshot(orgId, controller.signal).then(value => {
      if (live) setState({ orgId, revision, value });
    }).catch(error => {
      if (live) setState({ orgId, revision, error: error instanceof AccountingError ? error.code : 'unavailable' });
    });
    return () => { live = false; controller.abort(); };
  }, [orgId, revision]);
  const current = state?.orgId === orgId && state.revision === revision ? state : null;
  const data = current?.value;
  return (
    <section className="fb-glass min-w-0 p-5" aria-labelledby="inference-accounting-title" aria-busy={!current}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="inference-accounting-title" className="text-lg font-semibold">{t('acct.title')}</h2>
          <p className="fb-muted mt-1 max-w-2xl text-sm">{t('acct.scope')}</p>
        </div>
        <button className="fb-btn fb-btn--ghost" onClick={() => setRevision(v => v + 1)} disabled={!current}>
          {t('common.refresh')}
        </button>
      </div>
      {!current && <p className="fb-muted mt-4" role="status">{t('common.loading')}</p>}
      {current?.error && <p className="mt-4 text-sm" role="alert">{t(current.error === 'forbidden' ? 'acct.forbidden' : 'acct.unavailable')}</p>}
      {data && <>
        <p className="fb-dim mt-3 text-xs">{t('acct.observed', { date: fmt.date(data.observed_at, { dateStyle: 'short', timeStyle: 'short' }) })}</p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {([
            ['acct.liability', fmt.number(data.potential_liability_usd, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })],
            ['acct.open', fmt.number(data.open_count)],
            ['acct.reconcile', fmt.number(data.reconcile_required_count)],
            ['acct.monthSpend', fmt.number(data.platform_settled_month_usd, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })],
          ] as const).map(([label, value]) => <div key={label} className="fb-row fb-col gap-1 p-3">
            <dt className="fb-muted text-xs">{t(label)}</dt><dd className="break-words text-xl font-semibold tabular-nums">{value}</dd>
          </div>)}
        </dl>
        {(data.unknown_settled_cost_count > 0 || data.overrun_month_count > 0) && <p className="mt-3 text-sm" role="alert" style={{ color: 'var(--fb-warn)' }}>
          {t('acct.attention', { unknown: fmt.number(data.unknown_settled_cost_count), overruns: fmt.number(data.overrun_month_count) })}
        </p>}
        <p className="fb-muted mt-3 text-sm">{t('acct.counts', {
          reserved: fmt.number(data.reserved_count), stale: fmt.number(data.stale_open_count),
          minutes: fmt.number(data.stale_minutes), byok: fmt.number(data.byok_settled_month_count),
          zero: fmt.number(data.zero_cost_settled_month_count),
        })}</p>
        {data.open_count === 0 ? <p className="fb-muted mt-4 text-sm">{t('acct.empty')}</p> : <>
          <p className="fb-dim mt-4 text-xs">{t('acct.details', { shown: fmt.number(data.details.length), total: fmt.number(data.open_count) })}</p>
          <ul className="mt-2 space-y-2">
            {data.details.map(row => <li key={row.request_id} className="fb-row flex-wrap gap-x-4 gap-y-2 p-3 text-xs">
              <code className="min-w-0 break-all">{row.request_id}</code>
              <span>{t(row.source === 'agent-chat' ? 'acct.chat' : row.source === 'mission-runner' ? 'acct.mission' : 'acct.task')}</span>
              <span>{t(row.status === 'reserved' ? 'acct.reserved' : 'acct.needsReview')}</span>
              <span className="tabular-nums">{fmt.number(row.reserved_usd, { style: 'currency', currency: 'USD', maximumFractionDigits: 6 })}</span>
              <span>{t('acct.age', { minutes: fmt.number(Math.floor(row.age_seconds / 60)) })}</span>
            </li>)}
          </ul>
        </>}
        <p className="fb-dim mt-4 text-xs">{t('acct.note')}</p>
      </>}
    </section>
  );
}
