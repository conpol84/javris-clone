import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Mic, Send, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Modal } from '../team/Modal';
import { useI18n } from '../../i18n/I18nProvider';
import type { Lang } from '../../i18n/core';
import type { TKey } from '../../i18n/locales/en';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { createTask } from '../../lib/company/data';
import { agentLabel } from '../../lib/company/labels';
import { RunError, runTask } from '../../lib/company/runner';
import type { AgentRow } from '../../lib/company/types';

const SPEECH_LANG: Record<Lang, string> = {
  en: 'en-US', el: 'el-GR', es: 'es-ES', 'pt-BR': 'pt-BR', de: 'de-DE', fr: 'fr-FR', 'zh-CN': 'zh-CN', ar: 'ar-SA',
};

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | null => {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Type or speak a command: it becomes a task for the CEO agent, which plans it and queues outward steps for approval. */
export function CommandDialog({ agents, onClose }: { agents: AgentRow[]; onClose: () => void }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const navigate = useNavigate();
  const { current, user } = useCompanyAuth();
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const canSpeak = typeof window !== 'undefined' && recognitionCtor() !== null;
  const ceo = agents.find((a) => a.type === 'ceo' && a.enabled) ?? agents.find((a) => a.enabled) ?? null;

  useEffect(() => () => rec.current?.stop(), []);

  const toggleMic = () => {
    if (listening) return rec.current?.stop();
    const Ctor = recognitionCtor();
    if (!Ctor) return void toast.error(t('cmd.noMic'));
    const r = new Ctor();
    r.lang = SPEECH_LANG[lang];
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => {
      const heard = Array.from(e.results).map((x) => x[0]?.transcript ?? '').join(' ').trim();
      if (heard) setText(heard);
    };
    r.onerror = () => {
      setListening(false);
      toast.error(t('cmd.micError'));
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const command = text.trim();
    if (!command || !current || !user) return;
    if (!ceo) return void toast.error(t('cmd.noCeo'));
    setBusy(true);
    try {
      const id = await createTask({
        orgId: current.organization.id,
        userId: user.id,
        title: command.slice(0, 200),
        description: command.length > 200 ? command : undefined,
        priority: 'normal',
        agentId: ceo.id,
      });
      toast.success(t('cmd.sent', { agent: agentLabel(ceo, i18n).name }));
      try {
        const out = await runTask(id, lang);
        if (out.queued > 0) toast.message(t('run.queued', { count: out.queued }));
      } catch (err) {
        toast.error(t(`run.err.${err instanceof RunError ? err.code : 'unknown'}` as TKey));
      }
      onClose();
      navigate('/tasks');
    } catch (err) {
      console.error(err);
      toast.error(t('tasks.createError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('cmd.title')} onClose={onClose}>
      <p className="fb-muted mb-3 text-sm">{t('cmd.hint')}</p>
      <form onSubmit={send} className="flex flex-col gap-3">
        <textarea
          className="fb-input"
          style={{ height: 110, padding: 12 }}
          autoFocus
          maxLength={2000}
          placeholder={listening ? t('cmd.listening') : t('cmd.placeholder')}
          aria-label={t('cmd.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="flex items-center justify-between gap-2">
          <button type="button" className="fb-btn fb-btn--ghost" onClick={toggleMic} disabled={!canSpeak} title={canSpeak ? undefined : t('cmd.noMic')}>
            {listening ? <Square size={14} /> : <Mic size={14} />} {listening ? t('cmd.stop') : t('cmd.mic')}
          </button>
          <button className="fb-btn fb-btn--primary" disabled={busy || !text.trim()}>
            <Send size={14} className="rtl:-scale-x-100" /> {busy ? t('cmd.sending') : t('cmd.send')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
