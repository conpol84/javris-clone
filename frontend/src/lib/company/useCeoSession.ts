import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { HoloState } from '../../components/scenes/HologramScene';
import type { TKey } from '../../i18n/locales/en';
import { createConversation, listAgents, loadOrgSummary } from './data';
import { RunError, sendChat } from './runner';
import type { AgentRow } from './types';
import { listenOnce, recognitionSupported, speak, stopSpeaking, type VoiceError } from './voice';

export interface CeoLine {
  who: 'me' | 'ceo';
  text: string;
}

/** One live conversation with the CEO agent: speech in, thinking, speech out. Shared by the CEO page and the Talk console. */
export function useCeoSession(orgId: string, userId: string | undefined, lang: string, t: (key: TKey, vars?: Record<string, string | number>) => string, briefingText: string) {
  const [ceo, setCeo] = useState<AgentRow | null>(null);
  const [state, setState] = useState<HoloState>('idle');
  const [lines, setLines] = useState<CeoLine[]>([]);
  const [interim, setInterim] = useState('');
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(false);
  const handsFreeRef = useRef(false);
  const mutedRef = useRef(false);
  const listenRef = useRef<() => void>(() => {});
  const convo = useRef<string | null>(null);
  const stopListen = useRef<() => void>(() => {});
  const alive = useRef(true);
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
      if (!ceo || !userId || !message.trim()) return;
      setLines((l) => [...l, { who: 'me', text: message }]);
      setState('thinking');
      try {
        if (!convo.current) convo.current = (await createConversation(orgId, userId, ceo.id)).id;
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
    [ceo, userId, orgId, lang, t],
  );

  const listen = () => {
    stopSpeaking();
    setInterim('');
    setState('listening');
    stopListen.current = listenOnce(lang, {
      error: (c: VoiceError) => c !== 'no_speech' && toast.error(t(`voice.err.${c}` as TKey)),
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
    await ask(`${briefingText}. ${facts}`);
  };

  return { ceo, state, lines, interim, muted, setMuted, handsFree, setHandsFree, canTalk, ask, listen, stop, briefing };
}
