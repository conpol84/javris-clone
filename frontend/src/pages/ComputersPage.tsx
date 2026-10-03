import { useCallback, useEffect, useState, useRef, type FormEvent } from 'react';
import { Check, Copy, Download, Monitor, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { addDevice, cancelJob, ComputerError, giveJob, isOnline, listDevices, listJobs, newPairCode, removeDevice, type DeviceRow, type JobRow } from '../lib/company/computers';
import '../styles/firbo.css';
import { useComputerQuery } from '../lib/company/useComputerQuery';
import { formatComputerResult } from '../lib/company/computer-state';
import { computerManagerLabels } from '../lib/company/computer-manager-labels';

type Kind = JobRow['kind'];
const KINDS: Kind[] = ['list', 'read', 'write', 'exec'];

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const { t, lang } = useI18n();
  const l = computerManagerLabels[lang];
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; clearTimeout(timer.current); }; }, []);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard_unavailable');
      await navigator.clipboard.writeText(text);
      if (live.current) { setDone(true); clearTimeout(timer.current); timer.current = setTimeout(() => setDone(false), 1500); }
    } catch { if (live.current) toast.error(l.copyError); }
  };
  return <div className="fb-copyline">
    <pre className="fb-input whitespace-pre-wrap break-all p-3 font-mono text-xs" style={{ height: 'auto' }} dir="ltr">{text}</pre>
    <button type="button" className="fb-btn fb-btn--ghost" aria-label={done ? l.copied : t('coding.copy')} onClick={() => void copy()}>
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  </div>;
}

/** Give your AI team a safe pair of hands on your own computer. */
export function ComputersPage() {
  const { current, user } = useCompanyAuth();
  // A workspace or permission change destroys every device/job/pairing draft immediately.
  return <ComputerManager key={`${user?.id ?? ''}:${current?.organization.id ?? ''}:${current?.role ?? ''}`}
    orgId={current?.organization.id ?? ''} canManage={['owner', 'admin'].includes(current?.role ?? '')} />;
}

