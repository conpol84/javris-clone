import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { MemoryScene } from '../components/scenes/MemoryScene';
import { CompanyMemoryReview } from '../components/company/CompanyMemoryReview';
import { agentLabel } from '../lib/company/labels';
import { agentColor } from '../lib/company/status';
import { listAgents } from '../lib/company/data';
import { useI18n } from '../i18n/I18nProvider';
import { notifyPlanLimit } from '../lib/company/limits';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { addMemory, deleteMemory, listMemories, MEMORY_COLORS, MEMORY_FILE_MAX_BYTES, MEMORY_TYPES, memoriesReadBy, splitIntoNotes, type MemoryRow, type MemoryType } from '../lib/company/memory';
import { MANAGER_ROLES, WRITER_ROLES, type AgentRow } from '../lib/company/types';
import { PageHeader } from '../components/ui/kit';
import '../styles/firbo.css';

/** What the company knows: a 3D constellation of memories every AI employee can draw on. */
export function MemoryPage() {
  const { current, user } = useCompanyAuth();
  return <MemoryWorkspace key={`${user?.id ?? ''}:${current?.organization.id ?? ''}:${current?.role ?? ''}`} />;
}

/** Identity changes discard old drafts and invalidate their asynchronous work. */
export function MemoryWorkspace() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const canDelete = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [textAgent, setTextAgent] = useState('');
  const [type, setType] = useState<MemoryType>('instruction');
  const [importance, setImportance] = useState(0.7);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);
  const [fileAgent, setFileAgent] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  const operation = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loadVersion.current++; }; }, []);

  const load = useCallback(async () => {
    if (!orgId || !user || !alive.current) return;
    const version = ++loadVersion.current;
    setLoaded(false);
    try {
      const [rows, employees] = await Promise.all([listMemories(orgId), listAgents(orgId)]);
      if (!alive.current || version !== loadVersion.current) return;
      setItems(rows); setAgents(employees); setLoadError(false);
    } catch (err) {
      if (!alive.current || version !== loadVersion.current) return;
      console.error(err);
      setLoadError(true);
      toast.error(t('chat.loadError'));
    } finally {
      if (alive.current && version === loadVersion.current) setLoaded(true);
    }
  }, [orgId, user, t]);
  useEffect(() => {
    void load();
  }, [load]);

  const types = useMemo(() => [...new Set(items.map((m) => m.memory_type))], [items]);
  const stars = useMemo(() => items.map((m) => ({ id: m.id, type: m.memory_type, importance: m.importance, color: MEMORY_COLORS[m.memory_type] ?? '#94a3b8' })), [items]);
  const chosen = items.find((m) => m.id === selected) ?? null;
  const sceneAgents = useMemo(() => agents.filter((a) => a.enabled).map((a) => ({ id: a.id, name: agentLabel(a, i18n).name.replace(' Agent', ''), color: agentColor(a.type, a.slug) })), [agents, i18n]);
  const readList = useMemo(() => (activeAgent ? memoriesReadBy(activeAgent, items) : []), [activeAgent, items]);
  const readIds = useMemo(() => new Set(readList.map((m) => m.id)), [readList]);
  const activeName = sceneAgents.find((a) => a.id === activeAgent)?.name ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!alive.current || !canWrite || !orgId || !user || !text.trim() || busy || fileBusy || operation.current || !loaded || loadError) return;
    if (textAgent && !agents.some(a => a.id === textAgent && a.enabled)) return;
    operation.current = true;
    setBusy(true);
    try {
      await addMemory(orgId, user.id, { content: text, type, importance, agentId: textAgent || null });
      if (!alive.current) return;
      setText('');
      toast.success(t('mem.added'));
      await load();
    } catch (err) {
      if (!alive.current) return;
      console.error(err);
      if (!notifyPlanLimit(err, t as never)) toast.error(t('mem.error'));
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const uploadFile = async (file: File) => {
    if (!alive.current || !canWrite || !user || !orgId || busy || fileBusy || operation.current || !loaded || loadError) return;
    if (fileAgent && !agents.some(a => a.id === fileAgent && a.enabled)) return;
    if (file.size > MEMORY_FILE_MAX_BYTES || !/\.(txt|md|markdown|csv|json)$/i.test(file.name)) return void toast.error(t('mem.uploadBad'));
    operation.current = true;
    setFileBusy(true);
    let done = 0;
    let total = 0;
    try {
      const notes = splitIntoNotes(await file.text());
      if (!alive.current) return;
      total = notes.length;
      if (!total) return void toast.error(t('mem.uploadEmpty'));
      for (const note of notes) {
        if (!alive.current) return;
        await addMemory(orgId, user.id, { content: note, type: 'fact', importance, agentId: fileAgent || null });
        done++;
      }
      if (!alive.current) return;
      toast.success(t('mem.uploadDone', { count: done }));
    } catch (err) {
      if (!alive.current) return;
      console.error(err);
      if (!notifyPlanLimit(err, t as never)) toast.error(t('mem.error'));
      if (done > 0) toast.message(t('mem.uploadPartial', { done, total }));
    } finally {
      operation.current = false;
      if (alive.current) { setFileBusy(false); await load(); }
    }
  };

  const remove = async (m: MemoryRow) => {
    if (!alive.current || !canDelete || !orgId || !user || busy || fileBusy || operation.current || !loaded || loadError || !items.some(row => row.id === m.id)) return;
    operation.current = true; setBusy(true);
    try {
      await deleteMemory(orgId, m.id);
      if (!alive.current) return;
      if (selected === m.id) setSelected(null);
      await load();
    } catch (err) {
      if (!alive.current) return;
      console.error(err);
      toast.error(t('mem.error'));
    } finally {
      operation.current = false;
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
    <div className="fb-wide mx-auto px-4 pb-10 pt-14 md:px-8 md:pt-8">
      <PageHeader eyebrow={t('mem.eyebrow')} title={t('mem.title')} sub={t('mem.intro')} />
      {loadError && <div role="alert" className="fb-muted mb-4 text-sm">{t('chat.loadError')} <button className="fb-link" onClick={() => void load()}>{t('common.retry')}</button></div>}
      <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="fb-glass relative overflow-hidden" style={{ minHeight: 520 }}>
          <div className="absolute inset-0">
            <MemoryScene stars={stars} types={types} selected={selected} onSelect={setSelected} agents={sceneAgents} activeAgent={activeAgent} onPickAgent={setActiveAgent} readIds={readIds} labels={{ noWebgl: t('office.noWebgl') }} />
          </div>
          {!loaded && <div role="status" className="fb-muted absolute inset-0 grid place-items-center p-6 text-center text-sm">{t('common.loading')}</div>}
          {loaded && !loadError && items.length === 0 && <div className="fb-muted absolute inset-0 grid place-items-center p-6 text-center text-sm">{t('mem.empty')}</div>}
          <div className="absolute bottom-3 start-3 flex flex-wrap gap-1.5">
            {types.map((k) => (
              <span key={k} className="fb-chip">
                <span className="fb-dot" style={{ background: MEMORY_COLORS[k] }} /> {t(`mem.type.${k}` as TKey)}
              </span>
            ))}
          </div>
        </section>
        <section className="fb-glass fb-col gap-4 p-5">
          <div className="fb-col gap-2 pb-4" style={{ borderBottom: '1px solid var(--fb-border)' }}>
            <div className="fb-eyebrow">{t('mem.readers')}</div>
            <div className="flex flex-wrap gap-1.5">
              {sceneAgents.map((a) => (
                <button key={a.id} className="fb-chip cursor-pointer" aria-pressed={activeAgent === a.id} onClick={() => setActiveAgent(activeAgent === a.id ? null : a.id)} style={activeAgent === a.id ? { color: a.color, borderColor: a.color } : undefined}>
                  {a.name}
                </button>
              ))}
            </div>
            <p className="fb-dim text-xs">{activeAgent ? t('mem.readsCount', { name: activeName, count: readList.length }) : t('mem.readersHint')}</p>
          </div>
          {chosen ? (
            <div className="fb-row fb-col gap-2 p-3">
              <div className="flex items-center gap-2">
                <span className="fb-chip" style={{ color: MEMORY_COLORS[chosen.memory_type] }}>{t(`mem.type.${chosen.memory_type}` as TKey)}</span>
                <span className="fb-dim text-xs">{t('mem.importance')}: {Math.round(chosen.importance * 100)}%</span>
                <span className="fb-dim ms-auto text-xs">{fmt.date(chosen.created_at)}</span>
              </div>
              <p className="text-sm leading-relaxed">{chosen.content}</p>
              {canDelete && (
                <button className="fb-btn fb-btn--ghost self-start" disabled={busy || fileBusy || !loaded || loadError} onClick={() => void remove(chosen)}>
                  <Trash2 size={14} /> {t('mem.delete')}
                </button>
              )}
            </div>
          ) : (
            <p className="fb-dim text-sm">{t('mem.pick')}</p>
          )}
          {canWrite && (
            <form onSubmit={submit} className="fb-col gap-3 pt-4" style={{ borderTop: '1px solid var(--fb-border)' }}>
              <div className="fb-eyebrow">{t('mem.add')}</div>
              <textarea className="fb-input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mem.placeholder')} aria-label={t('mem.placeholder')} />
              <div className="flex flex-wrap items-center gap-2">
                <select className="fb-input" value={textAgent} onChange={(e) => setTextAgent(e.target.value)} aria-label={t('mem.uploadFor')}>
                  <option value="">{t('mem.uploadEveryone')}</option>
                  {agents.filter((a) => a.enabled).map((a) => (
                    <option key={a.id} value={a.id}>{agentLabel(a, i18n).name}</option>
                  ))}
                </select>
                <select className="fb-input" value={type} onChange={(e) => setType(e.target.value as MemoryType)} aria-label={t('mem.typeLabel')}>
                  {MEMORY_TYPES.map((k) => (
                    <option key={k} value={k}>{t(`mem.type.${k}` as TKey)}</option>
                  ))}
                </select>
                <label className="fb-muted flex items-center gap-2 text-xs">
                  {t('mem.importance')}
                  <input type="range" min={0.1} max={1} step={0.1} value={importance} onChange={(e) => setImportance(Number(e.target.value))} />
                </label>
                <button className="fb-btn fb-btn--primary ms-auto" type="submit" disabled={busy || fileBusy || !loaded || loadError || !text.trim()}>
                  {t('mem.save')}
                </button>
              </div>
              <p className="fb-dim text-xs">{t('mem.note')}</p>
              <div className="fb-col gap-2 pt-3" style={{ borderTop: '1px solid var(--fb-border)' }}>
                <div className="fb-eyebrow">{t('mem.upload')}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <select className="fb-input" value={fileAgent} onChange={(e) => setFileAgent(e.target.value)} aria-label={t('mem.uploadFor')}>
                    <option value="">{t('mem.uploadEveryone')}</option>
                    {agents.filter((a) => a.enabled).map((a) => (
                      <option key={a.id} value={a.id}>{agentLabel(a, i18n).name}</option>
                    ))}
                  </select>
                  <label className={`fb-btn ${fileBusy ? 'opacity-60' : 'cursor-pointer'}`}>
                    {fileBusy ? t('common.loading') : t('mem.upload')}
                    <input
                      type="file"
                      accept=".txt,.md,.markdown,.csv,.json,text/plain,text/markdown,text/csv,application/json"
                      className="sr-only"
                      disabled={busy || fileBusy || !loaded || loadError}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = '';
                        if (f) void uploadFile(f);
                      }}
                    />
                  </label>
                </div>
                <p className="fb-dim text-xs">{t('mem.uploadHint')}</p>
              </div>
            </form>
          )}
        </section>
      </div>
      {['owner','admin'].includes(current?.role??'')&&orgId&&(
        <div className="mt-6">
          <CompanyMemoryReview orgId={orgId}/>
        </div>
      )}
    </div>
    </div>
  );
}

