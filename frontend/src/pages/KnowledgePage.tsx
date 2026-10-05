import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BookOpen, Globe, Link2, RefreshCw, Search, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { MANAGER_ROLES } from '../lib/company/types';
import { listIntegrations, type IntegrationRow } from '../lib/company/integrations';
import { addKnowledgeApp, addKnowledgeText, addKnowledgeUrl, deleteKnowledge, listKnowledge, READABLE_APPS, searchKnowledge, syncKnowledge, type KnowledgeHit, type KnowledgeSource } from '../lib/company/workspace';
import { useWorkspaceCopy, type WorkspaceKey } from '../lib/company/workspaceCopy';
import { EmptyState, PageHeader, Pill } from '../components/ui/kit';
import '../styles/firbo.css';

const FILE_MAX = 400_000;
const ERRORS: Record<string, WorkspaceKey> = { plan_limit: 'kLimit', bad_url: 'kBadUrl', too_short: 'kTooShort', forbidden: 'kManagersOnly' };

/** The company's own documents, links and connected apps, which every AI employee searches before answering. */
export function KnowledgePage() {
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  // Changing company remounts all drafts, search results and source/app lists.
  return <KnowledgeWorkspace key={orgId} orgId={orgId} canManage={canManage} />;
}

export function KnowledgeWorkspace({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const c = useWorkspaceCopy();
  const active = useRef(true);
  const operation = useRef(false);
  const loadVersion = useRef(0);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [apps, setApps] = useState<IntegrationRow[]>([]);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [url, setUrl] = useState('');
  const [app, setApp] = useState('');
  const [busy, setBusy] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<KnowledgeHit[] | null>(null);

  useEffect(() => {
    active.current = true;
    return () => { active.current = false; loadVersion.current++; };
  }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    const version = ++loadVersion.current;
    try {
      const rows = await listKnowledge(orgId);
      if (active.current && version === loadVersion.current) setSources(rows);
    } catch { if (active.current && version === loadVersion.current) toast.error(c('kErr')); }
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let cancelled = false;
    if (orgId) listIntegrations(orgId).then(rows => { if (!cancelled && active.current) setApps(rows); })
      .catch(() => { if (!cancelled && active.current) toast.error(c('kErr')); });
    return () => { cancelled = true; };
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps

  const readable = useMemo(() => apps.filter(a => (READABLE_APPS as readonly string[]).includes(a.kind)), [apps]);
  const fail = (err: unknown) => toast.error(c(ERRORS[err instanceof Error ? err.message : ''] ?? 'kErr'));
  const run = async (key: string, job: () => Promise<unknown>, reset?: () => void) => {
    if (!active.current || !orgId || !canManage || operation.current) return;
    operation.current = true;
    setBusy(key);
    try {
      await job();
      if (!active.current) return;
      reset?.(); toast.success(c('kSaved')); await load();
    } catch (err) {
      if (active.current) { fail(err); await load(); }
    } finally { operation.current = false; if (active.current) setBusy(''); }
  };

  const addText = (e: FormEvent) => { e.preventDefault(); void run('text', () => addKnowledgeText(orgId, name.trim(), text), () => { setName(''); setText(''); }); };
  const addFile = async (file: File) => {
    if (file.size > FILE_MAX || !/\.(txt|md|markdown|csv|json)$/i.test(file.name)) return void toast.error(c('kTooShort'));
    try {
      const body = await file.text();
      if (active.current) void run('file', () => addKnowledgeText(orgId, file.name.slice(0, 120), body, true));
    } catch (err) { if (active.current) fail(err); }
  };
  const addUrl = (e: FormEvent) => { e.preventDefault(); void run('url', () => addKnowledgeUrl(orgId, url.trim()), () => setUrl('')); };
  const addApp = (e: FormEvent) => { e.preventDefault(); if (app) void run('app', () => addKnowledgeApp(orgId, app), () => setApp('')); };
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || !orgId || !active.current || operation.current) return;
    operation.current = true;
    setBusy('search');
    try {
      const result = await searchKnowledge(orgId, query.trim());
      if (active.current) setHits(result.results);
    } catch (err) { if (active.current) fail(err); }
    finally { operation.current = false; if (active.current) setBusy(''); }
  };
  const tone = (s: KnowledgeSource) => (s.status === 'failed' ? 'err' : s.status === 'ready' ? 'ok' : 'warn');

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="fb-wide mx-auto px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader eyebrow={c('kEyebrow')} title={c('kTitle')} sub={c('kSub')} />
        <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="fb-col gap-4">
            {canManage ? (
              <>
                <form onSubmit={addText} className="fb-glass fb-col gap-2 p-4">
                  <div className="fb-eyebrow flex items-center gap-1.5"><BookOpen size={13} /> {c('kAddText')}</div>
                  <input className="fb-input" value={name} onChange={e => setName(e.target.value)} placeholder={c('kName')} maxLength={120} />
                  <textarea className="fb-input min-h-[120px] py-2" value={text} onChange={e => setText(e.target.value)} placeholder={c('kText')} />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="fb-btn fb-btn--ghost cursor-pointer">
                      <Upload size={14} /> <span className="text-[12px]">{c('kFile')}</span>
                      <input type="file" accept=".txt,.md,.markdown,.csv,.json" className="hidden" disabled={busy !== ''} onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void addFile(f); }} />
                    </label>
                    <button className="fb-btn fb-btn--primary" disabled={busy !== '' || !name.trim() || text.trim().length < 20}>{c('kAdd')}</button>
                  </div>
                </form>
                <form onSubmit={addUrl} className="fb-glass fb-col gap-2 p-4">
                  <div className="fb-eyebrow flex items-center gap-1.5"><Globe size={13} /> {c('kAddUrl')}</div>
                  <div className="flex gap-2">
                    <input className="fb-input flex-1" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://" inputMode="url" />
                    <button className="fb-btn fb-btn--primary" disabled={busy !== '' || !/^https?:\/\/\S+$/.test(url.trim())}>{c('kAdd')}</button>
                  </div>
                </form>
                <form onSubmit={addApp} className="fb-glass fb-col gap-2 p-4">
                  <div className="fb-eyebrow flex items-center gap-1.5"><Link2 size={13} /> {c('kApp')}</div>
                  {readable.length ? (
                    <div className="flex gap-2">
                      <select className="fb-input flex-1" value={app} onChange={e => setApp(e.target.value)}>
                        <option value="">—</option>
                        {readable.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <button className="fb-btn fb-btn--primary" disabled={busy !== '' || !app}>{c('kAdd')}</button>
                    </div>
                  ) : <p className="fb-dim text-[13px]">{c('kAppNone')}</p>}
                </form>
              </>
            ) : <p className="fb-glass fb-dim p-4 text-[13px]">{c('kManagersOnly')}</p>}
            <form onSubmit={search} className="fb-glass fb-col gap-2 p-4">
              <div className="fb-eyebrow flex items-center gap-1.5"><Search size={13} /> {c('kSearch')}</div>
              <div className="flex gap-2">
                <input className="fb-input flex-1" value={query} onChange={e => setQuery(e.target.value)} placeholder={c('kSearchPh')} />
                <button className="fb-btn fb-btn--ghost" disabled={busy !== '' || !query.trim()}><Search size={14} /></button>
              </div>
              {hits && (hits.length ? (
                <ol className="fb-col gap-2">
                  {hits.map((h, i) => (
                    <li key={i} className="rounded-lg border border-white/10 p-2 text-[13px]">
                      <div className="font-medium">{h.url ? <a className="fb-link underline" href={h.url} target="_blank" rel="noopener noreferrer nofollow">{h.title}</a> : h.title}</div>
                      <div className="fb-dim mt-1 line-clamp-4">{h.content}</div>
                    </li>
                  ))}
                </ol>
              ) : <p className="fb-dim text-[13px]">{c('kNoHits')}</p>)}
            </form>
          </div>
          <section className="fb-glass p-4">
            <div className="fb-eyebrow mb-2">{c('kSources')}</div>
            {sources.length === 0 ? <EmptyState icon={<BookOpen size={20} />} title={c('kEmpty')} /> : (
              <ul className="fb-col gap-2">
                {sources.map(s => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13.5px] font-medium" title={s.name}>{s.name}</div>
                      <div className="fb-dim flex flex-wrap items-center gap-2 text-[12px]">
                        <span>{s.type}</span>
                        {s.item_count != null && <span>{c('kItems', { n: s.item_count })}</span>}
                        {s.last_error && <span className="text-rose-300" title={s.last_error}>{s.last_error.slice(0, 60)}</span>}
                      </div>
                    </div>
                    <Pill tone={tone(s)}>{s.status}</Pill>
                    {canManage && s.type !== 'text' && s.type !== 'upload' && (
                      <button className="fb-btn fb-btn--ghost" title={c('kSync')} aria-label={c('kSync')} disabled={busy !== ''} onClick={() => run(`sync-${s.id}`, () => syncKnowledge(s.id))}><RefreshCw size={14} /></button>
                    )}
                    {canManage && (
                      <button className="fb-btn fb-btn--ghost" title={c('kDelete')} aria-label={c('kDelete')} disabled={busy !== ''} onClick={() => run(`del-${s.id}`, () => deleteKnowledge(s.id))}><Trash2 size={14} /></button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
