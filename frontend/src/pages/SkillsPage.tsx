import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n/I18nProvider';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { notifyPlanLimit } from '../lib/company/limits';
import { MANAGER_ROLES, type AgentRow } from '../lib/company/types';
import { addSkill, deleteSkill, listSkills, setSkillEnabled, updateSkill, type SkillRow } from '../lib/company/workspace';
import { SKILL_LIBRARY, skillName } from '../lib/company/skillLibrary';
import { useWorkspaceCopy } from '../lib/company/workspaceCopy';
import { skillsCopy } from '../lib/company/skillsCopy';
import { EmptyState, PageHeader, Pill } from '../components/ui/kit';
import '../styles/firbo.css';

/** Ways of working the AI team follows: install from the library or write your own, for everyone or one employee. */
export function SkillsPage() {
  const { current, user } = useCompanyAuth();
  return <SkillsWorkspace key={`${user?.id ?? ''}:${current?.organization.id ?? ''}:${current?.role ?? ''}`} />;
}

/** A company/identity/role change remounts drafts and every in-flight request. */
export function SkillsWorkspace() {
  const c = useWorkspaceCopy();
  const i18n = useI18n();
  const copy = skillsCopy(i18n.lang);
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<SkillRow | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(true);
  const alive = useRef(true);
  const loadVersion = useRef(0);
  const operation = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; loadVersion.current++; }; }, []);

  const load = useCallback(async () => {
    if (!orgId || !alive.current) return;
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      const [rows, employees] = await Promise.all([listSkills(orgId), listAgents(orgId)]);
      if (!alive.current || version !== loadVersion.current) return;
      setSkills(rows); setAgents(employees); setLoadError(false);
    } catch { if (alive.current && version === loadVersion.current) setLoadError(true); }
    finally { if (alive.current && version === loadVersion.current) setLoading(false); }
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  const agentName = (id: string | null) => {
    const a = agents.find(x => x.id === id);
    return a ? agentLabel(a, i18n).name : id ? '—' : c('sTeam');
  };
  const installed = useMemo(() => new Set(skills.map(s => `${s.slug}:${s.agent_id ?? ''}`)), [skills]);
  const act = async (job: () => Promise<unknown>, done?: string, reset?: () => void) => {
    if (!alive.current) return;
    if (!canManage || !orgId || !user) { toast.error(copy.denied); return; }
    if (busy || operation.current || loading || loadError) return;
    operation.current = true;
    setBusy(true);
    try { await job(); if (!alive.current) return; reset?.(); if (done) toast.success(done); await load(); }
    catch (err) {
      if (!alive.current) return;
      const code = err instanceof Error ? err.message : '';
      if (!notifyPlanLimit(err, i18n.t as never)) toast.error(code === 'skill_already_installed' ? copy.duplicate : code === 'skill_not_changed' ? copy.unchanged : code === 'skill_invalid' ? copy.invalid : c('kErr'));
    }
    finally { operation.current = false; if (alive.current) setBusy(false); }
  };
  const install = (slug: string) => {
    const s = SKILL_LIBRARY.find(x => x.slug === slug)!;
    if (!user || installed.has(`${slug}:${target}`)) return;
    void act(() => addSkill(orgId, user.id, { slug, name: skillName(s, i18n.lang), instructions: s.instructions, agentId: target || null, source: 'library' }), c('sDone'));
  };
  const custom = (e: FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim() || instructions.trim().length < 10) return;
    const save = editing
      ? () => updateSkill(orgId, editing.id, { name, instructions, description: editing.description ?? '' })
      : () => addSkill(orgId, user.id, { name, instructions, agentId: target || null });
    void act(save, editing ? copy.saved : c('sDone'), () => { setEditing(null); setName(''); setInstructions(''); });
  };
  const edit = (s: SkillRow) => {
    if (!alive.current || !canManage || busy || loading || loadError) return;
    setEditing(s); setName(s.name); setInstructions(s.instructions);
  };
  const remove = (s: SkillRow) => act(() => deleteSkill(orgId, s.id), copy.removed, () => {
    if (editing?.id === s.id) { setEditing(null); setName(''); setInstructions(''); }
  });

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="fb-wide mx-auto px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader eyebrow={c('sEyebrow')} title={c('sTitle')} sub={c('sSub')} />
        <p className="fb-dim mb-4 text-[12px]">{copy.help}</p>
        {!canManage && <p className="fb-dim mb-4 text-[12px]">{copy.denied}</p>}
        {loadError && <div role="alert" className="mb-4 text-[12px] text-amber-300">{copy.loadError} <button className="fb-link" disabled={loading} onClick={() => void load()}>{i18n.t('common.retry')}</button></div>}
        {canManage && (
          <div className="fb-glass mb-4 flex flex-wrap items-center gap-2 p-3">
            <span className="fb-eyebrow">{c('sFor')}</span>
            <select className="fb-input fb-w-select" disabled={busy || loading || loadError} value={target} onChange={e => setTarget(e.target.value)}>
              <option value="">{c('sTeam')}</option>
              {agents.map(a => <option key={a.id} value={a.id}>{agentLabel(a, i18n).name}</option>)}
            </select>
          </div>
        )}
        <div className="grid items-start gap-4 lg:grid-cols-[1.2fr_1fr]">
          <section className="fb-glass p-4">
            <div className="fb-eyebrow mb-2">{c('sLibrary')}</div>
            <ul className="grid gap-2 sm:grid-cols-2">
              {SKILL_LIBRARY.map(s => {
                const has = installed.has(`${s.slug}:${target}`);
                return (
                  <li key={s.slug} className="fb-col gap-2 rounded-lg border border-white/10 p-3">
                    <div className="flex items-center gap-2 text-[13.5px] font-medium"><Sparkles size={14} className="text-cyan-300" /> {skillName(s, i18n.lang)}</div>
                    <p className="fb-dim line-clamp-3 text-[12px]" dir="ltr">{s.instructions}</p>
                    {canManage && (
                      <button className="fb-btn fb-btn--ghost self-start" disabled={busy || loading || loadError || has} onClick={() => install(s.slug)}>
                        {has ? c('sInstalled') : <><Plus size={14} /> {c('sInstall')}</>}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
          <div className="fb-col gap-4">
            <section className="fb-glass p-4">
              <div className="fb-eyebrow mb-2">{c('sInstalled')}</div>
              {loading ? <p role="status" className="fb-dim text-[12px]">{i18n.t('common.loading')}</p> : !loadError && skills.length === 0 ? <EmptyState icon={<Sparkles size={20} />} title={c('sEmpty')} /> : (
                <ul className="fb-col gap-2">
                  {skills.map(s => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{s.name}</div>
                        <div className="fb-dim text-[12px]">{agentName(s.agent_id)}</div>
                        <p className="fb-dim mt-1 line-clamp-2 text-[12px]">{s.instructions}</p>
                      </div>
                      <Pill tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? c('sOn') : c('sOff')}</Pill>
                      {canManage && (
                        <>
                          <button className="fb-btn fb-btn--ghost" disabled={busy || loading || loadError} onClick={() => edit(s)}><Pencil size={14} /> {copy.edit}</button>
                          <button className="fb-btn fb-btn--ghost" disabled={busy || loading || loadError} onClick={() => act(() => setSkillEnabled(orgId, s.id, !s.enabled), s.enabled ? copy.disabled : copy.enabled)}>{s.enabled ? c('sOff') : c('sOn')}</button>
                          <button className="fb-btn fb-btn--ghost" aria-label={`${c('sRemove')}: ${s.name}`} title={c('sRemove')} disabled={busy || loading || loadError} onClick={() => remove(s)}><Trash2 size={14} /> {c('sRemove')}</button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {canManage && (
              <form onSubmit={custom} className="fb-glass fb-col gap-2 p-4">
                <div className="fb-eyebrow">{editing ? copy.editTitle : c('sCustom')}</div>
                {editing && <p className="fb-dim text-[12px]">{agentName(editing.agent_id)}</p>}
                <input className="fb-input" aria-label={copy.name} value={name} onChange={e => setName(e.target.value)} placeholder={c('kName')} maxLength={80} />
                <textarea className="fb-input min-h-[110px] py-2" aria-label={copy.instructions} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={c('sInstr')} maxLength={4000} />
                <div className="flex justify-end gap-2">
                  {editing && <button type="button" className="fb-btn fb-btn--ghost" disabled={busy} onClick={() => { setEditing(null); setName(''); setInstructions(''); }}>{copy.cancel}</button>}
                  <button className="fb-btn fb-btn--primary" disabled={busy || loading || loadError || !name.trim() || instructions.trim().length < 10}>{editing ? copy.save : <><Plus size={14} /> {c('sInstall')}</>}</button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
