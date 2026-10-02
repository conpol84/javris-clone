import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Mic, Square, Send, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { HologramScene, type HoloState } from '../components/scenes/HologramScene';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createConversation, listAgents, loadOrgSummary } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { RunError, sendChat } from '../lib/company/runner';
import { WRITER_ROLES, type AgentRow } from '../lib/company/types';
import { listenOnce, recognitionSupported, speak, stopSpeaking } from '../lib/company/voice';
import '../styles/firbo.css';

interface Line {
  who: 'me' | 'ceo';
  text: string;
}

const QUICK = ['urgent', 'team', 'spend', 'next', 'results'] as const;

/** The AI CEO, as a hologram you can talk to. */
export function CeoPage() {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const [ceo, setCeo] = useState<AgentRow | null>(null);
  const [state, setState] = useState<HoloState>('idle');
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState('');
  const [text, setText] = useState('');
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef(false);
  const listenRef = useRef<() => void>(() => {});
  const convo = useRef<string | null>(null);
  const stopListen = useRef<() => void>(() => {});
  const alive = useRef(true);
  const mutedRef = useRef(false);
  const canTalk = recognitionSupported();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopListen.current();
      stopSpeaking();
    };
  }, []);
  useEffect(() => {
    mutedRef.current = muted;
    handsFreeRef.current = handsFree;
    if (muted) stopSpeaking();
  }, [muted, handsFree]);
  useEffect(() => {
    convo.current = null;
    if (!orgId) return;
    listAgents(orgId)
      .then((a) => setCeo(a.find((x) => x.type === 'ceo' || x.slug.startsWith('ceo')) ?? null))
      .catch(() => toast.error(t('chat.loadError')));
  }, [orgId, t]);

  const ask = useCallback(
    async (message: string) => {
      if (!ceo || !user || !message.trim()) return;
      setLines((l) => [...l, { who: 'me', text: message }]);
      setState('thinking');
      try {
        if (!convo.current) convo.current = (await createConversation(orgId, user.id, ceo.id)).id;
        const res = await sendChat(convo.current, message, lang, true);
        if (!alive.current) return;
        setLines((l) => [...l, { who: 'ceo', text: res.message.content }]);
        if (mutedRef.current) setState('idle');
        else {
          setState('speaking');
          await speak(orgId, res.message.content, lang);
          if (alive.current) {
            setState('idle');
            if (handsFreeRef.current && recognitionSupported()) listenRef.current();
          }
        }
      } catch (err) {
        console.error(err);
        if (alive.current) {
          setState('idle');
          toast.error(t(`run.err.${err instanceof RunError ? err.code : 'unknown'}` as TKey));
        }
      }
    },
    [ceo, user, orgId, lang, t],
  );

  const listen = () => {
    stopSpeaking();
    setInterim('');
    setState('listening');
    stopListen.current = listenOnce(lang, {
      interim: setInterim,
      final: (txt) => {
        setInterim('');
        if (txt) void ask(txt);
        else setState('idle');
      },
      end: () => {
        setInterim('');
        setState((s) => (s === 'listening' ? 'idle' : s));
      },
    });
  };
  listenRef.current = listen;
  const stop = () => {
    setHandsFree(false);
    handsFreeRef.current = false;
    stopListen.current();
    stopSpeaking();
    setState('idle');
  };

  const briefing = async () => {
    if (!ceo) return;
    let facts = '';
    try {
      const s = await loadOrgSummary(orgId, false);
      facts = `Facts: ${s.agents} active AI employees, ${s.openTasks} open tasks, ${s.approvals} approvals waiting for me.`;
    } catch {
      /* the CEO still greets */
    }
    await ask(`${t('ceo.briefing')}. ${facts}`);
  };

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
              <HologramScene state={state} labels={{ noWebgl: t('office.noWebgl') }} />
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
            {interim && (
              <div className="absolute inset-x-6 bottom-5 text-center text-lg" style={{ color: 'var(--fb-accent)' }}>
                “{interim}”
              </div>
            )}
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
