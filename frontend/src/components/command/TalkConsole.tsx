import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Mic, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { toast } from 'sonner';
import { StatusDot, Wave } from './Panel';
import type { Satellite } from '../scenes/HologramScene';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { createTask } from '../../lib/company/data';
import { agentLabel } from '../../lib/company/labels';
import { RunError, runTask } from '../../lib/company/runner';
import { agentColor, deriveAgentStates, STATE_KEY } from '../../lib/company/status';
import { MANAGER_ROLES, WRITER_ROLES, type TaskPriority } from '../../lib/company/types';
import { useCeoSession } from '../../lib/company/useCeoSession';
import '../../styles/voice-experience.css';
import { useOrgData } from '../../lib/company/useOrgData';

const CeoStage = lazy(() => import('../scenes/CeoStage').then((m) => ({ default: m.CeoStage })));

const QUICK = ['urgent', 'team', 'spend', 'next', 'results'] as const;
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

/** Reveals text letter by letter, like a film caption. */
function useTypewriter(text: string): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setN(text.length);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? (window.clearInterval(id), v) : v + 2)), 16);
    return () => window.clearInterval(id);
  }, [text]);
  return text.slice(0, n);
}

/**
 * The "Talk to Firbo" console: a full-screen overlay with the CEO hologram, live voice conversation,
 * and a Command tab that hands real work to any AI employee.
 */
