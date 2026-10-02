import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router';
import { MessageSquarePlus, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Wave } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createConversation, deleteConversation, listAgents, listConversations, listMessages, type ConversationRow } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { RunError, sendChat, type ChatMessage } from '../lib/company/runner';
import { agentColor } from '../lib/company/status';
import { WRITER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

/** Continuous chat with any AI employee, with saved history. */
export function AgentChatPage() {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [convos, setConvos] = useState<ConversationRow[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const activeId = params.get('c');
  const active = convos.find((c) => c.id === activeId) ?? null;
  const agentOf = useCallback((id: string | null) => agents.find((a) => a.id === id) ?? null, [agents]);
  const nameOf = (a: AgentRow | null) => (a ? agentLabel(a, i18n).name : t('unassigned'));
  const activeAgent = agentOf(active?.agent_id ?? null);

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

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const msg = text.trim();
    if (!msg || !active || sending) return;
    setSending(true);
    setText('');
    const temp: ChatMessage = { id: `tmp-${Date.now()}`, role: 'user', content: msg, created_at: new Date().toISOString() };
    setMessages((m) => [...m, temp]);
    try {
      const out = await sendChat(active.id, msg, lang);
      setMessages((m) => [...m.filter((x) => x.id !== temp.id), out.user_message, out.message]);
      void reloadList();
    } catch (err) {
      setMessages((m) => m.filter((x) => x.id !== temp.id));
      setText(msg);
      toast.error(t(`run.err.${err instanceof RunError ? err.code : 'unknown'}` as TKey));
    } finally {
      setSending(false);
    }
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
                  style={c.id === activeId ? { background: 'rgba(34,211,238,.1)', border: '1px solid var(--fb-border-strong)' } : { border: '1px solid transparent' }}
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
              {messages.map((m) => (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                    style={m.role === 'user' ? { background: 'rgba(34,211,238,.16)', border: '1px solid var(--fb-border-strong)' } : { background: 'rgba(255,255,255,.05)', border: '1px solid var(--fb-border)' }}
                  >
                    {m.content}
                  </div>
                </div>
              ))}
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
                placeholder={t('chat.placeholder', { agent: nameOf(activeAgent) })}
                aria-label={t('chat.placeholder', { agent: nameOf(activeAgent) })}
              />
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
