import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Copy, Pencil, Play, Plus, Trash2, Webhook, Workflow as WorkflowIcon, X } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n/I18nProvider';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { notifyPlanLimit } from '../lib/company/limits';
import { MANAGER_ROLES, WRITER_ROLES, type AgentRow } from '../lib/company/types';
import { deleteWorkflow, listWorkflowRuns, listWorkflows, saveWorkflow, startWorkflow, workflowHook, type WorkflowRow, type WorkflowRunRow, type WorkflowStep, type WorkflowTrigger } from '../lib/company/workspace';
import { useWorkspaceCopy } from '../lib/company/workspaceCopy';
import { WORKFLOW_MESSAGES, workflowFailure } from '../lib/company/workflowCopy';
import { EmptyState, PageHeader, Pill, Segmented } from '../components/ui/kit';
import '../styles/firbo.css';

type Cadence = 'hourly' | 'daily' | 'weekly';
interface Draft { id?: string; expectedRevision?: number; name: string; description: string; trigger: WorkflowTrigger; cadence: Cadence; time: string; weekday: number; enabled: boolean; steps: WorkflowStep[] }
const blank = (): Draft => ({ name: '', description: '', trigger: 'manual', cadence: 'daily', time: '09:00', weekday: 1, enabled: true, steps: [{ position: 0, agent_id: null, action: '' }] });
const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

/** Chains of AI employees: each step's result feeds the next. Started by hand, on a schedule or from another app. */
export function WorkflowsPage() {
  const { current, user } = useCompanyAuth();
  return <WorkflowWorkspace key={`${user?.id ?? ''}:${current?.organization.id ?? ''}:${current?.role ?? ''}`} />;
}

