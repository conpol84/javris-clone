import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Download, Monitor, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { addDevice, cancelJob, ComputerError, giveJob, isOnline, listDevices, listJobs, newPairCode, removeDevice, type DeviceRow, type JobRow } from '../lib/company/computers';
import '../styles/firbo.css';

type Kind = JobRow['kind'];
const KINDS: Kind[] = ['list', 'read', 'write', 'exec'];

function CopyLine({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const { t } = useI18n();
  return (
    <div className="relative">
      <pre className="fb-input overflow-x-auto whitespace-pre-wrap break-all p-3 pe-12 font-mono text-xs" style={{ height: 'auto' }}>{text}</pre>
      <button className="fb-btn fb-btn--ghost absolute end-2 top-2" style={{ height: 28, padding: '0 8px' }} aria-label={t('coding.copy')} onClick={() => void navigator.clipboard?.writeText(text).then(() => (setDone(true), window.setTimeout(() => setDone(false), 1500)))}>
        {done ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
}

/** Give your AI team a safe pair of hands on your own computer. */
export function ComputersPage() {
  const { t, fmt } = useI18n();
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = ['owner', 'admin'].includes(current?.role ?? '');
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState('');
  const [pair, setPair] = useState<{ device_id: string; code: string } | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [kind, setKind] = useState<Kind>('list');
  const [pathText, setPathText] = useState('');
  const [content, setContent] = useState('');
  const [command, setCommand] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId || !canManage) return;
    try {
      setDevices(await listDevices(orgId));
      setNow(Date.now());
    } catch (err) {
      console.error(err);
      toast.error(t('chat.loadError'));
    }
  }, [orgId, canManage, t]);
  useEffect(() => {
    void load();
    const id = window.setInterval(() => !document.hidden && void load(), 8000);
    return () => window.clearInterval(id);
  }, [load]);

  const loadJobs = useCallback(async () => {
    if (!orgId || !sel) return;
    try {
      setJobs(await listJobs(orgId, sel));
    } catch {
      /* the next tick retries */
    }
  }, [orgId, sel]);
  useEffect(() => {
    void loadJobs();
    const id = window.setInterval(() => !document.hidden && void loadJobs(), 2500);
    return () => window.clearInterval(id);
  }, [loadJobs]);

  const errText = (err: unknown) => t(`comp.err.${err instanceof ComputerError ? err.code.replace('_', '') : 'unknown'}` as TKey);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      setPair(await addDevice(orgId, name.trim()));
      setName('');
      await load();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const give = async (e: FormEvent) => {
    e.preventDefault();
    if (!sel || busy) return;
    const params = kind === 'exec' ? { command, cwd: pathText } : kind === 'write' ? { path: pathText, content } : { path: pathText };
    if ((kind === 'write' || kind === 'exec') && !window.confirm(t(kind === 'write' ? 'comp.confirmWrite' : 'comp.confirmExec'))) return;
    setBusy(true);
    try {
      await giveJob(sel, kind, params, kind === 'write' || kind === 'exec');
      toast.success(t('comp.queued'));
      await loadJobs();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (d: DeviceRow) => {
    if (!window.confirm(t('comp.confirmRemove', { name: d.name }))) return;
    try {
      await removeDevice(d.id);
      if (sel === d.id) setSel(null);
      await load();
    } catch (err) {
      toast.error(errText(err));
    }
  };

  const regen = async (d: DeviceRow) => {
    try {
      setPair({ device_id: d.id, ...(await newPairCode(d.id)) });
    } catch (err) {
      toast.error(errText(err));
    }
  };

  const chosen = devices.find((d) => d.id === sel) ?? null;
  const unpaired = (d: DeviceRow) => !d.paired;

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-5 px-4 pb-10 pt-14 md:px-6 md:pt-6">
        <header>
          <div className="fb-eyebrow">{t('comp.eyebrow')}</div>
          <h1 className="fb-grad-text mt-1 text-2xl font-semibold">{t('comp.title')}</h1>
          <p className="fb-muted mt-1 max-w-3xl text-sm">{t('comp.intro')}</p>
        </header>

        {!canManage ? (
          <div className="fb-glass p-5 text-sm">{t('comp.ownersOnly')}</div>
        ) : (
          <>
            <section className="fb-glass fb-col gap-3 p-5">
              <h2 className="text-base font-semibold">{t('comp.addTitle')}</h2>
              <form onSubmit={add} className="flex flex-wrap gap-2">
                <input className="fb-input flex-1" style={{ minWidth: 200 }} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder={t('comp.namePh')} aria-label={t('comp.namePh')} />
                <button className="fb-btn fb-btn--primary" disabled={busy || !name.trim()}>{t('comp.addBtn')}</button>
              </form>
              {pair && (
                <div className="fb-col gap-3 rounded-xl p-4" style={{ background: 'rgba(34, 211, 238,.06)', border: '1px solid var(--fb-border-strong)' }}>
                  <div className="text-sm">{t('comp.codeIs')}</div>
                  <div className="text-3xl font-bold tracking-[0.3em]" style={{ color: 'var(--fb-accent)' }}>{pair.code}</div>
                  <p className="fb-dim text-xs">{t('comp.codeExpires')}</p>
                  <a className="fb-btn fb-btn--ghost self-start" href="/firbo-connector.mjs" download><Download size={14} /> {t('comp.download')}</a>
                  <div className="fb-eyebrow">{t('comp.stepSafe')}</div>
                  <CopyLine text={`node firbo-connector.mjs pair ${pair.code} --allow ~/Documents`} />
                  <div className="fb-eyebrow">{t('comp.stepMore')}</div>
                  <CopyLine text={`node firbo-connector.mjs pair ${pair.code} --allow ~/Projects --allow-write --allow-exec`} />
                  <div className="fb-eyebrow">{t('comp.stepRun')}</div>
                  <CopyLine text="node firbo-connector.mjs run" />
                  <p className="fb-dim text-xs">{t('comp.safetyNote')}</p>
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 text-base font-semibold">{t('comp.yours')}</h2>
              {devices.length === 0 ? (
                <div className="fb-glass p-5 text-sm">{t('comp.none')}</div>
              ) : (
                <ul className="grid gap-3 md:grid-cols-2">
                  {devices.map((d) => {
                    const online = isOnline(d, now);
                    return (
                      <li key={d.id}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-pressed={sel === d.id}
                          onClick={() => !unpaired(d) && setSel(d.id)}
                          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !unpaired(d) && setSel(d.id)}
                          className="fb-glass fb-col cursor-pointer gap-2 p-4"
                          style={sel === d.id ? { borderColor: 'var(--fb-accent)' } : undefined}
                        >
                          <div className="flex items-center gap-2">
                            <Monitor size={16} aria-hidden />
                            <span className="min-w-0 flex-1 truncate font-semibold">{d.name}</span>
                            <StatusDot tone={unpaired(d) ? 'warn' : online ? 'ok' : 'idle'} live={online} />
                            <span className="text-xs">{t(unpaired(d) ? 'comp.waitingPair' : online ? 'comp.online' : 'comp.offline')}</span>
                          </div>
                          <div className="fb-dim text-xs">{d.platform ?? '–'} {d.last_seen_at ? `· ${t('comp.seen', { when: fmt.dateTime(d.last_seen_at) })}` : ''}</div>
                          <div className="flex gap-2">
                            {unpaired(d) && <button className="fb-btn fb-btn--ghost" onClick={(e) => (e.stopPropagation(), void regen(d))}>{t('comp.newCode')}</button>}
                            <button className="fb-btn fb-btn--ghost ms-auto" aria-label={t('comp.remove')} onClick={(e) => (e.stopPropagation(), void remove(d))}><Trash2 size={14} /></button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {chosen && (
              <section className="fb-glass fb-col gap-3 p-5">
                <h2 className="text-base font-semibold">{t('comp.workOn', { name: chosen.name })}</h2>
                {!isOnline(chosen, now) && <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('comp.startIt')}</p>}
                <div className="flex flex-wrap gap-2" role="tablist">
                  {KINDS.map((k) => (
                    <button key={k} role="tab" aria-selected={kind === k} className="fb-chip cursor-pointer" onClick={() => setKind(k)} style={kind === k ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>
                      {t(`comp.kind.${k}` as TKey)}
                    </button>
                  ))}
                </div>
                <form onSubmit={give} className="fb-col gap-2">
                  <input className="fb-input" value={pathText} onChange={(e) => setPathText(e.target.value)} spellCheck={false} placeholder={t(kind === 'exec' ? 'comp.cwdPh' : 'comp.pathPh')} aria-label={t(kind === 'exec' ? 'comp.cwdPh' : 'comp.pathPh')} required={kind === 'read' || kind === 'write'} />
                  {kind === 'write' && <textarea className="fb-input" rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder={t('comp.contentPh')} aria-label={t('comp.contentPh')} />}
                  {kind === 'exec' && <input className="fb-input font-mono" value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} placeholder={t('comp.commandPh')} aria-label={t('comp.commandPh')} required />}
                  <button className="fb-btn fb-btn--primary self-start" disabled={busy}>{t('comp.send')}</button>
                </form>

                <ul className="fb-col gap-2">
                  {jobs.map((j) => (
                    <li key={j.id} className="fb-row fb-col gap-1 p-3">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="fb-chip">{t(`comp.kind.${j.kind}` as TKey)}</span>
                        <span className="min-w-0 flex-1 truncate font-mono">{String(j.params.path ?? j.params.command ?? '')}</span>
                        <span style={{ color: j.status === 'done' ? 'var(--fb-ok)' : j.status === 'error' ? 'var(--fb-err)' : 'var(--fb-warn)' }}>{t(`comp.status.${j.status}` as TKey)}</span>
                        {j.status === 'queued' && <button className="fb-link cursor-pointer underline" onClick={() => void cancelJob(j.id).then(loadJobs)}>{t('common.close')}</button>}
                      </div>
                      {j.error && <p className="text-xs" style={{ color: 'var(--fb-err)' }}>{t(`comp.jobErr.${j.error}` as TKey) === `comp.jobErr.${j.error}` ? j.error : t(`comp.jobErr.${j.error}` as TKey)}</p>}
                      {j.result && <pre className="fb-input overflow-auto whitespace-pre-wrap p-2 font-mono text-[11px]" style={{ height: 'auto', maxHeight: 220 }}>{formatResult(j)}</pre>}
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

function formatResult(j: JobRow): string {
  const r = j.result as Record<string, unknown>;
  if (j.kind === 'list') return (r.entries as { name: string; type: string; size: number | null }[]).map((e) => `${e.type === 'dir' ? '📁' : '📄'} ${e.name}${e.size != null ? `  (${e.size} B)` : ''}`).join('\n');
  if (j.kind === 'read') return String(r.content ?? '');
  if (j.kind === 'write') return `${String(r.path)} (${String(r.written)} chars)`;
  return `exit ${String(r.code)}\n${String(r.stdout ?? '')}${r.stderr ? `\n${String(r.stderr)}` : ''}`;
}
