import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ReportView } from '../components/company/ReportView';
import { useSearchParams } from 'react-router';
import { Play, Rocket, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { listAgents } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { createMeeting, createMission, getMission, isMeeting, listMissions, listSteps, runMission, type MissionProgress, type MissionRow, type StepRow } from '../lib/company/missions';
import { RunError, runErrorText, runTask } from '../lib/company/runner';
import { useWorkspaceCopy } from '../lib/company/workspaceCopy';
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
  const [goal, setGoal] = useState(() => (params.get('meet') ?? '').slice(0, 160));
  const [details, setDetails] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const copy = useWorkspaceCopy();
  // A mission (the team works step by step) or a meeting (the CEO chairs, everyone speaks, minutes and action items).
  const [mode, setMode] = useState<'mission' | 'meeting'>(params.get('meet') !== null ? 'meeting' : 'mission');
  const [invited, setInvited] = useState<string[]>(() => (params.get('with') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 5));
  const [runningStep, setRunningStep] = useState<string | null>(null);
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
      toast.error(runErrorText(t, err));
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
      const m = mode === 'meeting' ? await createMeeting(orgId, user.id, goal, details, invited) : await createMission(orgId, user.id, goal, details);
      setGoal('');
      setDetails('');
      setInvited([]);
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
    for (const x of mission?.result?.transcript ?? []) ids.add(x.agent_id);
    return [...ids].flatMap((id) => {
      const a = agents.find((x) => x.id === id);
      return a ? [{ id, name: agentLabel(a, i18n).name.replace(' Agent', ''), color: agentColor(a.type, a.slug), persona: resolvePersona(a) }] : [];
    });
  }, [agents, steps, ceo, i18n, mission]);
  const sceneSteps = useMemo(() => steps.map((s) => ({ id: s.id, agentId: s.assigned_agent_id, status: s.status })), [steps]);
  const status = phase ? 'running' : mission?.status ?? 'pending';
  const meeting = mode === 'meeting';
  const examples = meeting ? [copy('mtEx1'), copy('mtEx2'), copy('mtEx3')] : [t('mis.ex1'), t('mis.ex2'), t('mis.ex3')];
  const team = agents.filter((a) => a.enabled && a.id !== ceo?.id);
  const toggleInvite = (id: string) => setInvited((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 5 ? cur : [...cur, id]));
  // An action item from a meeting is an ordinary task: run it right here.
  const runStep = async (step: StepRow) => {
    setRunningStep(step.id);
    try { await runTask(step.id, lang); }
    catch (err) { toast.error(runErrorText(t, err)); }
    finally {
      setRunningStep(null);
      if (activeId) setSteps(await listSteps(activeId).catch(() => steps));
    }
  };
  const phaseText = (p: MissionProgress['phase']) => (p === 'meeting' ? copy('mtInSession') : t(`mis.phase.${p}` as TKey));

  return (
    <div className="fb-root flex h-full flex-col lg:flex-row">
      <aside className="flex max-h-[34%] w-full shrink-0 flex-col border-b lg:max-h-none lg:w-[340px] lg:border-b-0 lg:border-e" style={{ borderColor: 'var(--fb-border)' }}>
        <div className="p-3 pt-14 lg:pt-3">
          <h1 className="flex items-center gap-2 text-base font-semibold"><Rocket size={16} style={{ color: 'var(--fb-accent)' }} /> {t('mis.title')}</h1>
          <p className="fb-dim mt-0.5 text-xs">{t('mis.sub')}</p>
        </div>
        {canWrite && (
          <form onSubmit={create} className="space-y-2 px-3 pb-3">
            <div className="flex gap-1 rounded-lg p-0.5" role="tablist" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--fb-border)' }}>
              {(['mission', 'meeting'] as const).map((m) => (
                <button key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}
                  className="flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium"
                  style={mode === m ? { background: 'rgba(0,212,255,.14)', color: 'var(--fb-accent)' } : undefined}>
                  {m === 'mission' ? <Rocket size={13} /> : <Users size={13} />} {m === 'mission' ? copy('mtMission') : copy('mtMeeting')}
                </button>
              ))}
            </div>
            <input className="fb-input" value={goal} maxLength={160} onChange={(e) => setGoal(e.target.value)} placeholder={meeting ? copy('mtTopicPh') : t('mis.goalPlaceholder')} aria-label={meeting ? copy('mtTopic') : t('mis.goal')} />
            <textarea className="fb-input min-h-[60px] resize-none" rows={2} value={details} maxLength={1500} onChange={(e) => setDetails(e.target.value)} placeholder={meeting ? copy('mtAgendaPh') : t('mis.detailsPlaceholder')} aria-label={t('mis.details')} />
            {meeting && team.length > 0 && (
              <div>
                <p className="fb-dim mb-1 text-[11px]">{copy('mtWho')}</p>
                <div className="flex flex-wrap gap-1.5">
                  {team.map((a) => (
                    <button key={a.id} type="button" className="fb-chip cursor-pointer" aria-pressed={invited.includes(a.id)} onClick={() => toggleInvite(a.id)}
                      style={invited.includes(a.id) ? { background: 'rgba(0,212,255,.16)', borderColor: 'var(--fb-accent)', color: 'var(--fb-accent)' } : undefined}>
                      {agentLabel(a, i18n).name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {examples.map((x) => (
                <button key={x} type="button" className="fb-chip cursor-pointer" onClick={() => setGoal(x)}>{x}</button>
              ))}
            </div>
            <button className="fb-btn fb-btn--primary w-full" disabled={!goal.trim() || running}>
              {meeting ? <Users size={14} /> : <Rocket size={14} />} {running ? t('mis.starting') : meeting ? copy('mtStart') : t('mis.start')}
            </button>
          </form>
        )}
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-3">
          {missions.map((m) => (
            <li key={m.id}>
              <button
                onClick={() => select(m.id)}
                className="fb-glass--hover w-full cursor-pointer rounded-xl px-3 py-2 text-start"
                style={m.id === activeId ? { background: 'rgba(0, 212, 255,.1)', border: '1px solid var(--fb-border-strong)' } : { border: '1px solid transparent' }}
              >
                <div className="flex items-center gap-1.5 truncate text-sm font-medium">{isMeeting(m) && <Users size={13} className="shrink-0" style={{ color: 'var(--fb-accent)' }} aria-label={copy('mtBadge')} />}<span className="truncate">{m.title}</span></div>
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
                  <div className="fb-eyebrow">{isMeeting(mission) ? copy('mtMeeting') : t('mis.title')}</div>
                  <div className="truncate text-lg font-semibold">{mission.title}</div>
                </div>
                <span className="fb-chip shrink-0">
                  <StatusDot tone={TONE[status as keyof typeof TONE] ?? 'idle'} live={status === 'running'} />
                  {phase ? phaseText(phase) : t(`status.${mission.status}` as TKey)}
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
              {isMeeting(mission) && mission.result?.report && (
                <Panel title={copy('mtMinutes')} right={mission.result.ai_generated ? <span className="fb-chip">{t('run.ai')}</span> : undefined}>
                  {mission.result.summary && <p className="mb-2 font-medium">{mission.result.summary}</p>}
                  <ReportView result={mission.result} />
                </Panel>
              )}
              {isMeeting(mission) && (mission.result?.transcript?.length ?? 0) > 0 && (
                <Panel title={copy('mtSaid')}>
                  <ul className="flex flex-col gap-2">
                    {mission.result!.transcript!.filter((x) => x.text).map((x) => (
                      <li key={x.agent_id} className="fb-row flex-col items-stretch gap-1 py-2">
                        <span className="text-sm font-semibold">{nameOf(x.agent_id) === t('unassigned') ? x.name : nameOf(x.agent_id)}</span>
                        <p className="fb-muted whitespace-pre-wrap break-words text-[13px]" dir="auto">{x.text}</p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
              <Panel title={isMeeting(mission) ? copy('mtActions') : t('mis.steps')}>
                {isMeeting(mission) && steps.length > 0 && <p className="fb-dim mb-2 text-xs">{copy('mtActionsHint')}</p>}
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
                        {isMeeting(mission) && canWrite && ['pending', 'failed'].includes(s.status) && (
                          <button type="button" className="fb-btn fb-btn--ghost self-start" style={{ height: 28 }} disabled={runningStep !== null} onClick={() => void runStep(s)}>
                            <Play size={12} /> {runningStep === s.id ? t('mis.starting') : copy('mtRun')}
                          </button>
                        )}
                        {open === s.id && (
                          <div className="text-[13px]">
                            {s.description && <p className="fb-muted mb-2 whitespace-pre-wrap break-words">{s.description.split('\n\nResults from teammates so far:')[0]}</p>}
                            {s.result?.report ? (
                              <div className="rounded-lg p-3" style={{ background: 'rgba(5,10,20,.7)', border: '1px solid var(--fb-border)' }}><ReportView result={s.result} compact /></div>
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
              {!isMeeting(mission) && mission.result?.report && (
                <Panel title={t('mis.report')} right={mission.result.ai_generated ? <span className="fb-chip">{t('run.ai')}</span> : undefined}>
                  {mission.result.summary && <p className="mb-2 font-medium">{mission.result.summary}</p>}
                  <ReportView result={mission.result} />
                </Panel>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