export function WorkflowWorkspace() {
  const c = useWorkspaceCopy();
  const i18n = useI18n();
  const messages = WORKFLOW_MESSAGES[i18n.lang];
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const canRun = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const [flows, setFlows] = useState<WorkflowRow[]>([]);
  const [runs, setRuns] = useState<WorkflowRunRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [hook, setHook] = useState<{ id: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loadVersion.current++; }; }, []);

  const load = useCallback(async () => {
    if (!orgId) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [f, r, a] = await Promise.all([listWorkflows(orgId), listWorkflowRuns(orgId), listAgents(orgId)]);
      if (!alive.current || version !== loadVersion.current) return;
      setFlows(f); setRuns(r); setAgents(a.filter(x => x.enabled)); setLoadError(false);
    } catch {
      if (alive.current && version === loadVersion.current) setLoadError(true);
    } finally {
      if (alive.current && version === loadVersion.current) setLoading(false);
    }
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  // Runs move on the server every minute: refresh while any is running.
  useEffect(() => {
    if (!runs.some(r => r.status === 'running')) return;
    const timer = setInterval(() => void load(), 15_000);
    return () => clearInterval(timer);
  }, [runs, load]);

  const name = (id: string | null) => { const a = agents.find(x => x.id === id); return a ? agentLabel(a, i18n).name : '—'; };
  const flowName = useMemo(() => new Map(flows.map(f => [f.id, f.name])), [flows]);
  const act = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await job(); if (!alive.current) return false; if (done) toast.success(done); await load(); return true; }
    catch (err) { if (alive.current && !notifyPlanLimit(err, i18n.t as never)) toast.error(workflowFailure(i18n.lang, err)); return false; }
    finally { if (alive.current) setBusy(false); }
  };

  const edit = (w: WorkflowRow) => {
    const cfg = w.trigger_config ?? {};
    setDraft({ id: w.id, expectedRevision: w.revision, name: w.name, description: w.description ?? '', trigger: w.trigger_type, cadence: (cfg.cadence as Cadence) ?? 'daily',
      time: `${String(cfg.hour ?? 9).padStart(2, '0')}:${String(cfg.minute ?? 0).padStart(2, '0')}`, weekday: cfg.weekday ?? 1, enabled: w.enabled,
      steps: (w.workflow_steps ?? []).length ? w.workflow_steps!.map(s => ({ ...s })) : blank().steps });
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft || !user) return;
    const steps = draft.steps.filter(s => s.agent_id && s.action.trim());
    if (!draft.name.trim() || !steps.length) return void toast.error(c('wNoSteps'));
    const [hour, minute] = draft.time.split(':').map(Number);
    const ok = await act(() => saveWorkflow(orgId, user.id, {
      id: draft.id, expectedRevision: draft.expectedRevision, name: draft.name.trim(), description: draft.description, enabled: draft.enabled, steps,
      trigger_type: draft.trigger,
      trigger_config: draft.trigger === 'schedule' ? { cadence: draft.cadence, hour, minute, weekday: draft.weekday, tz: tz() } : {},
    }), c('wSaved'));
    if (ok) setDraft(null);
  };
  const setStep = (i: number, patch: Partial<WorkflowStep>) => setDraft(d => d && { ...d, steps: d.steps.map((s, n) => (n === i ? { ...s, ...patch } : s)) });
  const status = (r: WorkflowRunRow) => (r.status === 'completed' ? c('wCompleted') : r.status === 'failed' ? c('wFailed') : c('wRunning'));

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="fb-wide mx-auto px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader eyebrow={c('wEyebrow')} title={c('wTitle')} sub={c('wSub')}
          right={canManage && !draft ? <button className="fb-btn fb-btn--primary" disabled={busy || loading || loadError} onClick={() => setDraft(blank())}><Plus size={14} /> {c('wNew')}</button> : undefined} />
        {loading && <p role="status" className="fb-dim mb-3 text-sm">{i18n.t('common.loading')}</p>}
        {loadError && <div role="alert" className="fb-glass mb-4 p-4"><p>{messages.load}</p><button className="fb-btn fb-btn--ghost mt-2" disabled={loading} onClick={() => void load()}>{messages.retry}</button></div>}
        {draft && (
          <form onSubmit={save} className="fb-glass fb-col mb-4 gap-3 p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <input className="fb-input" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} placeholder={c('wName')} maxLength={120} />
              <input className="fb-input" value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })} placeholder={c('wDesc')} maxLength={500} />
            </div>
            <div className="fb-eyebrow">{c('wSteps')}</div>
            <ol className="fb-col gap-2">
              {draft.steps.map((s, i) => (
                <li key={i} className="flex flex-wrap items-start gap-2 rounded-lg border border-white/10 p-2">
                  <span className="fb-chip">{c('wStep', { n: i + 1 })}</span>
                  <select className="fb-input fb-w-select" value={s.agent_id ?? ''} onChange={e => setStep(i, { agent_id: e.target.value || null })} aria-label={c('wAgent')}>
                    <option value="">{c('wAgent')}</option>
                    {agents.map(a => <option key={a.id} value={a.id}>{agentLabel(a, i18n).name}</option>)}
                  </select>
                  <textarea className="fb-input min-h-[60px] flex-1 py-2" value={s.action} onChange={e => setStep(i, { action: e.target.value })} placeholder={c('wStepPh')} maxLength={3000} />
                  {draft.steps.length > 1 && <button type="button" className="fb-btn fb-btn--ghost" aria-label={c('wDelete')} onClick={() => setDraft({ ...draft, steps: draft.steps.filter((_, n) => n !== i) })}><X size={14} /></button>}
                </li>
              ))}
            </ol>
            {draft.steps.length < 8 && <button type="button" className="fb-btn fb-btn--ghost self-start" onClick={() => setDraft({ ...draft, steps: [...draft.steps, { position: draft.steps.length, agent_id: null, action: '' }] })}><Plus size={14} /> {c('wAddStep')}</button>}
            <div className="fb-eyebrow">{c('wTrigger')}</div>
            <Segmented value={draft.trigger} onChange={v => setDraft({ ...draft, trigger: v })} options={[{ id: 'manual', label: c('wManual') }, { id: 'schedule', label: c('wSchedule') }, { id: 'webhook', label: c('wWebhook') }]} />
            {draft.trigger === 'schedule' && (
              <div className="flex flex-wrap items-center gap-2">
                <select className="fb-input fb-w-select" value={draft.cadence} onChange={e => setDraft({ ...draft, cadence: e.target.value as Cadence })}>
                  <option value="hourly">{c('wHourly')}</option><option value="daily">{c('wDaily')}</option><option value="weekly">{c('wWeekly')}</option>
                </select>
                {draft.cadence === 'weekly' && (
                  <select className="fb-input fb-w-select" value={draft.weekday} onChange={e => setDraft({ ...draft, weekday: Number(e.target.value) })}>
                    {[1, 2, 3, 4, 5, 6, 0].map(d => <option key={d} value={d}>{new Intl.DateTimeFormat(i18n.lang, { weekday: 'long' }).format(new Date(Date.UTC(2024, 0, 7 + d)))}</option>)}
                  </select>
                )}
                <span className="fb-dim text-[13px]">{c('wAt')}</span>
                <input type="time" className="fb-input w-32" value={draft.time} onChange={e => setDraft({ ...draft, time: e.target.value })} />
                <span className="fb-dim text-[12px]">{tz()}</span>
              </div>
            )}
            <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} /> {c('wActive')}</label>
            <div className="flex justify-end gap-2">
              <button type="button" className="fb-btn fb-btn--ghost" onClick={() => setDraft(null)}>{c('wCancel')}</button>
              <button className="fb-btn fb-btn--primary" disabled={busy}>{c('wSave')}</button>
            </div>
          </form>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[1.4fr_1fr]">
          <section className="fb-col gap-3">
            {!loading && !loadError && flows.length === 0 && !draft ? <div className="fb-glass p-4"><EmptyState icon={<WorkflowIcon size={20} />} title={c('wEmpty')} /></div> : flows.map(w => (
              <article key={w.id} className="fb-glass fb-col gap-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{w.name}</h3>
                  <Pill tone={w.enabled ? 'ok' : 'neutral'}>{w.trigger_type === 'schedule' ? c('wSchedule') : w.trigger_type === 'webhook' ? c('wWebhook') : c('wManual')}</Pill>
                  {canManage && <button className="fb-btn fb-btn--ghost" aria-label={c('wEdit')} title={c('wEdit')} disabled={busy || loading || loadError} onClick={() => edit(w)}><Pencil size={14} /></button>}
                  {canManage && <button className="fb-btn fb-btn--ghost" aria-label={c('wDelete')} title={c('wDelete')} disabled={busy || loading || loadError} onClick={() => act(() => deleteWorkflow(w.id, orgId, w.revision))}><Trash2 size={14} /></button>}
                </div>
                {w.description && <p className="fb-dim text-[13px]">{w.description}</p>}
                <ol className="flex flex-wrap items-center gap-1.5 text-[12px]">
                  {(w.workflow_steps ?? []).map((s, i) => (
                    <li key={s.id ?? i} className="fb-chip max-w-full" title={s.action}><b>{i + 1}.</b> {name(s.agent_id)}</li>
                  ))}
                </ol>
                {w.trigger_type === 'schedule' && w.next_run_at && <div className="fb-dim text-[12px]">{c('wNext')}: {new Date(w.next_run_at).toLocaleString(i18n.lang)}</div>}
                {canRun && w.enabled && (
                  <div className="flex flex-wrap gap-2">
                    <input className="fb-input min-w-0 flex-1" value={inputs[w.id] ?? ''} onChange={e => setInputs({ ...inputs, [w.id]: e.target.value })} placeholder={c('wInput')} />
                    <button className="fb-btn fb-btn--primary" disabled={busy || loading || loadError} onClick={() => act(() => startWorkflow(w.id, inputs[w.id] ?? ''), c('wStarted'))}><Play size={14} /> {c('wRun')}</button>
                  </div>
                )}
                {canManage && w.trigger_type === 'webhook' && (
                  <div className="fb-col gap-1">
                    <button className="fb-btn fb-btn--ghost self-start" disabled={busy || loading || loadError} onClick={async () => { setBusy(true); setHook(null); try { const result = await workflowHook(w.id, w.revision); if (alive.current) { setHook({ id: w.id, ...result }); await load(); } } catch (err) { if (alive.current) toast.error(workflowFailure(i18n.lang, err)); } finally { if (alive.current) setBusy(false); } }}><Webhook size={14} /> {c('wHook')}</button>
                    {hook?.id === w.id && (
                      <div className="fb-col gap-1 rounded-lg border border-amber-300/30 p-2 text-[12px]">
                        <span className="text-amber-200">{c('wHookShown')}</span>
                        <div className="flex gap-2"><code className="min-w-0 flex-1 truncate" dir="ltr">{hook.url}</code><button className="fb-btn fb-btn--ghost" aria-label="copy" onClick={() => void navigator.clipboard?.writeText(hook.url)}><Copy size={13} /></button></div>
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
          </section>
          <section className="fb-glass p-4">
            <div className="fb-eyebrow mb-2">{c('wRuns')}</div>
            {runs.length === 0 ? <p className="fb-dim text-[13px]">—</p> : (
              <ul className="fb-col gap-2">
                {runs.map(r => (
                  <li key={r.id} className="rounded-lg border border-white/10 p-2 text-[12.5px]">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{flowName.get(r.workflow_id) ?? '—'}</span>
                      <Pill tone={r.status === 'completed' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'}>{status(r)}</Pill>
                    </div>
                    <div className="fb-dim mt-0.5">{new Date(r.created_at).toLocaleString(i18n.lang)} · {c('wStep', { n: r.step + 1 })}{r.result?.error ? ` · ${r.result.error}` : ''}</div>
                    {r.status === 'completed' && r.result?.summary && <p className="fb-dim mt-1 line-clamp-3">{r.result.summary}</p>}
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
