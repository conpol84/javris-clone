import { VoiceProfileControl } from '../components/voice/VoiceProfileControl';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { CeoActions } from '../components/company/CeoActions';
import { JarvisModeControl } from '../components/company/JarvisModeControl';
import { useJarvisMode } from '../lib/company/useJarvisMode';
import { JARVIS_SERVER_MODE } from '../lib/company/jarvis-server-mode';
import { usePlanUsageState } from '../lib/company/usePlan';
import { CeoSessionHistory } from '../components/company/CeoSessionHistory';
import { Mic, Square, Send, Volume2, VolumeX } from 'lucide-react';
import type { Satellite } from '../components/scenes/HologramScene';
import { CeoStage } from '../components/scenes/CeoStage';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { agentColor, deriveAgentStates } from '../lib/company/status';
import { useOrgData } from '../lib/company/useOrgData';
import { agentLabel } from '../lib/company/labels';
import { useCeoSession } from '../lib/company/useCeoSession';
import { computerProgressLabel } from '../lib/company/laptop-bridge';
import { WRITER_ROLES } from '../lib/company/types';
import '../styles/firbo.css';
import '../styles/jarvis-visual-system.css';
import '../styles/voice-experience.css';

const QUICK = ['report', 'urgent', 'team', 'spend', 'next', 'results'] as const;

/** Reveals text letter by letter, like a film caption. */
function useTypewriter(text: string, cps = 60): string {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    if (!text) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return setN(text.length);
    const id = window.setInterval(() => setN((v) => (v >= text.length ? (window.clearInterval(id), v) : v + 2)), 1000 / cps);
    return () => window.clearInterval(id);
  }, [text, cps]);
  return text.slice(0, n);
}