export function TalkConsole({ onClose, autoBriefing = false }: { onClose: () => void; autoBriefing?: boolean }) {
  const i18n = useI18n();
  const { t, lang, fmt } = i18n;
  const navigate = useNavigate();
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canWrite = WRITER_ROLES.includes(role);
  const org = useOrgData(orgId, MANAGER_ROLES.includes(role), 10_000);
  const session = useCeoSession(orgId, user?.id, lang, t, t('ceo.briefing'), canWrite);
  const { ceo, state, lines, interim, voiceStatus, voiceLog, sendNow, muted, setMuted, handsFree, setHandsFree, canTalk, ask, listen, stop, briefing } = session;
  const briefed = useRef(false);
  const [tab, setTab] = useState<'talk' | 'command'>('talk');
  const [text, setText] = useState('');
  const [cmd, setCmd] = useState('');
  const [assignee, setAssignee] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const log = useRef<HTMLUListElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);

  const states = useMemo(() => deriveAgentStates(org.agents, org.tasks, org.approvals), [org.agents, org.tasks, org.approvals]);
  const team = useMemo(() => org.agents.filter((a) => a.enabled), [org.agents]);
  const satellites: Satellite[] = useMemo(
    () => org.agents.filter((a) => a.type !== 'ceo' && !a.slug.startsWith('ceo')).map((a) => ({ id: a.id, color: agentColor(a.type, a.slug), active: states[a.id] === 'active' || states[a.id] === 'waiting' })),
    [org.agents, states],
  );
  const lastCeo = [...lines].reverse().find((l) => l.who === 'ceo')?.text ?? '';
  const caption = useTypewriter(state === 'speaking' || state === 'idle' ? lastCeo : '');
  const ceoName = ceo ? agentLabel(ceo, i18n).name : t('talk.title');

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      window.clearInterval(clock);
    };
  }, [onClose]);
  useEffect(() => {
    log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' });
  }, [lines.length]);

  useEffect(() => {
    if (autoBriefing && ceo && !briefed.current) {
      briefed.current = true;
      void briefing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoBriefing, ceo]);

  const submitTalk = (e: FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m || state === 'thinking') return;
    setText('');
    void ask(m);
  };

  const submitCommand = async (e: FormEvent) => {
    e.preventDefault();
    const command = cmd.trim();
    const target = team.find((a) => a.id === assignee) ?? ceo;
    if (!command || !current || !user) return;
    if (!target) return void toast.error(t('cmd.noCeo'));
    setBusy(true);
    try {
      const id = await createTask({ orgId: current.organization.id, userId: user.id, title: command.slice(0, 200), description: command.length > 200 ? command : undefined, priority, agentId: target.id });
      toast.success(t('cmd.sent', { agent: agentLabel(target, i18n).name }));
      setCmd('');
      try {
        const out = await runTask(id, lang);
        if (out.queued > 0) toast.message(t('run.queued', { count: out.queued }));
      } catch (err) {
        toast.error(t(`run.err.${err instanceof RunError ? err.code : 'unknown'}` as TKey));
      }
      void org.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('tasks.createError'));
    } finally {
      setBusy(false);
    }
  };

  const go = (to: string) => {
    onClose();
    navigate(to);
  };

  const listening = state === 'listening';
  const busyState = state === 'thinking';

  return (
    <div className="fixed inset-0 z-50 flex flex-col overflow-y-auto" style={{ background: 'rgba(2,6,14,0.94)', backdropFilter: 'blur(10px)' }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div data-firbo-voice="talk" role="dialog" aria-modal="true" aria-label={t('talk.title')} className="fb-root mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-3 p-3 md:p-5" style={{ background: 'transparent', minHeight: 0 }}>
        <header className="flex flex-wrap items-center gap-3">
          <div className="min-w-0">
            <div className="fb-eyebrow">{current?.organization.name}</div>
            <h2 className="fb-grad-text text-xl font-semibold md:text-2xl">{t('talk.title')}</h2>
          </div>
          <span className="fb-chip ms-auto" role="status" aria-live="polite">
            <StatusDot tone={listening ? 'ok' : busyState ? 'warn' : 'idle'} live={state !== 'idle'} /> {t(`ceo.state.${state}` as TKey)}
          </span>
          <span className="fb-dim hidden text-sm tabular-nums md:inline">{fmt.time(now)}</span>
          <button className="fb-btn fb-btn--ghost" aria-label={t(muted ? 'ceo.unmute' : 'ceo.mute')} onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button ref={closeBtn} className="fb-btn fb-btn--ghost" aria-label={t('common.close')} onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.35fr_1fr]">
          <section className="fb-glass relative min-h-[360px] overflow-hidden">
            <div className="fb-scan absolute inset-0 opacity-40" aria-hidden />
            <div className="absolute inset-0">
              <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
                <CeoStage state={state} satellites={satellites} labels={{ noWebgl: t('office.noWebgl') }} />
              </Suspense>
            </div>
            <div className="absolute start-4 top-4 flex items-center gap-2">
              <span className="fb-dot" style={{ background: 'var(--fb-accent)', boxShadow: '0 0 10px var(--fb-accent)' }} />
              <span className="text-sm font-semibold">{ceoName}</span>
            </div>
            <div className="absolute start-4 top-12 hidden text-[11px] md:block fb-dim" aria-hidden>
              {t('ceo.live', { agents: satellites.length, active: satellites.filter((s) => s.active).length })}
            </div>

            {voiceStatus && (
              <div className="pointer-events-none absolute inset-x-4 top-14 text-center text-[11px]" style={{ color: 'var(--fb-muted)' }} role="status">
                {voiceStatus}
              </div>
            )}
            {interim ? (
              <div className="absolute inset-x-6 bottom-28 text-center text-lg" style={{ color: 'var(--fb-accent)' }}>“{interim}”</div>
            ) : (
              caption && (
                <div aria-hidden className="pointer-events-none absolute inset-x-5 bottom-28 max-h-[28%] overflow-hidden rounded-xl px-4 py-3 text-center text-[15px] leading-snug" style={{ background: 'rgba(2,10,20,0.6)', backdropFilter: 'blur(6px)', border: '1px solid var(--fb-border)' }}>
                  {caption}
                </div>
              )
            )}

            <div className="absolute inset-x-0 bottom-4 flex items-center justify-center gap-4 px-4">
              {canTalk || state !== 'idle' ? (
                <>
                  <label className="fb-muted flex cursor-pointer items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={handsFree} onChange={(e) => (setHandsFree(e.target.checked), e.target.checked && state === 'idle' && listen())} />
                    {t('ceo.handsFree')}
                  </label>
                  <button
                    className="relative grid h-[72px] w-[72px] cursor-pointer place-items-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ background: 'radial-gradient(circle, rgba(0,212,255,0.35), rgba(0,212,255,0.08))', border: '2px solid var(--fb-accent)', boxShadow: listening ? '0 0 0 8px rgba(0,212,255,0.15), 0 0 40px rgba(0,212,255,0.6)' : '0 0 24px rgba(0,212,255,0.35)', color: 'var(--fb-accent)' }}
                    disabled={!canWrite}
                    aria-label={t(listening ? 'voice.sendNow' : state !== 'idle' ? 'ceo.stop' : 'talk.tapToSpeak')} title={t(listening ? 'voice.sendNow' : state !== 'idle' ? 'ceo.stop' : 'talk.tapToSpeak')}
                    aria-pressed={listening}
                    onClick={listening ? sendNow : state !== 'idle' ? stop : listen}
                  >
                    {listening ? <Send size={26} /> : state !== 'idle' ? <Square size={24} /> : <Mic size={28} />}
                  </button>
                  {(listening || handsFree) && (
                    <button className="fb-btn fb-btn--ghost" onClick={stop}>
                      <Square size={13} /> {t('ceo.stop')}
                    </button>
                  )}
                  <button className="fb-btn fb-btn--ghost" disabled={!canWrite || busyState} onClick={() => void briefing()}>
                    {t('ceo.briefing')}
                  </button>
                </>
              ) : (
                <p className="fb-dim max-w-md text-center text-xs">{t('ceo.noMic')}</p>
              )}
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-1 flex justify-center opacity-70" aria-hidden>
              <Wave color="var(--fb-accent)" active={state !== 'idle'} />
            </div>
          </section>

          <section className="fb-col min-h-0 gap-3">
            <div className="fb-glass fb-col min-h-0 flex-1 gap-3 p-4">
              <div className="flex gap-2" role="tablist" aria-label={t('talk.title')}>
                {(['talk', 'command'] as const).map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} className="fb-chip cursor-pointer" onClick={() => setTab(k)} style={tab === k ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}>
                    {t(`talk.tab.${k}` as TKey)}
                  </button>
                ))}
              </div>

              {tab === 'talk' ? (
                <>
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('ceo.quickAria')}>
                    {QUICK.map((k) => (
                      <button key={k} className="fb-chip cursor-pointer" disabled={!canWrite || busyState} onClick={() => void ask(t(`ceo.q.${k}` as TKey))}>
                        {t(`ceo.q.${k}` as TKey)}
                      </button>
                    ))}
                  </div>
                  <ul ref={log} className="fb-col min-h-[140px] flex-1 gap-2 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 520px)', minHeight: 140 }} aria-live="polite">
                    {lines.length === 0 && <li className="fb-dim text-sm">{t('talk.hint')}</li>}
                    {lines.map((l, i) => (
                      <li key={i} className="fb-row p-3 text-sm" style={l.who === 'me' ? { borderColor: 'var(--fb-border-strong)' } : undefined}>
                        <div className="fb-dim mb-1 text-[11px]">{l.who === 'me' ? t('ceo.you') : ceoName}</div>
                        {l.text}
                      </li>
                    ))}
                  </ul>
                  {voiceLog.length > 0 && (
                    <details className="fb-dim text-[11px]">
                      <summary className="cursor-pointer">{t('voice.diag')}</summary>
                      <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{voiceLog.join('\n')}</pre>
                    </details>
                  )}
                  <form onSubmit={submitTalk} className="flex gap-2">
                    <input className="fb-input flex-1" value={text} maxLength={500} disabled={!canWrite} onChange={(e) => setText(e.target.value)} placeholder={t('ceo.placeholder')} aria-label={t('ceo.placeholder')} />
                    <button className="fb-btn fb-btn--primary" type="submit" disabled={!canWrite || !text.trim() || busyState} aria-label={t('ceo.send')}>
                      <Send size={15} />
                    </button>
                  </form>
                </>
              ) : (
                <form onSubmit={submitCommand} className="fb-col gap-3">
                  <p className="fb-muted text-sm">{t('cmd.hint')}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="fb-dim mb-1 block text-[11px]">{t('talk.assignTo')}</span>
                      <select className="fb-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                        <option value="">{ceoName}</option>
                        {team.filter((a) => a.id !== ceo?.id).map((a) => (
                          <option key={a.id} value={a.id}>{agentLabel(a, i18n).name}</option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="fb-dim mb-1 block text-[11px]">{t('tasks.priorityAria')}</span>
                      <select className="fb-input" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
                        {PRIORITIES.map((p) => (
                          <option key={p} value={p}>{t(`priority.${p}` as TKey)}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <textarea className="fb-input" style={{ height: 120, padding: 12 }} maxLength={2000} value={cmd} disabled={!canWrite} onChange={(e) => setCmd(e.target.value)} placeholder={t('cmd.placeholder')} aria-label={t('cmd.placeholder')} />
                  <button className="fb-btn fb-btn--primary self-end" disabled={busy || !canWrite || !cmd.trim()}>
                    <Send size={14} className="rtl:-scale-x-100" /> {busy ? t('cmd.sending') : t('cmd.send')}
                  </button>
                </form>
              )}
            </div>

            <div className="fb-glass fb-col gap-2 p-4">
              <div className="flex items-center justify-between">
                <h3 className="fb-eyebrow">{t('talk.team')}</h3>
                <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => go('/inbox')}>
                  {t('talk.approvals', { count: org.approvals.length })}
                </button>
              </div>
              <ul className="flex flex-wrap gap-2">
                {team.map((a) => {
                  const st = states[a.id] ?? 'idle';
                  return (
                    <li key={a.id}>
                      <button className="fb-chip cursor-pointer" onClick={() => go(`/team?agent=${a.id}`)} title={t(STATE_KEY[st])}>
                        <StatusDot tone={st === 'active' ? 'ok' : st === 'waiting' ? 'warn' : 'idle'} live={st === 'active'} /> {agentLabel(a, i18n).name.replace(' Agent', '')}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