function ComputerManager({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const { t, fmt, lang } = useI18n();
  const l = computerManagerLabels[lang];
  const [now, setNow] = useState(() => Date.now());
  const live = useRef(true);
  const mutation = useRef(false);
  useEffect(() => { live.current = true; const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { live.current = false; window.clearInterval(clock); }; }, []);
  const [name, setName] = useState('');
  const [pair, setPair] = useState<{ device_id: string; code: string; expiresAt: number } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>('list');
  const [pathText, setPathText] = useState('');
  const [content, setContent] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);

  const deviceLoader = useCallback(() => listDevices(orgId), [orgId]);
  const deviceQuery = useComputerQuery(orgId, !!orgId && canManage, deviceLoader, 8000);
  const devices = deviceQuery.rows;
  const load = deviceQuery.refresh;
  const jobLoader = useCallback(() => listJobs(orgId, sel ?? ''), [orgId, sel]);
  const jobQuery = useComputerQuery(`${orgId}:${sel ?? ''}`, !!orgId && !!sel && canManage, jobLoader, 2500);
  const jobs = jobQuery.rows;
  const loadJobs = jobQuery.refresh;
  const selectDevice = (id: string) => {
    setSel(id); setKind('list'); setPathText(''); setContent(''); setCommand('');
  };
  const pairExpired = !!pair && now >= pair.expiresAt;
  const visiblePair = pair && !pairExpired && !devices.some(d => d.id === pair.device_id && (d.paired || d.revoked_at)) ? pair : null;
  useEffect(() => {
    if (pair && (pairExpired || devices.some(d => d.id === pair.device_id && (d.paired || d.revoked_at)))) setPair(null);
  }, [pair, pairExpired, devices]);

  const errText = (err: unknown) => err instanceof ComputerError && ['state_conflict','save_failed'].includes(err.code) ? `${l.jobsError} ${l.refresh}` : t(`comp.err.${err instanceof ComputerError ? err.code.replace('_', '') : 'unknown'}` as TKey);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!orgId || !canManage || !name.trim() || mutation.current) return;
    mutation.current = true; setBusy(true);
    const expiresAt = Date.now() + 9 * 60_000;
    try {
      const added = await addDevice(orgId, name.trim());
      if (!live.current) return;
      setPair({ ...added, expiresAt });
      setName('');
      await load();
    } catch (err) {
      if (live.current) toast.error(errText(err));
    } finally {
      mutation.current = false; if (live.current) setBusy(false);
    }
  };

  const give = async (e: FormEvent) => {
    e.preventDefault();
    if (!canManage || !chosen || deviceQuery.phase !== 'ready' || !isOnline(chosen, now) || mutation.current) return;
    const params = kind === 'exec' ? { command, cwd: pathText } : kind === 'write' ? { path: pathText, content } : { path: pathText };
    if ((kind === 'write' || kind === 'exec') && !window.confirm(t(kind === 'write' ? 'comp.confirmWrite' : 'comp.confirmExec'))) return;
    mutation.current = true; setBusy(true);
    try {
      await giveJob(chosen.id, kind, params, kind === 'write' || kind === 'exec');
      if (!live.current) return;
      toast.success(t('comp.queued'));
      await loadJobs();
    } catch (err) {
      if (live.current) toast.error(errText(err));
    } finally {
      mutation.current = false; if (live.current) setBusy(false);
    }
  };

  const remove = async (d: DeviceRow) => {
    if (!canManage || mutation.current || !window.confirm(t('comp.confirmRemove', { name: d.name }))) return;
    mutation.current = true; setBusy(true);
    try {
      await removeDevice(d.id);
      if (!live.current) return;
      if (sel === d.id) setSel(null);
      if (pair?.device_id === d.id) setPair(null);
      await load();
    } catch (err) {
      if (live.current) toast.error(errText(err));
    } finally { mutation.current = false; if (live.current) setBusy(false); }
  };

  const regen = async (d: DeviceRow) => {
    if (!canManage || d.paired || d.revoked_at || mutation.current) return;
    mutation.current = true; setBusy(true);
    const expiresAt = Date.now() + 9 * 60_000;
    try {
      const next = await newPairCode(d.id);
      if (live.current) setPair({ device_id: d.id, ...next, expiresAt });
    } catch (err) { if (live.current) toast.error(errText(err)); }
    finally { mutation.current = false; if (live.current) setBusy(false); }
  };
  const cancel = async (job: JobRow) => {
    if (!canManage || job.status !== 'queued' || job.device_id !== sel || mutation.current) return;
    mutation.current = true; setBusy(true);
    try { await cancelJob(job.id); if (live.current) await loadJobs(); }
    catch (err) { if (live.current) toast.error(errText(err)); }
    finally { mutation.current = false; if (live.current) setBusy(false); }
  };

  const chosen = devices.find((d) => d.id === sel && d.paired && !d.revoked_at) ?? null;
  const unpaired = (d: DeviceRow) => !d.paired;

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-5 px-4 pb-10 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{t('comp.eyebrow')}</div>
          <h1 className="fb-grad-text mt-1 text-2xl font-semibold">{t('comp.title')}</h1>
          <p className="fb-muted mt-1 max-w-3xl text-sm">{t('comp.intro')}</p>
        </header>
        <p className="fb-glass p-4 text-sm" data-testid="computer-capability-note">{l.capabilityNote}</p>

        {!canManage ? (
          <div className="fb-glass p-5 text-sm">{t('comp.ownersOnly')}</div>
        ) : (
          <>
            <section className="fb-glass fb-col gap-3 p-5">
              <h2 className="text-base font-semibold">{t('comp.addTitle')}</h2>
              <form onSubmit={add} className="flex flex-wrap gap-2">
                <input className="fb-input flex-1" style={{ minWidth: 0 }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('comp.namePh')} aria-label={t('comp.namePh')} />
                <button className="fb-btn fb-btn--primary" disabled={busy || !name.trim()}>{t('comp.addBtn')}</button>
              </form>
              {visiblePair && (
                <div className="fb-col gap-3 rounded-xl p-4" style={{ background: 'rgba(0, 212, 255,.06)', border: '1px solid var(--fb-border-strong)' }}>
                  <div className="text-sm">{t('comp.codeIs')}</div>
                  <div data-testid="pair-code" dir="ltr" className="break-all text-2xl font-bold tracking-[0.15em]" style={{ color: 'var(--fb-accent)' }}>{visiblePair.code}</div>
                  <p className="fb-dim text-xs">{t('comp.codeExpires')}</p>
                  <a className="fb-btn fb-btn--ghost self-start" href="/firbo-connector.mjs" download><Download size={14} /> {t('comp.download')}</a>
                  <div className="fb-eyebrow">{t('comp.stepSafe')}</div>
                  <CopyLine text={`node firbo-connector.mjs pair ${visiblePair.code} --allow ~/Documents`} />
                  <details><summary className="cursor-pointer">{t('comp.stepMore')}</summary>
                    <p className="my-2 text-sm">{l.execWarning}</p>
                    <CopyLine text={`node firbo-connector.mjs pair ${visiblePair.code} --allow ~/Projects --allow-write --allow-exec`} />
                  </details>
                  <div className="fb-eyebrow">{t('comp.stepRun')}</div>
                  <CopyLine text="node firbo-connector.mjs run" />
                  <p className="fb-dim text-xs">{l.cancelNotice}</p>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold">{t('comp.yours')}</h2>
              <p className="fb-dim mb-2 text-xs">{l.clockNote}</p>
              <button type="button" className="fb-btn fb-btn--ghost mb-3" disabled={busy} onClick={() => void load()}>{l.refresh}</button>
              {deviceQuery.phase === 'error' ? <p role="alert" className="fb-glass p-4 text-sm">{l.devicesError}</p> : deviceQuery.phase === 'loading' ? <p role="status">{t('common.loading')}</p> : devices.length === 0 ? (
                <div className="fb-glass p-5 text-sm">{t('comp.none')}</div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {devices.map((d) => {
                    const online = isOnline(d, now);
                    return (
                      <li key={d.id}>
                        <article className="fb-glass fb-col gap-2 p-4" style={sel === d.id ? { borderColor: 'var(--fb-accent)' } : undefined}>
                          <button type="button" disabled={unpaired(d) || busy} aria-pressed={sel === d.id}
                            data-testid={`select-device-${d.id}`} className="fb-device-select text-start" onClick={() => selectDevice(d.id)}>
                            <span className="flex flex-wrap items-center gap-2">
                              <Monitor size={16} aria-hidden />
                              <span className="min-w-0 flex-1 break-words font-semibold">{d.name}</span>
                              <StatusDot tone={unpaired(d) ? 'warn' : online ? 'ok' : 'idle'} live={online} />
                              <span className="text-xs">{t(unpaired(d) ? 'comp.waitingPair' : online ? 'comp.online' : 'comp.offline')}</span>
                            </span>
                            <span className="fb-dim mt-2 block text-xs">{d.platform ?? '–'} {d.last_seen_at && Number.isFinite(Date.parse(d.last_seen_at)) ? `· ${t('comp.seen', { when: fmt.dateTime(d.last_seen_at) })}` : ''}</span>
                          </button>
                          <div className="flex gap-2">
                            {unpaired(d) && <button disabled={busy} className="fb-btn fb-btn--ghost" onClick={(e) => (e.stopPropagation(), void regen(d))}>{t('comp.newCode')}</button>}
                            <button disabled={busy} className="fb-btn fb-btn--ghost ms-auto" aria-label={t('comp.remove')} onClick={(e) => (e.stopPropagation(), void remove(d))}><Trash2 size={14} /></button>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {chosen && (
              <section key={chosen.id} data-testid="computer-workspace" className="fb-glass fb-col gap-3 p-5">
                <h2 className="text-base font-semibold">{t('comp.workOn', { name: chosen.name })}</h2>
                {!isOnline(chosen, now) && <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('comp.startIt')}</p>}
                <div className="flex flex-wrap gap-2" role="tablist">
                  {KINDS.map((k) => (
                    <button key={k} role="tab" aria-selected={kind === k} className="fb-chip cursor-pointer" onClick={() => setKind(k)} style={kind === k ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>
                      {t(`comp.kind.${k}` as TKey)}
                    </button>
                  ))}
                </div>
                {kind === 'exec' && <p role="note" className="text-sm">{l.execWarning}</p>}
                <form onSubmit={give} className="fb-col gap-2">
                  <input className="fb-input" value={pathText} onChange={(e) => setPathText(e.target.value)} spellCheck={false} placeholder={t(kind === 'exec' ? 'comp.cwdPh' : 'comp.pathPh')} aria-label={t(kind === 'exec' ? 'comp.cwdPh' : 'comp.pathPh')} required={kind === 'read' || kind === 'write'} />
                  {kind === 'write' && <textarea className="fb-input" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('comp.contentPh')} aria-label={t('comp.contentPh')} />}
                  {kind === 'exec' && <input className="fb-input font-mono" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} placeholder={t('comp.commandPh')} aria-label={t('comp.commandPh')} required />}
                  <button className="fb-btn fb-btn--primary self-start" disabled={busy || deviceQuery.phase !== 'ready' || !isOnline(chosen, now)}>{t('comp.send')}</button>
                </form>

                <h3 className="font-semibold">{l.history}</h3>
                <p className="fb-dim text-xs">{l.cancelNotice}</p>
                {jobQuery.phase === 'error' ? <div role="alert"><p>{l.jobsError}</p><button type="button" className="fb-btn fb-btn--ghost" onClick={() => void loadJobs()}>{l.refresh}</button></div> : jobQuery.phase === 'loading' ? <p role="status">{t('common.loading')}</p> : !jobs.length ? <p>{l.noJobs}</p> : null}
                <ul className="fb-col gap-2" data-testid="computer-jobs">
                  {jobs.map((j) => (
                    <li key={j.id} className="fb-row fb-col gap-1 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="fb-chip">{t(`comp.kind.${j.kind}` as TKey)}</span>
                        <span className="min-w-0 flex-1 truncate font-mono">{String(j.params.path ?? j.params.command ?? '')}</span>
                        <span style={{ color: j.status === 'done' ? 'var(--fb-ok)' : j.status === 'error' ? 'var(--fb-err)' : 'var(--fb-warn)' }}>{t(`comp.status.${j.status}` as TKey)}</span>
                        {j.status === 'queued' && <button type="button" disabled={busy} className="fb-link cursor-pointer underline" onClick={() => void cancel(j)}>{l.cancelQueued}</button>}
                      </div>
                      {j.error && <p className="text-xs" style={{ color: 'var(--fb-err)' }}>{t(`comp.jobErr.${j.error}` as TKey) === `comp.jobErr.${j.error}` ? j.error : t(`comp.jobErr.${j.error}` as TKey)}</p>}
                      {j.result && <pre className="fb-input overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px]" style={{ height: 'auto', maxHeight: 220 }}>{formatComputerResult(j)}</pre>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

