import { useI18n } from '../../i18n/I18nProvider';
import { serverExecution } from '../../../../supabase/functions/_shared/server-execution';

/** Runtime tool reports stay distinct from the model's prose and artifact verification. */
export function ServerExecutionReceipt({ value }: { value: unknown }) {
  const { t } = useI18n();
  const execution = serverExecution(value);
  if (!execution) return <p className="fb-dim mt-2 text-xs">{t('jv.executionUnknown')}</p>;
  return <div className="mt-3 border-t border-white/10 pt-2 text-xs">
    <p>{t('jv.executionTitle')}: {execution.tool_count} · {t('jv.executionFailed')}: {execution.failed_count}</p>
    <p className="fb-dim mt-1">{t('jv.executionCaveat')}</p>
    {execution.tool_count === 0 && <p className="mt-1">{t('jv.executionEmpty')}</p>}
    <ol className="mt-2 space-y-2">{execution.tools.map((tool, i) => <li key={i}>
      <details className="rounded border border-white/10 p-2">
        <summary className="cursor-pointer break-words">{tool.name} · {t(tool.success ? 'jv.executionSucceeded' : 'jv.executionFailed')}</summary>
        <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{tool.output}</pre>
        {tool.truncated && <p className="fb-dim">{t('jv.executionTruncated')}</p>}
      </details>
    </li>)}</ol>
    {execution.truncated && <p className="fb-dim mt-2">{t('jv.executionTruncated')}</p>}
  </div>;
}
