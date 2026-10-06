import { useCallback, useEffect, useState } from 'react';
import { Panel } from '../command/Panel';
import { useI18n } from '../../i18n/I18nProvider';
import { requireClient } from '../../lib/company/client';
import { ServerExecutionReceipt } from './ServerExecutionReceipt';
import { ServerRuntimeInventory } from './ServerRuntimeInventory';
import { ServiceAccessPanel } from '../gateway/ServiceAccessPanel';
import { ServerToolCheck } from './ServerToolCheck';
import { serverExecution } from '../../../../supabase/functions/_shared/server-execution';

// The server agent's own dashboard (behind a Caddy password on the VPS).
const DASHBOARD = (import.meta.env.VITE_SERVER_AGENT_DASHBOARD as string | undefined) || 'https://jarvis.firboai.app';

interface Status { configured: boolean; online?: boolean; model?: string; agent?: string; engine?: string; models?: string[]; reason?: string; runtime?: unknown }
interface Turn { q: string; a: string; meta: string; error?: boolean; execution?: unknown }

/** The OpenJarvis server on the VPS: live status and a direct line to it (platform admins only, checked by the server). */
export function ServerJarvisPanel({ coding: codingDefault = false }: { coding?: boolean } = {}) {
  const { t } = useI18n();
  const [status, setStatus] = useState<Status | null>(null);
  const [failed, setFailed] = useState(false);
  const [model, setModel] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  // Coding mode: the server agent works on code in its workspace (files, git, patches, tests) and remembers the last turns.
  const [coding, setCoding] = useState(codingDefault);

  const refresh = useCallback(async () => {
    setFailed(false);
    try {
      const { data, error } = await requireClient().functions.invoke('server-jarvis', { body: { action: 'status' } });
      if (error || !data) { setFailed(true); setStatus(null); return; }
      setStatus(data as Status);
    } catch { setFailed(true); setStatus(null); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = message.trim();
    if (!q || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await requireClient().functions.invoke('server-jarvis', { body: { action: 'chat', message: q, ...(model ? { model } : {}), ...(coding ? { mode: 'code', history: turns.filter(x => !x.error).slice(-4).flatMap(x => [{ role: 'user', content: x.q }, { role: 'assistant', content: x.a.slice(0, 4000) }]) } : {}) } });
      const reply = data as { reply?: string; model?: string; ms?: number; execution?: unknown } | null;
      setTurns(prev => [...prev, error || (!reply?.reply && !serverExecution(reply?.execution))
        ? { q, a: t('jv.error'), meta: '', error: true }
        : { q, a: reply?.reply || t('jv.emptyReply'), meta: `${reply?.model ?? ''} · ${Math.round((reply?.ms ?? 0) / 1000)} s`, execution: reply?.execution }]);
    } catch {
      setTurns(prev => [...prev, { q, a: t('jv.error'), meta: '', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const state = failed ? t('jv.error') : !status ? t('common.loading') : !status.configured ? t('jv.notConfigured') : status.online ? t('jv.online') : t('jv.offline');
  return <div className="space-y-4">
    <ServiceAccessPanel />
    <Panel title={t('jv.title')}>
      <p className="fb-muted text-sm">{t('jv.sub')}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="fb-chip" style={{ color: status?.online ? 'var(--fb-ok, #22c55e)' : undefined }} role="status">{state}</span>
        {status?.online && <>
          <span className="fb-chip">{t('jv.model')}: {status.model || '—'}</span>
          <span className="fb-chip">{t('jv.agent')}: {status.agent || '—'}</span>
          <span className="fb-chip">{t('jv.engine')}: {status.engine || '—'}</span>
        </>}
        <button className="fb-btn fb-btn--ghost" onClick={() => void refresh()}>{t('jv.refresh')}</button>
        <a className="fb-btn fb-btn--primary" href={DASHBOARD} target="_blank" rel="noopener noreferrer">{t('jv.open')} ↗</a>
      </div>
      {status && !status.configured && <p className="fb-dim mt-2 text-xs">{t('jv.setup')}</p>}
      {status?.online && <ServerRuntimeInventory value={status.runtime} />}
      {status?.online && <ServerToolCheck runtime={status.runtime} disabled={busy} />}
    </Panel>
    {status?.online && <Panel title={t('jv.ask')}>
      <form onSubmit={send} className="flex flex-col gap-2">
        {!!status.models?.length && <select className="fb-input" value={model} onChange={e => setModel(e.target.value)} aria-label={t('jv.model')}>
          <option value="">{status.model || t('jv.model')}</option>
          {status.models.filter(m => m !== status.model).map(m => <option key={m} value={m}>{m}</option>)}
        </select>}
        <textarea className="fb-input min-h-[80px]" value={message} maxLength={4000} onChange={e => setMessage(e.target.value)} placeholder={t('jv.placeholder')} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={coding} onChange={e => setCoding(e.target.checked)} /> {'</>'} Coding agent · git · files · tests</label>
        <div className="flex items-center gap-3">
          <button className="fb-btn fb-btn--primary" disabled={busy || !message.trim()}>{busy ? t('jv.thinking') : t('jv.send')}</button>
          <span className="fb-dim text-xs">{t('jv.slow')}</span>
        </div>
      </form>
      <ol className="mt-4 flex flex-col gap-3">{[...turns].reverse().map((turn, i) => <li key={i} className="fb-glass p-3 text-sm">
        <div className="fb-dim text-xs">{turn.q}</div>
        <div className="mt-1 whitespace-pre-wrap" role={turn.error ? 'alert' : undefined}>{turn.a}</div>
        {turn.meta && <div className="fb-dim mt-1 text-xs">{turn.meta}</div>}
        {!turn.error && <ServerExecutionReceipt value={turn.execution} />}
      </li>)}</ol>
    </Panel>}
  </div>;
}
