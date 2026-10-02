import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { Rocket } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { createMission, getMission, listMissions, listSteps, runMission, type MissionProgress, type MissionRow, type StepRow } from '../lib/company/missions';
import { RunError } from '../lib/company/runner';
import { resolvePersona } from '../lib/company/persona';
import { agentColor } from '../lib/company/status';
import { WRITER_ROLES, type AgentRow } from '../lib/company/types';
import '../styles/firbo.css';

const MissionScene = lazy(() => import('../components/scenes/MissionScene'));

const TONE = { completed: 'ok', running: 'ok', failed: 'err', awaiting_approval: 'warn', blocked: 'warn', pending: 'idle', cancelled: 'idle' } as const;

/** Give the CEO a goal; the team works on it step by step while you watch the hand-offs in 3D. */
export function MissionsPage() {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const canWrite = WRITER_ROLES.includes(current?.role ?? 'viewer');
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [missions, setMissions] = useState<MissionRow[]>([]);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [phase, setPhase] = useState<MissionProgress['phase'] | null>(null);
  const [goal, setGoal] = useState('');
  const [details, setDetails] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const stop = useRef(false);
  const activeId = params.get('m');
  const mission = missions.find((m) => m.id === activeId) ?? null;
  const running = phase !== null && phase !== 'done';

  const nameOf = useCallback((id: string | null) => {
    const a = agents.find((x) => x.id === id);
    return a ? agentLabel(a, i18n).name : t('unassigned');
  }, [agents, i18n, t]);

  const reloadMissions = useCallback(async () => {
    if (!orgId) return;
    setMissions(await listMissions(orgId));
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    let live = true;
    Promise.all([listAgents(orgId), listMissions(orgId)])
      .then(([a, m]) => {
        if (live) {
          setAgents(a);
          setMissions(m);
        }
      })
      .catch(() => live && toast.error(t('mis.loadError')));
    return () => {
      live = false;
      stop.current = true;
    };
  }, [orgId, t]);

  useEffect(() => {
    setSteps([]);
    setOpen(null);
    if (!activeId) return;
    let live = true;
    listSteps(activeId).then((s) => live && setSteps(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [activeId]);

  // Keep the picture fresh while a mission is running somewhere (this tab or another).
  useEffect(() => {
    if (!mission || mission.status !== 'running') return;
    const id = window.setInterval(() => {
      void listSteps(mission.id).then(setSteps).catch(() => {});
      void getMission(mission.id).then((m) => m && setMissions((prev) => prev.map((x) => (x.id === m.id ? m : x)))).catch(() => {});
    }, 3500);
    return () => window.clearInterval(id);
  }, [mission]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('m', id);
    else next.delete('m');
    setParams(next, { replace: true });
  };

  const start = async (m: MissionRow) => {
    stop.current = false;
    setPhase('planning');
    try {
      await runMission(m, lang, (p) => {
        setPhase(p.phase);
        setSteps(p.steps);
      }, () => stop.current);
    } catch (err) {
      toast.error(t(`run.err.${err instanceof RunError ? err.code : 'unknown'}` as TKey));
    } finally {
      setPhase(null);
      await reloadMissions().catch(() => {});
      setSteps(await listSteps(m.id).catch(() => []));
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || !user || running) return;
    try {
      const m = await createMission(orgId, user.id, goal, details);
      setGoal('');
      setDetails('');
      setMissions((prev) => [m, ...prev]);
      select(m.id);
      void start(m);
    } catch (err) {
      console.error(err);
      toast.error(t('mis.createError'));
    }
  };

  const ceo = agents.find((a) => a.type === 'ceo' || a.slug.startsWith('ceo')) ?? agents[0];
  const nodes = useMemo(() => {
    const ids = new Set<string>();
    if (ceo) ids.add(ceo.id);
    for (const s of steps) if (s.assigned_agent_id) ids.add(s.assigned_agent_id);
    return [...ids].flatMap((id) => {
      const a = agents.find((x) => x.id === id);
      return a ? [{ id, name: agentLabel(a, i18n).name.replace(' Agent', ''), color: agentColor(a.type, a.slug), persona: resolvePersona(a) }] : [];
    });
  }, [agents, steps, ceo, i18n]);
  const sceneSteps = useMemo(() => steps.map((s) => ({ id: s.id, agentId: s.assigned_agent_id, status: s.status })), [steps]);
  const status = phase ? 'running' : mission?.status ?? 'pending';
  const examples = [t('mis.ex1'), t('mis.ex2'), t('mis.ex3')];

  return (
    <div className="fb-root flex h-full flex-col lg:flex-row">
      <aside className="flex max-h-[34%] w-full shrink-0 flex-col border-b lg:max-h-none lg:w-[300px] lg:border-b-0 lg:border-e" style={{ borderColor: 'var(--fb-border)' }}>
        <div className="p-3 pt-14 lg:pt-3">
          <h1 className="flex items-center gap-2 text-base font-semibold"><Rocket size={16} style={{ color: 'var(--fb-accent)' }} /> {t('mis.title')}</h1>
          <p className="fb-dim mt-0.5 text-xs">{t('mis.sub')}</p>
        </div>
        {canWrite && (
          <form onSubmit={create} className="space-y-2 px-3 pb-3">
            <input className="fb-input" value={goal} maxLength={160} onChange={(e) => setGoal(e.target.value)} placeholder={t('mis.goalPlaceholder')} aria-label={t('mis.goal')} />
            <textarea className="fb-input min-h-[60px] resize-none" rows={2} value={details} maxLength={1500} onChange={(e) => setDetails(e.target.value)} placeholder={t('mis.detailsPlaceholder')} aria-label={t('mis.details')} />
            <div className="flex flex-wrap gap-1.5">
              {examples.map((x) => (
                <button key={x} type="button" className="fb-chip cursor-pointer" onClick={() => setGoal(x)}>{x}</button>
              ))}
            </div>
            <button className="fb-btn fb-btn--primary w-full" disabled={!goal.trim() || running}>
              <Rocket size={14} /> {running ? t('mis.starting') : t('mis.start')}
            </button>
          </form>
        )}
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {missions.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => select(m.id)}
                className="fb-glass--hover w-full cursor-pointer rounded-xl px-3 py-2 text-start"
                style={m.id === activeId ? { background: 'rgba(34, 211, 238,.1)', border: '1px solid var(--fb-border-strong)' } : { border: '1px solid transparent' }}
              >
                <div className="truncate text-sm font-medium">{m.title}</div>
                <div className="fb-dim flex items-center gap-1.5 text-[11px]">
                  <StatusDot tone={TONE[m.status] ?? 'idle'} live={m.status === 'running'} />
                  {t(`status.${m.status}` as TKey)} · {fmt.relative(Date.parse(m.created_at))}
                </div>
              </button>
            </li>
          ))}
          {missions.length === 0 && <li className="fb-dim px-2 text-sm">{t('mis.empty')}</li>}
        </ul>
      </aside>

      <section className="min-h-0 flex-1 overflow-y-auto">
        {!mission ? (
          <div className="grid h-full min-h-[320px] place-items-center p-6 text-center">
            <div>
              <h2 className="fb-grad-text text-2xl font-bold">{t('mis.pick')}</h2>
              <p className="fb-muted mx-auto mt-2 max-w-md text-sm">{t('mis.pickText')}</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-full flex-col">
            <div className="relative h-[340px] shrink-0 md:h-[400px]">
              <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
                <MissionScene nodes={nodes} steps={sceneSteps} missionStatus={status} labels={{ core: t('mis.core'), noWebgl: t('office.noWebgl') }} />
              </Suspense>
              <div className="pointer-events-none absolute inset-x-4 top-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="fb-eyebrow">{t('mis.title')}</div>
                  <div className="truncate text-lg font-semibold">{mission.title}</div>
                </div>
                <span className="fb-chip shrink-0">
                  <StatusDot tone={TONE[status as keyof typeof TONE] ?? 'idle'} live={status === 'running'} />
                  {phase ? t(`mis.phase.${phase}` as TKey) : t(`status.${mission.status}` as TKey)}
                </span>
              </div>
              {running && <div className="fb-dim pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs">{t('mis.keepOpen')}</div>}
            </div>

            <div className="space-y-4 p-4">
              {!running && canWrite && (mission.status === 'pending' || mission.status === 'running') && (
                <button className="fb-btn fb-btn--primary" onClick={() => void start(mission)}>
                  <Rocket size={14} /> {t('mis.continue')}
                </button>
              )}
              <Panel title={t('mis.steps')}>
                {steps.length === 0 ? (
                  <p className="fb-dim text-sm">{t('mis.noSteps')}</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {steps.map((s, idx) => (
                      <li key={s.id} className="fb-row flex-col items-stretch gap-1.5 py-2.5">
                        <button className="flex w-full cursor-pointer items-center gap-2.5 text-start" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                          <span className="fb-dim w-5 shrink-0 text-xs tabular-nums">{idx + 1}</span>
                          <StatusDot tone={TONE[s.status] ?? 'idle'} live={s.status === 'running'} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{s.title}</span>
                            <span className="fb-dim block truncate text-xs">{t('mis.by', { agent: nameOf(s.assigned_agent_id) })} · {t(`status.${s.status}` as TKey)}</span>
                          </span>
                        </button>
                        {open === s.id && (
                          <div className="text-[13px]">
                            {s.description && <p className="fb-muted mb-2 whitespace-pre-wrap break-words">{s.description.split('\n\nResults from teammates so far:')[0]}</p>}
                            {s.result?.report ? (
                              <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-lg p-3 leading-relaxed" style={{ background: 'rgba(5,10,20,.7)', border: '1px solid var(--fb-border)' }}>{s.result.report}</div>
                            ) : (
                              <p className="fb-dim">{t('mis.noOutput')}</p>
                            )}
                          </div>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
              {mission.result?.report && (
                <Panel title={t('mis.report')} right={mission.result.ai_generated ? <span className="fb-chip">{t('run.ai')}</span> : undefined}>
                  {mission.result.summary && <p className="mb-2 font-medium">{mission.result.summary}</p>}
                  <div className="fb-muted whitespace-pre-wrap break-words text-[13px] leading-relaxed">{mission.result.report}</div>
                </Panel>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
