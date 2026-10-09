import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Mic, MessageSquare, MessageSquarePlus, Send, Square, Trash2, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Wave } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createConversation, deleteConversation, listAgents, listConversations, listMessages, type ConversationRow } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { RunError, runErrorText, sendChat, type ChatMessage } from '../lib/company/runner';
import { parseHandoff } from '../lib/company/handoff';
import { CeoActions } from '../components/company/CeoActions';
import { useWorkspaceCopy } from '../lib/company/workspaceCopy';
import { agentColor } from '../lib/company/status';
import { listenSmart, speak, unlockAudio, type VoiceError } from '../lib/company/voice';
import { beginVoiceTurn, type VoiceTurn } from '../lib/company/voiceActivity';
import { voiceMessages } from '../lib/company/voiceMessages';
import { isUnlockContinuation, resolveUnlockContinuation } from '../lib/company/computer-continuation';
import { journalCeoComputerJob } from '../lib/company/ceo-device-journal';
import { WRITER_ROLES, type AgentRow } from '../lib/company/types';
import { dispatchDirectComputerCommand, incompleteComputerReply, isComputerControlRequest, parseDirectComputerCommand, parseOwnerDecision, prepareDirectComputerCommand, type DirectComputerProposal } from '../lib/company/laptop-bridge';
import '../styles/firbo.css';

