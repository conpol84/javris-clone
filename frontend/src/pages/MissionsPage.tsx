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
import { createMeeting, createMission, getMission, isMeeting, listMissions, listSteps, missionStepWaiting, runMission, type MissionProgress, type MissionRow, type StepRow } from '../lib/company/missions';
import { computerExecutionOf, refreshComputerOutcome, RunError, runErrorText, runOutcomeNotice, runTask, type RunOutcome } from '../lib/company/runner';
import { useRunScope } from '../lib/company/useRunScope';
import { ComputerExecutionView } from '../components/company/ComputerExecutionView';
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
  const identity = JSON.stringify([orgId, user?.id, current?.role]);
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
  const [acknowledgements, setAcknowledgements] = useState<Record<string, RunOutcome>>({});
  const [autoStart, setAutoStart] = useState<{ mission: MissionRow; identity: string } | null>(null);
  const [inventoryIdentity, setInventoryIdentity] = useState<string | null>(null);
  const [stepsIdentity, setStepsIdentity] = useState<string | null>(null);
  const stop = useRef(false);
  const operation = useRef<symbol | null>(null);
  const activeId = params.get('m');
  const liveScope = useRunScope(JSON.stringify([orgId, user?.id, current?.role, activeId]))();
  const selectionIdentity = JSON.stringify([identity, activeId]);
  const visibleMissions = inventoryIdentity === identity ? missions : [];
  const visibleAgents = inventoryIdentity === identity ? agents : [];
  const mission = visibleMissions.find((m) => m.id === activeId) ?? null;
  const visibleSteps = mission && stepsIdentity === selectionIdentity ? steps : [];
  const running = phase !== null && phase !== 'done' && phase !== 'waiting';
  const waitingStep = visibleSteps.find(s => missionStepWaiting(s, acknowledgements[s.id]));

  useEffect(() => {
    setInventoryIdentity(null); setStepsIdentity(null); setMissions([]); setAgents([]); setSteps([]);
  }, [identity]);

  useEffect(() => {
    stop.current = true; operation.current = null;
    setPhase(null); setRunningStep(null); setAcknowledgements({});
    setAutoStart(previous => previous?.mission.id === activeId && previous.identity === identity ? previous : null);
  }, [orgId, user?.id, current?.role, activeId]);

  const nameOf = useCallback((id: string | null) => {
    const a = visibleAgents.find((x) => x.id === id);
    return a ? agentLabel(a, i18n).name : t('unassigned');
  }, [visibleAgents, i18n, t]);

  const reloadMissions = useCallback(async () => {
    if (!orgId) return;
    const live = liveScope;
    const rows = await listMissions(orgId);
    if (live()) { setMissions(rows); setInventoryIdentity(identity); }
  }, [orgId, user?.id, current?.role, activeId]);

  useEffect(() => {
    if (!orgId) return;
    const live = liveScope;
    Promise.all([listAgents(orgId), listMissions(orgId)])
      .then(([a, m]) => {
        if (live()) {
          setAgents(a);
          setMissions(m);
          setInventoryIdentity(identity);
        }
      })
      .catch(() => live() && toast.error(t('mis.loadError')));
    return () => {
      stop.current = true;
    };
  }, [orgId, user?.id, current?.role, activeId, t]);

  useEffect(() => {
    setSteps([]);
    setOpen(null);
    setStepsIdentity(null);
    if (!mission || !liveScope()) return;
    const live = liveScope;
    listSteps(mission.id, orgId).then((s) => { if (live()) { setSteps(s); setStepsIdentity(selectionIdentity); } }).catch(() => {});
  }, [orgId, user?.id, current?.role, activeId, mission?.id]);

  // Keep the picture fresh while a mission is running somewhere (this tab or another).
  useEffect(() => {
    if (!mission || mission.status !== 'running') return;
    const live = liveScope;
    const id = window.setInterval(() => {
      if (!live()) return;
      void listSteps(mission.id, orgId).then(s => { if (live()) { setSteps(s); setStepsIdentity(selectionIdentity); } }).catch(() => {});
      void getMission(mission.id, orgId).then((m) => live() && m && setMissions((prev) => prev.map((x) => (x.id === m.id ? m : x)))).catch(() => {});
    }, 3500);
    return () => window.clearInterval(id);
  }, [mission?.id, mission?.status, orgId, user?.id, current?.role, activeId]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('m', id);
    else next.delete('m');
    setParams(next, { replace: true });
  };

  const start = async (m: MissionRow) => {
    if (!liveScope() || !canWrite || !user || operation.current || mission?.id !== m.id) return;
    const live = liveScope, token = Symbol(); operation.current = token;
    const progress = { phase: 'planning' as MissionProgress['phase'] };
    stop.current = false;
    setPhase('planning');
    try {
      await runMission(m, lang, (p) => {
        if (!live()) return;
        progress.phase = p.phase;
        setPhase(p.phase);
        setSteps(p.steps);
        setStepsIdentity(selectionIdentity);
        if (p.acknowledgement) { const { stepId, outcome } = p.acknowledgement; setAcknowledgements(previous => ({ ...previous, [stepId]: outcome })); }
      }, () => stop.current || !live(), acknowledgements, orgId);
    } catch (err) {
      if (live()) toast.error(runErrorText(t, err));
    } finally {
      if (live()) {
        if (progress.phase !== 'waiting') setPhase(null);
        await reloadMissions().catch(() => {});
        if (live()) { const fresh = await listSteps(m.id, orgId).catch(() => null); if (live() && fresh) { setSteps(fresh); setStepsIdentity(selectionIdentity); } }
      }
      if (operation.current === token) operation.current = null;
    }
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!liveScope() || !goal.trim() || !user || running) return;
    const live = liveScope;
    try {
      const m = mode === 'meeting' ? await createMeeting(orgId, user.id, goal, details, invited) : await createMission(orgId, user.id, goal, details);
      if (!live()) return;
      setGoal('');
      setDetails('');
      setInvited([]);
      setMissions((prev) => [m, ...(inventoryIdentity === identity ? prev : [])]); setInventoryIdentity(identity);
      select(m.id);
      setAutoStart({ mission: m, identity });
    } catch (err) {
      console.error(err);
      if (live()) toast.error(t('mis.createError'));
    }
  };

  useEffect(() => {
    if (autoStart?.mission.id !== activeId || autoStart.identity !== identity) return;
    setAutoStart(null); void start(autoStart.mission);
  }, [autoStart, activeId, identity]);

  const ceo = visibleAgents.find((a) => a.type === 'ceo' || a.slug.startsWith('ceo')) ?? visibleAgents[0];
  const nodes = useMemo(() => {
    const ids = new Set<string>();
    if (ceo) ids.add(ceo.id);
    for (const s of visibleSteps) if (s.assigned_agent_id) ids.add(s.assigned_agent_id);
    for (const x of mission?.result?.transcript ?? []) ids.add(x.agent_id);
    return [...ids].flatMap((id) => {
      const a = visibleAgents.find((x) => x.id === id);
      return a ? [{ id, name: agentLabel(a, i18n).name.replace(' Agent', ''), color: agentColor(a.type, a.slug), persona: resolvePersona(a) }] : [];
    });
  }, [visibleAgents, visibleSteps, ceo, i18n, mission]);
  const sceneSteps = useMemo(() => visibleSteps.map((s) => ({ id: s.id, agentId: s.assigned_agent_id, status: s.status })), [visibleSteps]);
  const status = phase === 'waiting' ? (waitingStep?.status === 'awaiting_approval' ? 'awaiting_approval' : 'running') : phase ? 'running' : mission?.status ?? 'pending';
  const meeting = mode === 'meeting';
  const examples = meeting ? [copy('mtEx1'), copy('mtEx2'), copy('mtEx3')] : [t('mis.ex1'), t('mis.ex2'), t('mis.ex3')];
  const team = visibleAgents.filter((a) => a.enabled && a.id !== ceo?.id);
  const toggleInvite = (id: string) => setInvited((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 5 ? cur : [...cur, id]));
  // An action item from a meeting is an ordinary task: run it right here.
  const runStep = async (step: StepRow) => {
    if (!liveScope() || !mission || !visibleSteps.some(s => s.id === step.id) || !canWrite || !user || operation.current || missionStepWaiting(step, acknowledgements[step.id])) return;
    const live = liveScope, token = Symbol(); operation.current = token;
    setRunningStep(step.id);
    try {
      const outcome = await runTask(step.id, lang);
      if (!live()) return;
      setAcknowledgements(previous => ({ ...previous, [step.id]: outcome }));
      const fresh = await listSteps(mission.id, orgId);
      if (!live()) return;
      setSteps(fresh);
      setStepsIdentity(selectionIdentity);
      const observed = fresh.find(s => s.id === step.id);
      if (!observed) throw new RunError('unknown', 'task_readback_missing');
      const effective: RunOutcome = observed && missionStepWaiting(observed, outcome) && outcome.status === 'completed'
        ? { ...outcome, status: observed.status === 'awaiting_approval' ? 'awaiting_approval' : 'running', pending: observed.status !== 'awaiting_approval' } : outcome;
      setAcknowledgements(previous => ({ ...previous, [step.id]: effective }));
      const notice = runOutcomeNotice(t, effective); toast[notice.tone](notice.text);
    }
    catch (err) { if (live()) toast.error(runErrorText(t, err)); }
    finally {
      if (live()) setRunningStep(null);
      if (operation.current === token) operation.current = null;
    }
  };
  const phaseText = (p: MissionProgress['phase']) => p === 'waiting'
    ? t(waitingStep?.status === 'awaiting_approval' || acknowledgements[waitingStep?.id ?? '']?.status === 'awaiting_approval' ? 'status.awaiting_approval' : 'run.pending')
    : p === 'meeting' ? copy('mtInSession') : t(`mis.phase.${p}` as TKey);

  return (
    <div data-jarvis-missions="true" className="fb-root flex h-full min-h-0 min-w-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <aside className="flex w-full min-w-0 shrink-0 flex-col border-b lg:h-full lg:w-[340px] lg:border-b-0 lg:border-e" style={{ borderColor: 'var(--fb-border)' }}>
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
        <ul data-mission-history="true" className="max-h-44 min-h-0 space-y-1 overflow-y-auto px-2 pb-3 lg:max-h-none lg:flex-1">
          {visibleMissions.map((m) => (
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
          {visibleMissions.length === 0 && <li className="fb-dim px-2 text-sm">{t('mis.empty')}</li>}
        </ul>
      </aside>

      <section data-mission-detail="true" className="min-w-0 shrink-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {!mission ? (
          <div className="grid h-full min-h-[320px] place-items-center p-6 text-center">
            <div>
              <h2 className="fb-grad-text text-2xl font-bold">{t('mis.pick')}</h2>
              <p className="fb-muted mx-auto mt-2 max-w-md text-sm">{t('mis.pickText')}</p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-full flex-col">
            <div data-mission-stage="true" className="relative h-[245px] min-w-0 shrink-0 sm:h-[320px] md:h-[400px]">
              <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
                <MissionScene nodes={nodes} steps={sceneSteps} missionStatus={status} labels={{ core: t('mis.core'), noWebgl: t('office.noWebgl') }} />
              </Suspense>
              <div className="pointer-events-none absolute inset-x-3 top-2 flex flex-wrap items-start justify-between gap-2 sm:inset-x-4 sm:top-3">
                <div className="min-w-0">
                  <div className="fb-eyebrow">{isMeeting(mission) ? copy('mtMeeting') : t('mis.title')}</div>
                  <div className="max-w-[min(100%,330px)] break-words text-sm font-semibold leading-snug sm:text-lg">{mission.title}</div>
                </div>
                <span className="fb-chip shrink-0">
                  <StatusDot tone={TONE[status as keyof typeof TONE] ?? 'idle'} live={status === 'running'} />
                  {phase ? phaseText(phase) : t(`status.${mission.status}` as TKey)}
                </span>
              </div>
              {running && <div className="fb-dim pointer-events-none absolute inset-x-0 bottom-2 text-center text-xs">{t('mis.keepOpen')}</div>}
            </div>

            <div className="min-w-0 space-y-4 p-3 pb-8 sm:p-4">
              {!running && canWrite && (phase === 'waiting' || ['pending', 'running', 'awaiting_approval'].includes(mission.status)) && (
                <button className="fb-btn fb-btn--primary" disabled={!!waitingStep} onClick={() => void start(mission)}>
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
                {isMeeting(mission) && visibleSteps.length > 0 && <p className="fb-dim mb-2 text-xs">{copy('mtActionsHint')}</p>}
                {visibleSteps.length === 0 ? (
                  <p className="fb-dim text-sm">{t('mis.noSteps')}</p>
                ) : (
                  <ol className="flex flex-col gap-2">
                    {visibleSteps.map((s, idx) => (
                      <li key={s.id} className="fb-row flex-col items-stretch gap-1.5 py-2.5">
                        <button className="flex w-full cursor-pointer items-center gap-2.5 text-start" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
                          <span className="fb-dim w-5 shrink-0 text-xs tabular-nums">{idx + 1}</span>
                          <StatusDot tone={TONE[s.status] ?? 'idle'} live={s.status === 'running'} />
                          <span className="min-w-0 flex-1">
                            <span data-mission-step-title className="block min-w-0 break-words text-sm font-medium">{s.title}</span>
                            <span className="fb-dim block truncate text-xs">{t('mis.by', { agent: nameOf(s.assigned_agent_id) })} · {t(`status.${s.status}` as TKey)}</span>
                          </span>
                        </button>
                        {isMeeting(mission) && canWrite && ['pending', 'failed'].includes(s.status) && (
                          <button type="button" className="fb-btn fb-btn--ghost self-start" style={{ height: 28 }} disabled={runningStep !== null || missionStepWaiting(s, acknowledgements[s.id])} onClick={() => void runStep(s)}>
                            <Play size={12} /> {runningStep === s.id ? t('mis.starting') : copy('mtRun')}
                          </button>
                        )}
                        <ComputerExecutionView execution={acknowledgements[s.id]?.computer_execution
                          ? refreshComputerOutcome(acknowledgements[s.id], s.result).computer_execution ?? null
                          : computerExecutionOf(s.result)} compact />
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
