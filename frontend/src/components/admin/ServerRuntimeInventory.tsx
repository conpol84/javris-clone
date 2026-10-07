import { useI18n } from '../../i18n/I18nProvider';
import { serverRuntime } from '../../../../supabase/functions/_shared/server-runtime';

export function ServerRuntimeInventory({ value }: { value: unknown }) {
  const { t } = useI18n();
  const runtime = serverRuntime(value);
  if (!runtime) return <p className="fb-dim mt-2 text-xs">{t('jv.runtimeUnknown')}</p>;
  if (!runtime.agent_loaded) return <p className="mt-2 text-xs" role="alert">{t('jv.agentMissing')}</p>;
  return <div className="mt-2 text-xs">
    <p>{t('jv.agentLoaded')}</p>
    {!runtime.tool_inventory_known ? <p className="fb-dim">{t('jv.runtimeUnknown')}</p> : <>
      <p>{t('jv.loadedTools')}: {runtime.tool_count}</p>
      {runtime.tool_count === 0 && <p role="alert">{t('jv.noLoadedTools')}</p>}
      {!!runtime.tool_names.length && <details className="mt-1">
        <summary className="cursor-pointer">{t('jv.loadedTools')}</summary>
        <ul className="mt-1 max-h-48 overflow-auto">{runtime.tool_names.map(name => <li className="break-words" key={name}>{name}</li>)}</ul>
      </details>}
      {runtime.truncated && <p className="fb-dim">{t('jv.executionTruncated')}</p>}
    </>}
    <p className="fb-dim mt-1">{t('jv.runtimeCaveat')}</p>
  </div>;
}