/** Continuous chat with any AI employee, with saved history. */
export function AgentChatPage() {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const canComputer = ['owner', 'admin'].includes(current?.role ?? '');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [speakOn, setSpeakOn] = useState(() => {
    try {
      return localStorage.getItem('firbo.chat.speak') === '1';
    } catch {
      return false;
    }
  });
  const stopListen = useRef<() => void>(() => {});
  const pendingComputer = useRef<DirectComputerProposal | null>(null);
  const computerRun = useRef<AbortController | null>(null);
  const [computerRunning, setComputerRunning] = useState(false);
  const canTalk = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  const voiceTurn = useRef<VoiceTurn | null>(null);
  const speakOnRef = useRef(speakOn); speakOnRef.current = speakOn;
  const end = useRef<HTMLDivElement>(null);
  const activeId = params.get('c');
  const copy = useWorkspaceCopy();
  const askAgent = params.get('ask');
  const askQuestion = params.get('q') ?? '';
  const voiceScope = JSON.stringify([orgId, user?.id, activeId, lang, canWrite, canComputer]);
  const voiceScopeRef = useRef(voiceScope); voiceScopeRef.current = voiceScope;
  useEffect(() => {
    pendingComputer.current = null;
    computerRun.current?.abort(); computerRun.current = null; setComputerRunning(false);
    setListening(false); setInterim(''); setSending(false);
    return () => { computerRun.current?.abort(); stopListen.current(); voiceTurn.current?.cancel(); };
  }, [voiceScope]);
  const active = convos.find((c) => c.id === activeId) ?? null;
  const agentOf = useCallback((id: string | null) => agents.find((a) => a.id === id) ?? null, [agents]);
  const nameOf = (a: AgentRow | null) => (a ? agentLabel(a, i18n).name : t('unassigned'));
  const activeAgent = agentOf(active?.agent_id ?? null);
  const activeIsCeo = !!activeAgent && (activeAgent.type === 'ceo' || activeAgent.slug.startsWith('ceo'));

  // Put through by the CEO: open (or start) the chat with that employee, the question ready to send.
  const [listLoaded, setListLoaded] = useState(false);
  useEffect(() => {
    if (!askAgent || !listLoaded || !user || !orgId) return;
    const agent = agents.find((a) => a.id === askAgent);
    const next = new URLSearchParams(params);
    next.delete('ask'); next.delete('q');
    if (!agent) { setParams(next, { replace: true }); return; }
    let live = true;
    const existing = convos.find((c) => c.agent_id === agent.id);
    (existing ? Promise.resolve(existing) : createConversation(orgId, user.id, agent.id).then((c) => { setConvos((prev) => [c, ...prev]); return c; }))
      .then((c) => { if (!live) return; next.set('c', c.id); setParams(next, { replace: true }); setText(askQuestion); })
      .catch(() => live && toast.error(t('chat.startError')));
    return () => { live = false; };
  }, [askAgent, listLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadList = useCallback(async () => {
    if (!orgId || !user) return;
    setConvos(await listConversations(orgId, user.id));
  }, [orgId, user]);

  useEffect(() => {
    if (!orgId || !user) return;
    let live = true;
    Promise.all([listAgents(orgId), listConversations(orgId, user.id)])
      .then(([a, c]) => {
        if (live) {
          setAgents(a);
          setConvos(c);
          setListLoaded(true);
        }
      })
      .catch(() => live && toast.error(t('chat.loadError')));
    return () => {
      live = false;
    };
  }, [orgId, user, t]);

  useEffect(() => {
    setMessages([]);
    if (!activeId) return;
    let live = true;
    listMessages(activeId)
      .then((m) => live && setMessages(m))
      .catch(() => live && toast.error(t('chat.loadError')));
    return () => {
      live = false;
    };
  }, [activeId, t]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' });
  }, [messages, sending]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('c', id);
    else next.delete('c');
    setParams(next, { replace: true });
  };

  const start = async (agent: AgentRow) => {
    if (!user) return;
    try {
      const c = await createConversation(orgId, user.id, agent.id);
      setConvos((prev) => [c, ...prev]);
      setPicking(false);
      select(c.id);
    } catch (err) {
      console.error(err);
      toast.error(t('chat.startError'));
    }
  };

  const remove = async (c: ConversationRow) => {
    try {
      await deleteConversation(c.id);
      setConvos((prev) => prev.filter((x) => x.id !== c.id));
      if (c.id === activeId) select(null);
    } catch (err) {
      console.error(err);
      toast.error(t('chat.deleteError'));
    }
  };

  const send = async (e?: FormEvent, override?: string) => {
    e?.preventDefault();
    const msg = (override ?? text).trim();
    if (!msg || !active || sending || !canWrite) return;
    const scopeAtSend = voiceScope;
    unlockAudio();
    setSending(true);
    setText('');
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', content: msg, created_at: new Date().toISOString() };
    setMessages((m) => [...m, temp]);
    try {
      if (activeIsCeo) {
        const unlockNotice=isUnlockContinuation(msg);
        let recovered:Awaited<ReturnType<typeof resolveUnlockContinuation>>|null=null;
        if(unlockNotice&&canComputer&&user?.id){
          const controller=new AbortController();
          computerRun.current=controller;setComputerRunning(true);
          try{recovered=await resolveUnlockContinuation(orgId,user.id,msg,lang,controller.signal);}
          finally{if(computerRun.current===controller){computerRun.current=null;setComputerRunning(false);}}
          if(voiceScopeRef.current!==scopeAtSend||controller.signal.aborted)return;
        }
        const proposal=recovered?.recognized&&recovered.proposal?recovered.proposal:parseDirectComputerCommand(msg);
        // A lock-state update never approves a previously pending unrelated job.
        const decision=unlockNotice?null:parseOwnerDecision(msg);
        const pending = pendingComputer.current;
        const computerRequest = !!proposal || isComputerControlRequest(msg) || unlockNotice;
        if (computerRequest || (pending && decision)) {
          const directMessage = (content: string) => {
            const assistant: ChatMessage = { id: `direct-${crypto.randomUUID()}`, role: 'assistant', content, created_at: new Date().toISOString() };
            setMessages((m) => [...m.filter((x) => x.id !== temp.id), temp, assistant]);
          };
          const directResult=async(remote:{reply:string;status?:string;job_id?:string},signal?:AbortSignal)=>{
            let narrative=remote.reply;
            if(remote.job_id&&['done','failed'].includes(remote.status??'')){
              try{
                await journalCeoComputerJob(active.id,remote.job_id,signal);
                if(voiceScopeRef.current!==scopeAtSend)return;
                void reloadList().catch(()=>toast.error(t('chat.loadError')));
              }catch{
                narrative+=lang==='el'?' (Η εργασία υπάρχει στους Υπολογιστές, αλλά δεν καταγράφηκε στο ιστορικό CEO.)'
                  :' (The job remains in Computers, but CEO chat history could not record it.)';
              }
            }
            if(voiceScopeRef.current===scopeAtSend)directMessage(narrative);
          };
          if (!canComputer) {
            pendingComputer.current = null;
            const role = current?.role ?? 'viewer';
            directMessage(lang === 'el'
              ? `Δεν θα το αναθέσω σε agent. Ο έλεγχος υπολογιστή απαιτεί Owner/Admin· ο τρέχων ρόλος σου είναι ${role}.`
              : `I will not delegate this to an agent. Computer control requires Owner/Admin; your current role is ${role}.`);
            return;
          }
          if(unlockNotice&&recovered?.recognized&&!recovered.proposal){
            pendingComputer.current=null;
            directMessage(recovered.reply);return;
          }
          if (decision === 'reject') {
            pendingComputer.current = null;
            directMessage(lang === 'el' ? 'Εντάξει, δεν θα το εκτελέσω.' : 'Okay, I will not run it.');
            return;
          }
          if (computerRequest && (!proposal || decision !== 'approve')) {
            const controller = new AbortController();
            computerRun.current = controller; setComputerRunning(true);
            let readiness;
            try {
              readiness = await prepareDirectComputerCommand(orgId, proposal ?? 'browser_task', lang, controller.signal);
            } finally {
              if (computerRun.current === controller) { computerRun.current = null; setComputerRunning(false); }
            }
            if (voiceScopeRef.current !== scopeAtSend || controller.signal.aborted) return;
            if(readiness.ready&&readiness.ownerFullControl===true&&proposal){
              pendingComputer.current=null;computerRun.current=controller;setComputerRunning(true);
              try{
                const remote=await dispatchDirectComputerCommand(orgId,{...proposal,deviceId:readiness.deviceId,requestId:readiness.requestId,ownerFullControlRequired:true},lang,controller.signal);
                await directResult(remote,controller.signal);
              }finally{if(computerRun.current===controller){computerRun.current=null;setComputerRunning(false);}}
              return;
            }
            pendingComputer.current = readiness.ready && proposal ? { ...proposal, deviceId: readiness.deviceId, requestId: readiness.requestId } : null;
            directMessage(!readiness.ready ? readiness.reply : !proposal ? incompleteComputerReply(lang) : lang === 'el'
              ? `Θα εκτελέσω στο ${readiness.deviceName}: ${proposal.description}. Το εγκρίνεις;`
              : `I will run this on ${readiness.deviceName}: ${proposal.description}. Do you approve?`);
            return;
          }
          const chosen = proposal ?? pending!;
          pendingComputer.current = null;
          const controller = new AbortController();
          computerRun.current = controller; setComputerRunning(true);
          let remote;
          try {
            remote = await dispatchDirectComputerCommand(orgId, chosen, lang, controller.signal);
          } finally {
            if (computerRun.current === controller) { computerRun.current = null; setComputerRunning(false); }
          }
          if (voiceScopeRef.current !== scopeAtSend) return;
          await directResult(remote,controller.signal);
          return;
        }
      }
      const out = await sendChat(active.id, msg, lang, speakOn);
      if (voiceScopeRef.current !== scopeAtSend) return;
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), out.user_message, out.message]);
      void reloadList();
      if (speakOnRef.current) {
        const turn = beginVoiceTurn(); voiceTurn.current = turn;
        void speak(orgId, parseHandoff(out.message.content).text, lang, { turn }).then(result => {
          if (result.status === 'failed' && voiceScopeRef.current === scopeAtSend) toast.error(voiceMessages(lang).playback);
        });
      }
    } catch (err) {
      if (voiceScopeRef.current !== scopeAtSend) return;
      if (err instanceof DOMException && err.name === 'AbortError') {
        setMessages((m) => [...m, { id: `stop-${crypto.randomUUID()}`, role: 'assistant', content: lang === 'el' ? 'Ζητήθηκε Stop. Η τελική κατάσταση θα επιβεβαιωθεί στους Υπολογιστές.' : 'Stop requested. Check Computers for the confirmed final status.', created_at: new Date().toISOString() }]);
        return;
      }
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setText(msg);
      toast.error(runErrorText(t, err));
    } finally {
      if (voiceScopeRef.current === scopeAtSend) setSending(false);
    }
  };

  const toggleSpeak = () => {
    const next = !speakOn;
    speakOnRef.current = next; setSpeakOn(next);
    if (!next) voiceTurn.current?.cancel();
    try {
      localStorage.setItem('firbo.chat.speak', next ? '1' : '0');
    } catch {
      /* the choice just is not remembered */
    }
  };

  const talk = () => {
    if (!canWrite) return;
    if (listening) {
      stopListen.current(); voiceTurn.current?.cancel(); setListening(false); setInterim(''); return;
    }
    const scopeAtListen = voiceScope;
    const turn = beginVoiceTurn(snapshot => {
      if (voiceScopeRef.current === scopeAtListen) setListening(['opening', 'listening', 'transcribing'].includes(snapshot.phase));
    });
    voiceTurn.current = turn;
    const handle = listenSmart(orgId, lang, {
      error: (c: VoiceError | 'server') => { if (voiceScopeRef.current === scopeAtListen && c !== 'no_speech') toast.error(t(`voice.err.${c}` as TKey)); },
      interim: value => { if (voiceScopeRef.current === scopeAtListen) setInterim(value); },
      final: value => {
        if (voiceScopeRef.current !== scopeAtListen) return;
        setListening(false); setInterim(''); if (value) void send(undefined, value);
      },
      end: () => { if (voiceScopeRef.current === scopeAtListen) { setListening(false); setInterim(''); } },
    }, { turn });
    stopListen.current = handle.cancel;
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) void send(e);
  };

  const enabledAgents = useMemo(() => agents.filter((a) => a.enabled), [agents]);

  return (
    <div className="fb-root flex h-full flex-col md:flex-row">
      <aside className="flex max-h-[38%] w-full shrink-0 flex-col border-b md:max-h-none md:w-[280px] md:border-b-0 md:border-e" style={{ borderColor: 'var(--fb-border)' }}>
        <div className="flex items-center justify-between gap-2 p-3 pt-14 md:pt-3">
          <h1 className="text-base font-semibold">{t('chat.title')}</h1>
          {canWrite && (
            <button className="fb-btn fb-btn--primary" style={{ height: 32, padding: '0 10px', fontSize: 13 }} onClick={() => setPicking((v) => !v)}>
              <MessageSquarePlus size={14} /> {t('chat.new')}
            </button>
          )}
        </div>
        {picking && (
          <div className="mx-3 mb-2 rounded-xl p-2" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--fb-border)' }}>
            <div className="fb-eyebrow mb-1.5 px-1">{t('chat.pick')}</div>
            {enabledAgents.length === 0 ? (
              <p className="fb-dim px-1 text-sm">{t('chat.noAgents')}</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto">
                {enabledAgents.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => void start(a)} className="fb-glass--hover flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-start text-sm">
                      <span className="fb-dot" style={{ background: agentColor(a.type, a.slug) }} />
                      <span className="truncate">{nameOf(a)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {convos.map((c) => {
            const a = agentOf(c.agent_id);
            return (
              <li key={c.id} className="group relative">
                <button
                  onClick={() => select(c.id)}
                  className="fb-glass--hover w-full cursor-pointer rounded-xl px-3 py-2 text-start"
                  style={c.id === activeId ? { background: 'rgba(0, 212, 255,.1)', border: '1px solid var(--fb-border-strong)' } : { border: '1px solid transparent' }}
                >
                  <div className="truncate pe-6 text-sm font-medium">{c.title || t('chat.untitled')}</div>
                  <div className="fb-dim flex items-center gap-1.5 text-[11px]">
                    <span className="fb-dot" style={{ background: a ? agentColor(a.type, a.slug) : 'var(--fb-dim)' }} />
                    <span className="truncate">{nameOf(a)}</span> · {fmt.relative(Date.parse(c.updated_at))}
                  </div>
                </button>
                <button
                  aria-label={t('chat.delete')}
                  title={t('chat.delete')}
                  onClick={() => void remove(c)}
                  className="fb-dim absolute end-2 top-2 hidden cursor-pointer rounded p-1 hover:text-white group-hover:block group-focus-within:block"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            );
          })}
          {convos.length === 0 && <li className="fb-dim px-2 text-sm">{t('chat.empty')}</li>}
        </ul>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col">
        {!active ? (
          <div className="grid h-full place-items-center p-6 text-center">
            <div>
              <Wave color="var(--fb-accent)" />
              <h2 className="mt-3 text-lg font-semibold">{t('chat.welcome')}</h2>
              <p className="fb-muted mt-1 max-w-sm text-sm">{t('chat.welcomeText')}</p>
              {canWrite && (
                <button className="fb-btn fb-btn--primary mt-4" onClick={() => setPicking(true)}>
                  <MessageSquarePlus size={15} /> {t('chat.new')}
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-2.5 border-b px-4 py-3" style={{ borderColor: 'var(--fb-border)' }}>
              <span className="fb-dot" style={{ background: activeAgent ? agentColor(activeAgent.type, activeAgent.slug) : 'var(--fb-dim)' }} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{nameOf(activeAgent)}</div>
                <div className="fb-dim truncate text-[11px]">{activeAgent?.model}</div>
              </div>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.length === 0 && <p className="fb-dim text-center text-sm">{t('chat.say', { agent: nameOf(activeAgent) })}</p>}
              {messages.map((m) => {
                const { text: body, ask, task, meet, app } = parseHandoff(m.content);
                const askTo = ask ? agentOf(ask.agentId) : null;
                return (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                    style={m.role === 'user' ? { background: 'rgba(0, 212, 255,.16)', border: '1px solid var(--fb-border-strong)' } : { background: 'rgba(255,255,255,.05)', border: '1px solid var(--fb-border)' }}
                  >
                    {body}
                    {ask && askTo && (
                      <button type="button" className="fb-btn fb-btn--ghost mt-2 flex" onClick={() => setParams(new URLSearchParams({ ask: ask.agentId, q: ask.question }), { replace: false })}>
                        <MessageSquare size={14} /> {copy('aAsk', { name: nameOf(askTo) })}
                      </button>
                    )}
                    {m.role === 'assistant' && (task || meet || app) && <CeoActions task={task} meet={meet} app={app} />}
                  </div>
                </div>
                );
              })}
              {sending && (
                <div className="fb-dim flex items-center gap-2 text-sm" aria-live="polite">
                  <Wave color="var(--fb-accent)" /> {t('chat.thinking', { agent: nameOf(activeAgent) })}
                </div>
              )}
              <div ref={end} />
            </div>
            <form onSubmit={send} className="flex items-end gap-2 border-t p-3" style={{ borderColor: 'var(--fb-border)' }}>
              <textarea
                className="fb-input min-h-[44px] flex-1 resize-none py-2.5"
                rows={2}
                maxLength={4000}
                value={text}
                disabled={!canWrite}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={onKey}
                placeholder={interim || t('chat.placeholder', { agent: nameOf(activeAgent) })}
                aria-label={t('chat.placeholder', { agent: nameOf(activeAgent) })}
              />
              <button type="button" className="fb-btn fb-btn--ghost" style={{ height: 44 }} aria-pressed={speakOn} aria-label={t(speakOn ? 'voice.speakOff' : 'voice.speakOn')} title={t(speakOn ? 'voice.speakOff' : 'voice.speakOn')} onClick={toggleSpeak}>
                {speakOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
              </button>
              {computerRunning && <button type="button" className="fb-btn fb-btn--ghost" style={{ height: 44 }} aria-label={t('ceo.stop')} onClick={() => computerRun.current?.abort()}><Square size={16} /> {t('ceo.stop')}</button>}
              {canTalk ? (
                <button type="button" className="fb-btn fb-btn--ghost" style={{ height: 44, color: listening ? 'var(--fb-accent)' : undefined }} disabled={!canWrite || sending} aria-pressed={listening} aria-label={t(listening ? 'voice.micStop' : 'voice.mic')} title={t(listening ? 'voice.micStop' : 'voice.mic')} onClick={talk}>
                  {listening ? <Square size={16} /> : <Mic size={16} />}
                </button>
              ) : (
                <span className="fb-dim max-w-[120px] text-[10px] leading-tight">{t('voice.err.unsupported')}</span>
              )}
              <button className="fb-btn fb-btn--primary" style={{ height: 44 }} disabled={!text.trim() || sending || !canWrite} aria-label={t('chat.send')}>
                <Send size={16} />
              </button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
