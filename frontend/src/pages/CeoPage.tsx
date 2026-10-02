import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Mic, Square, Send, Volume2, VolumeX } from 'lucide-react';
import { HologramScene, type HoloState, type Satellite } from '../components/scenes/HologramScene';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { agentColor, deriveAgentStates } from '../lib/company/status';
import { resolvePersona } from '../lib/company/persona';
import { useOrgData } from '../lib/company/useOrgData';
import { agentLabel } from '../lib/company/labels';
import { useCeoSession } from '../lib/company/useCeoSession';
import { WRITER_ROLES } from '../lib/company/types';
import '../styles/firbo.css';

const QUICK = ['urgent', 'team', 'spend', 'next', 'results'] as const;

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
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const session = useCeoSession(orgId, user?.id, lang, t, t('ceo.briefing'));
  const { ceo, state, lines, interim, muted, setMuted, handsFree, setHandsFree, canTalk, ask, listen, stop, briefing } = session;
  const [text, setText] = useState('');
  const org = useOrgData(orgId, false, 12_000);
  const states = useMemo(() => deriveAgentStates(org.agents, org.tasks, org.approvals), [org.agents, org.tasks, org.approvals]);
  const satellites: Satellite[] = useMemo(
    () => org.agents.filter((a) => a.type !== 'ceo' && !a.slug.startsWith('ceo')).map((a) => ({ id: a.id, color: agentColor(a.type, a.slug), active: states[a.id] === 'active' || states[a.id] === 'waiting' })),
    [org.agents, states],
  );
  const lastCeo = [...lines].reverse().find((l) => l.who === 'ceo')?.text ?? '';
  const caption = useTypewriter(state === 'speaking' || state === 'idle' ? lastCeo : '');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const m = text.trim();
    if (!m || state === 'thinking') return;
    setText('');
    void ask(m);
  };

  const status = t(`ceo.state.${state}` as TKey);
  const name = ceo ? agentLabel(ceo, i18n).name : t('ceo.title');

  return (
    <div className="fb-root fb-col gap-4 p-4 lg:p-6" style={{ minHeight: '100%' }}>
      <header>
        <div className="fb-eyebrow">{t('ceo.eyebrow')}</div>
        <h1 className="fb-grad-text text-2xl font-semibold">{t('ceo.title')}</h1>
        <p className="fb-muted mt-1 max-w-2xl text-sm">{t('ceo.intro')}</p>
      </header>

      {!ceo ? (
        <div className="fb-glass p-6 text-sm">{t('ceo.none')}</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="fb-glass relative overflow-hidden" style={{ minHeight: 440 }}>
            <div className="absolute inset-0 fb-scan opacity-40" aria-hidden />
            <div className="absolute inset-0">
              <HologramScene state={state} satellites={satellites} persona={ceo ? resolvePersona(ceo) : undefined} labels={{ noWebgl: t('office.noWebgl') }} />
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

          <section className="fb-glass fb-col gap-3 p-4">
            <div className="flex flex-wrap gap-2">
              {canTalk &&
                (state === 'listening' || state === 'speaking' ? (
                  <button className="fb-btn fb-btn--primary" onClick={stop}>
                    <Square size={15} /> {t('ceo.stop')}
                  </button>
                ) : (
                  <button className="fb-btn fb-btn--primary" disabled={!canWrite || state === 'thinking'} onClick={listen}>
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
            <ul className="fb-col flex-1 gap-2 overflow-y-auto" style={{ maxHeight: 320 }} aria-live="polite">
              {lines.length === 0 && <li className="fb-dim text-sm">{t('ceo.empty')}</li>}
              {lines.map((l, i) => (
                <li key={i} className="fb-row p-3 text-sm" style={l.who === 'me' ? { borderColor: 'var(--fb-border-strong)' } : undefined}>
                  <div className="fb-dim mb-1 text-[11px]">{l.who === 'me' ? t('ceo.you') : name}</div>
                  {l.text}
                </li>
              ))}
            </ul>
            <form onSubmit={submit} className="flex gap-2">
              <input className="fb-input flex-1" value={text} maxLength={500} disabled={!canWrite} onChange={(e) => setText(e.target.value)} placeholder={t('ceo.placeholder')} aria-label={t('ceo.placeholder')} />
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
