import { useI18n } from '../../i18n/I18nProvider';
import type { ComputerExecution } from '../../lib/company/runner';

/** Durable worker acknowledgement and terminal receipts, kept separate from AI prose. */
export function ComputerExecutionView({ execution, compact = false }: { execution: ComputerExecution | null; compact?: boolean }) {
  const { t } = useI18n();
  if (!execution) return null;
  const pending = execution.status === 'pending';
  return (
    <section className="mt-2 rounded-lg p-2 text-xs" aria-label={t('run.worker.title')} style={{ border: '1px solid var(--fb-border)' }}>
      <p role="status" aria-live="polite" className="mb-2">
        {execution.status === 'unknown' ? t('run.worker.unknown') : pending
          ? t('run.pending') : t(`status.${execution.status}`)}
      </p>
      <ul className="flex flex-col gap-2">
        {execution.jobs.map(job => (
          <li key={job.job_id}>
            <div className="flex flex-wrap items-center gap-2">
              <b>{job.device_name}</b>
              <span className="fb-dim">{job.status === 'queued' ? t('status.pending') : job.status === 'running' ? t('status.running')
                : job.status === 'cancelled' ? t('status.cancelled') : job.status === 'error' ? t('status.failed')
                  : job.receipt ? t('run.worker.receipt') : t('run.worker.waiting')}</span>
            </div>
            <div className="fb-dim mt-1 break-all">{t('run.worker.job', { id: job.job_id })}</div>
            {!compact && job.summary && <p className="mt-1 whitespace-pre-wrap">{job.summary}</p>}
            {job.receipt && <code className="fb-dim mt-1 block break-all" title={job.receipt.report_sha256}>{t('run.worker.receipt')}: {job.receipt.report_sha256.slice(0, 12)}…</code>}
          </li>
        ))}
      </ul>
    </section>
  );
}