/** The AI CEO, as a hologram you can talk to. */
export function CeoPage() {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const jarvis=useJarvisMode(orgId,user?.id);
  const planState=usePlanUsageState(orgId||undefined);
  const role = current?.role ?? 'viewer';
  const canWrite = WRITER_ROLES.includes(role);
  const session = useCeoSession(orgId, user?.id, lang, t, t('ceo.briefing'), canWrite, ['owner','admin'].includes(role),jarvis.enabled);
  const { ceo, state, lines, interim, voiceStatus, voiceLog, sendNow, muted, setMuted, handsFree, setHandsFree, canTalk, ask, listen, stop, briefing,
    sessions, activeSessionId, historyLoading, historyError, computerProgress, openSession, newSession, retryHistory } = session;
  const [text, setText] = useState('');
  const transcriptRef = useRef<HTMLUListElement>(null);
  const followLatestRef = useRef(true);
  useEffect(() => { followLatestRef.current = true; }, [activeSessionId]);
  // Follow new replies without pulling the user away while reading older messages.
  useEffect(() => {
    if (!followLatestRef.current) return;
    const transcript = transcriptRef.current;
    if (transcript) transcript.scrollTop = transcript.scrollHeight;
  }, [lines.length, activeSessionId]);
  const org = useOrgData(orgId, false, 12_000);
  const states = useMemo(() => deriveAgentStates(org.agents, org.tasks, org.approvals), [org.agents, org.tasks, org.approvals]);
  const satellites: Satellite[] = useMemo(
    () => org.agents.filter((a) => a.type !== 'ceo' && !a.slug.startsWith('ceo')).map((a) => ({ id: a.id, color: agentColor(a.type, a.slug), name: agentLabel(a, i18n).name.replace(' Agent', ''), active: states[a.id] === 'active' || states[a.id] === 'waiting' })),
    [org.agents, states, i18n],
  );
  const lastCeo = [...lines].reverse().find((l) => l.who === 'ceo')?.text ?? '';
  const caption = useTypewriter(state === 'speaking' || state === 'idle' ? lastCeo : '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m || state === 'thinking') return;
    setText('');
    const field = e.currentTarget.querySelector('textarea');
    if (field) field.style.height = '';
    void ask(m);
  };

  const status = t(`ceo.state.${state}` as TKey);
  const name = ceo ? agentLabel(ceo, i18n).name : t('ceo.title');

  return (
    <div data-firbo-voice="ceo" className="fb-root fb-col min-w-0 gap-3 px-3 pb-4 pt-14 sm:p-4 sm:pt-14 lg:p-6" style={{ minHeight: "100%" }}>
      <header>
        <div className="fb-eyebrow">{t('ceo.eyebrow')}</div>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <h1 className="fb-grad-text text-2xl font-semibold">{t('ceo.title')}</h1>
          <Link to="/chat?ceo=1" className="fb-btn fb-btn--ghost text-xs" aria-label={`${t('nav.chat')} — ${t('nav.ceo')}`}>
            {t('nav.chat')} → {t('nav.ceo')}
          </Link>
        </div>
        <p className="fb-muted mt-1 max-w-2xl text-sm">{t('ceo.intro')}</p>
      </header>
      {ceo && canWrite && user?.id && <JarvisModeControl enabled={jarvis.enabled}
        onToggle={jarvis.setEnabled} lang={lang} disabled={planState.status!=='ready'||jarvis.loading||jarvis.saving||jarvis.error} unavailable={jarvis.error} onRetry={jarvis.retry}/>}
      <VoiceProfileControl />

      {!ceo ? (
        <div className="fb-glass p-6 text-sm">{t('ceo.none')}</div>
      ) : (
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-4">
          <section className="fb-glass fb-voice-stage relative order-2 min-h-[210px] overflow-hidden lg:order-1">
            <div className="absolute inset-0 fb-scan opacity-40" aria-hidden />
            <div className="absolute inset-0">
              <CeoStage state={state} satellites={satellites} labels={{ noWebgl: t('office.noWebgl') }} />
            </div>
            <div className="absolute start-4 top-4 flex items-center gap-2">
              <span className="fb-dot" style={{ background: 'var(--fb-accent)', boxShadow: '0 0 10px var(--fb-accent)' }} />
              <span className="text-sm font-semibold">{name}</span>
            </div>
            <div className="absolute end-4 top-4 flex items-center gap-2">
              <span className="fb-chip" role="status" aria-live="polite">{status}</span>
              <button className="fb-btn fb-btn--ghost" aria-label={muted ? t('ceo.unmute') : t('ceo.mute')} onClick={() => setMuted((m) => !m)}>
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
            </div>
            {voiceStatus && (
              <div className="pointer-events-none absolute inset-x-4 top-14 text-center text-[11px]" style={{ color: 'var(--fb-muted)' }} role="status">
                {voiceStatus}
              </div>
            )}
            {interim ? (
              <div className="absolute inset-x-6 bottom-5 text-center text-lg" style={{ color: 'var(--fb-accent)' }}>
                “{interim}”
              </div>
            ) : (
              caption && (
                <div aria-hidden className="pointer-events-none absolute inset-x-5 bottom-4 max-h-[34%] overflow-hidden rounded-xl px-4 py-3 text-center text-[15px] leading-snug" style={{ background: 'rgba(3, 8, 18,0.55)', backdropFilter: 'blur(6px)', border: '1px solid var(--fb-border)' }}>
                  {caption}
                </div>
              )
            )}
            <div className="absolute start-4 bottom-4 hidden flex-col gap-1 text-[11px] md:flex" aria-hidden>
              <span className="fb-dim">{t('ceo.live', { agents: satellites.length, active: satellites.filter((s) => s.active).length })}</span>
            </div>
          </section>

          <section data-ceo-chatpanel="true" className="fb-glass fb-col order-1 min-w-0 gap-3 p-3 sm:p-4 lg:order-2">
            <CeoSessionHistory key={`${orgId}:${user?.id}`} canCreate={canWrite} lang={lang} sessions={sessions} activeId={activeSessionId}
              loading={historyLoading} error={historyError} disabled={state!=='idle'||historyError}
              onSelect={id=>void openSession(id)} onNew={newSession} onRetry={retryHistory}/>
            {computerProgress && (
              <div role="status" aria-live="polite" data-ceo-job-progress="true"
                className="fb-dim rounded-xl border px-3 py-2 text-xs"
                style={{borderColor:'var(--fb-border)'}}>
                {computerProgressLabel(computerProgress,lang)}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {(canTalk || state !== 'idle') &&
                (state === 'listening' ? (
                  <>
                    <button className="fb-btn fb-btn--primary" onClick={sendNow}>
                      <Send size={15} /> {t('voice.sendNow')}
                    </button>
                    <button className="fb-btn fb-btn--ghost" onClick={stop}>
                      <Square size={15} /> {t('ceo.stop')}
                    </button>
                  </>
                ) : state === 'speaking' || state === 'thinking' ? (
                  <button className="fb-btn fb-btn--primary" onClick={stop}>
                    <Square size={15} /> {t('ceo.stop')}
                  </button>
                ) : (
                  <button className="fb-btn fb-btn--primary" disabled={!canWrite} onClick={listen}>
                    <Mic size={15} /> {t('ceo.talk')}
                  </button>
                ))}
              <button className="fb-btn fb-btn--ghost" disabled={!canWrite || state === 'thinking'} onClick={briefing}>
                {t('ceo.briefing')}
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('ceo.quickAria')}>
              {QUICK.map((k) => (
                <button key={k} className="fb-chip cursor-pointer" disabled={!canWrite || state === 'thinking'} onClick={() => void ask(t(`ceo.q.${k}` as TKey))}>
                  {t(`ceo.q.${k}` as TKey)}
                </button>
              ))}
            </div>
            {canTalk && (
              <label className="fb-muted flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={handsFree}
                  onChange={(e) => {
                    setHandsFree(e.target.checked);
                    if (e.target.checked && state === 'idle') listen();
                  }}
                />
                {t('ceo.handsFree')}
              </label>
            )}
            {!canTalk && <p className="fb-dim text-xs">{t('ceo.noMic')}</p>}
            {voiceLog.length > 0 && (
              <details className="fb-dim text-[11px]">
                <summary className="cursor-pointer">{t('voice.diag')}</summary>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap" style={{ fontFamily: 'JetBrains Mono, monospace' }}>{voiceLog.join('\n')}</pre>
              </details>
            )}
            <ul ref={transcriptRef} onScroll={e => { const el = e.currentTarget; followLatestRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 64; }} className="fb-col min-h-[220px] min-w-0 flex-1 gap-2 overflow-x-hidden overflow-y-auto" style={{ maxHeight: 480 }} aria-live="polite" aria-label="CEO conversation" data-ceo-transcript="true">
              {lines.length === 0 && <li className="fb-dim text-sm">{t('ceo.empty')}</li>}
              {lines.map((l, i) => (
                <li key={i} className="fb-row min-w-0 break-words [overflow-wrap:anywhere] p-3 text-sm" style={l.who === 'me' ? { borderColor: 'var(--fb-border-strong)' } : undefined}>
                  <div className="fb-dim mb-1 text-[11px]">{l.who === 'me' ? t('ceo.you') : name}</div>
                  {l.text}
                  <CeoActions ask={l.ask} task={l.task} meet={l.meet} app={l.app} queuedTaskId={l.queuedTaskId}
                    messageId={l.messageId} conversationId={activeSessionId??undefined}
                    fresh={l.fresh===true&&!JARVIS_SERVER_MODE} autopilotEnabled={jarvis.enabled}
                    planReady={planState.status==='ready'} />
                </li>
              ))}
            </ul>
            <form data-ceo-composer="true" onSubmit={submit} className="flex min-w-0 items-end gap-2">
              <textarea className="fb-input min-w-0 flex-1 resize-none leading-relaxed" rows={2} value={text} maxLength={4000} disabled={!canWrite}
                onChange={(e) => setText(e.target.value)}
                onInput={(e) => { const el = e.currentTarget; el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 136) + 'px'; }}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }}
                placeholder={t('ceo.placeholder')} aria-label={t('ceo.placeholder')} />
              <button className="fb-btn fb-btn--primary" type="submit" disabled={!canWrite || !text.trim() || state === 'thinking'} aria-label={t('ceo.send')}>
                <Send size={15} />
              </button>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
