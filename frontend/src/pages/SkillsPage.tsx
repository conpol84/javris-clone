import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../i18n/I18nProvider';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { notifyPlanLimit } from '../lib/company/limits';
import { MANAGER_ROLES, type AgentRow } from '../lib/company/types';
import { addSkill, deleteSkill, listSkills, setSkillEnabled, type SkillRow } from '../lib/company/workspace';
import { SKILL_LIBRARY, skillName } from '../lib/company/skillLibrary';
import { useWorkspaceCopy } from '../lib/company/workspaceCopy';
import { EmptyState, PageHeader, Pill } from '../components/ui/kit';
import '../styles/firbo.css';

/** Ways of working the AI team follows: install from the library or write your own, for everyone or one employee. */
export function SkillsPage() {
  const c = useWorkspaceCopy();
  const i18n = useI18n();
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [target, setTarget] = useState('');
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!orgId) return;
    try { setSkills(await listSkills(orgId)); } catch { toast.error(c('kErr')); }
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (orgId) listAgents(orgId).then(setAgents).catch(() => undefined); }, [orgId]);

  const agentName = (id: string | null) => {
    const a = agents.find(x => x.id === id);
    return a ? agentLabel(a, i18n).name : c('sTeam');
  };
  const installed = useMemo(() => new Set(skills.map(s => `${s.slug}:${s.agent_id ?? ''}`)), [skills]);
  const act = async (job: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await job(); if (done) toast.success(done); await load(); }
    catch (err) { if (!notifyPlanLimit(err, i18n.t as never)) toast.error(c('kErr')); }
    finally { setBusy(false); }
  };
  const install = (slug: string) => {
    const s = SKILL_LIBRARY.find(x => x.slug === slug)!;
    if (!user) return;
    void act(() => addSkill(orgId, user.id, { slug, name: skillName(s, i18n.lang), instructions: s.instructions, agentId: target || null, source: 'library' }), c('sDone'));
  };
  const custom = (e: FormEvent) => {
    e.preventDefault();
    if (!user || !name.trim() || instructions.trim().length < 10) return;
    void act(() => addSkill(orgId, user.id, { name, instructions, agentId: target || null }).then(() => { setName(''); setInstructions(''); }), c('sDone'));
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="fb-wide mx-auto px-4 pb-10 pt-14 md:px-8 md:pt-8">
        <PageHeader eyebrow={c('sEyebrow')} title={c('sTitle')} sub={c('sSub')} />
        {canManage && (
          <div className="fb-glass mb-4 flex flex-wrap items-center gap-2 p-3">
            <span className="fb-eyebrow">{c('sFor')}</span>
            <select className="fb-input fb-w-select" value={target} onChange={e => setTarget(e.target.value)}>
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
                      <button className="fb-btn fb-btn--ghost self-start" disabled={busy || has} onClick={() => install(s.slug)}>
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
              {skills.length === 0 ? <EmptyState icon={<Sparkles size={20} />} title={c('sEmpty')} /> : (
                <ul className="fb-col gap-2">
                  {skills.map(s => (
                    <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 p-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13.5px] font-medium">{s.name}</div>
                        <div className="fb-dim text-[12px]">{agentName(s.agent_id)}</div>
                      </div>
                      <Pill tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? c('sOn') : c('sOff')}</Pill>
                      {canManage && (
                        <>
                          <button className="fb-btn fb-btn--ghost" disabled={busy} onClick={() => act(() => setSkillEnabled(s.id, !s.enabled))}>{s.enabled ? c('sOff') : c('sOn')}</button>
                          <button className="fb-btn fb-btn--ghost" aria-label={c('sRemove')} title={c('sRemove')} disabled={busy} onClick={() => act(() => deleteSkill(s.id))}><Trash2 size={14} /></button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {canManage && (
              <form onSubmit={custom} className="fb-glass fb-col gap-2 p-4">
                <div className="fb-eyebrow">{c('sCustom')}</div>
                <input className="fb-input" value={name} onChange={e => setName(e.target.value)} placeholder={c('kName')} maxLength={80} />
                <textarea className="fb-input min-h-[110px] py-2" value={instructions} onChange={e => setInstructions(e.target.value)} placeholder={c('sInstr')} maxLength={4000} />
                <button className="fb-btn fb-btn--primary self-end" disabled={busy || !name.trim() || instructions.trim().length < 10}><Plus size={14} /> {c('sInstall')}</button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
