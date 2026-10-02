import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { MemoryScene } from '../components/scenes/MemoryScene';
import { agentLabel } from '../lib/company/labels';
import { agentColor } from '../lib/company/status';
import { listAgents } from '../lib/company/data';
import { useI18n } from '../i18n/I18nProvider';
import { notifyPlanLimit } from '../lib/company/limits';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { addMemory, deleteMemory, listMemories, MEMORY_COLORS, MEMORY_TYPES, memoriesReadBy, type MemoryRow, type MemoryType } from '../lib/company/memory';
import { MANAGER_ROLES, WRITER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

/** What the company knows: a 3D constellation of memories every AI employee can draw on. */
export function MemoryPage() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const canDelete = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [items, setItems] = useState<MemoryRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [type, setType] = useState<MemoryType>('instruction');
  const [importance, setImportance] = useState(0.7);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [activeAgent, setActiveAgent] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orgId) return;
    try {
      setItems(await listMemories(orgId));
    } catch (err) {
      console.error(err);
      toast.error(t('chat.loadError'));
    } finally {
      setLoaded(true);
    }
  }, [orgId, t]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!orgId) return;
    listAgents(orgId).then(setAgents).catch(() => undefined);
  }, [orgId]);

  const types = useMemo(() => [...new Set(items.map((m) => m.memory_type))], [items]);
  const stars = useMemo(() => items.map((m) => ({ id: m.id, type: m.memory_type, importance: m.importance, color: MEMORY_COLORS[m.memory_type] ?? '#94a3b8' })), [items]);
  const chosen = items.find((m) => m.id === selected) ?? null;
  const sceneAgents = useMemo(() => agents.filter((a) => a.enabled).map((a) => ({ id: a.id, name: agentLabel(a, i18n).name.replace(' Agent', ''), color: agentColor(a.type, a.slug) })), [agents, i18n]);
  const readList = useMemo(() => (activeAgent ? memoriesReadBy(activeAgent, items) : []), [activeAgent, items]);
  const readIds = useMemo(() => new Set(readList.map((m) => m.id)), [readList]);
  const activeName = sceneAgents.find((a) => a.id === activeAgent)?.name ?? '';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !text.trim() || busy) return;
    setBusy(true);
    try {
      await addMemory(orgId, user.id, { content: text, type, importance });
      setText('');
      toast.success(t('mem.added'));
      await load();
    } catch (err) {
      console.error(err);
      if (!notifyPlanLimit(err, t as never)) toast.error(t('mem.error'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: MemoryRow) => {
    try {
      await deleteMemory(m.id);
      if (selected === m.id) setSelected(null);
      await load();
    } catch (err) {
      console.error(err);
      toast.error(t('mem.error'));
    }
  };

  return (
    <div className="fb-root fb-col gap-4 p-4 lg:p-6" style={{ minHeight: '100%' }}>
      <header>
        <div className="fb-eyebrow">{t('mem.eyebrow')}</div>
        <h1 className="fb-grad-text text-2xl font-semibold">{t('mem.title')}</h1>
        <p className="fb-muted mt-1 max-w-2xl text-sm">{t('mem.intro')}</p>
      </header>
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <section className="fb-glass relative overflow-hidden" style={{ minHeight: 440 }}>
          <div className="absolute inset-0">
            <MemoryScene stars={stars} types={types} selected={selected} onSelect={setSelected} agents={sceneAgents} activeAgent={activeAgent} onPickAgent={setActiveAgent} readIds={readIds} labels={{ noWebgl: t('office.noWebgl') }} />
          </div>
          {loaded && items.length === 0 && <div className="fb-muted absolute inset-0 grid place-items-center p-6 text-center text-sm">{t('mem.empty')}</div>}
          <div className="absolute bottom-3 start-3 flex flex-wrap gap-1.5">
            {types.map((k) => (
              <span key={k} className="fb-chip">
                <span className="fb-dot" style={{ background: MEMORY_COLORS[k] }} /> {t(`mem.type.${k}` as TKey)}
              </span>
            ))}
          </div>
        </section>
        <section className="fb-glass fb-col gap-3 p-4">
          <div className="fb-col gap-2">
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
                <button className="fb-btn fb-btn--ghost self-start" onClick={() => void remove(chosen)}>
                  <Trash2 size={14} /> {t('mem.delete')}
                </button>
              )}
            </div>
          ) : (
            <p className="fb-dim text-sm">{t('mem.pick')}</p>
          )}
          {canWrite && (
            <form onSubmit={submit} className="fb-col gap-2">
              <div className="fb-eyebrow">{t('mem.add')}</div>
              <textarea className="fb-input" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t('mem.placeholder')} aria-label={t('mem.placeholder')} />
              <div className="flex flex-wrap items-center gap-2">
                <select className="fb-input" value={type} onChange={(e) => setType(e.target.value as MemoryType)} aria-label={t('mem.typeLabel')}>
                  {MEMORY_TYPES.map((k) => (
                    <option key={k} value={k}>{t(`mem.type.${k}` as TKey)}</option>
                  ))}
                </select>
                <label className="fb-muted flex items-center gap-2 text-xs">
                  {t('mem.importance')}
                  <input type="range" min={0.1} max={1} step={0.1} value={importance} onChange={(e) => setImportance(Number(e.target.value))} />
                </label>
                <button className="fb-btn fb-btn--primary ms-auto" type="submit" disabled={busy || !text.trim()}>
                  {t('mem.save')}
                </button>
              </div>
              <p className="fb-dim text-xs">{t('mem.note')}</p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
