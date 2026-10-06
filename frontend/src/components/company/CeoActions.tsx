import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, Loader2, Play, Users } from 'lucide-react';
import { toast } from 'sonner';
import { useI18n } from '../../i18n/I18nProvider';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { requireClient } from '../../lib/company/client';
import { createTask, listAgents } from '../../lib/company/data';
import { meetingLink, type Handoff, type MeetingOffer, type TaskOffer } from '../../lib/company/handoff';
import { agentLabel } from '../../lib/company/labels';
import { runErrorText, runTask } from '../../lib/company/runner';
import { cleanTaskResult } from '../../lib/company/taskResult';
import { WRITER_ROLES, type AgentRow, type TaskResult } from '../../lib/company/types';
import { useWorkspaceCopy } from '../../lib/company/workspaceCopy';
import { AskButton } from './AskButton';
import { ReportView } from './ReportView';

/** What the CEO offers under its reply: talk to an employee, give an employee a task, or call a meeting. */
export function CeoActions({ ask, task, meet }: { ask?: Handoff | null; task?: TaskOffer | null; meet?: MeetingOffer | null }) {
  const { current } = useCompanyAuth();
  return <>
    {ask && <AskButton ask={ask} />}
    {task && <TaskButton key={`${current?.organization.id}:${task.agentId}:${task.title}:${task.details}`} offer={task} />}
    {meet && <MeetButton offer={meet} />}
  </>;
}

function useAgent(id: string) {
  const { current } = useCompanyAuth();
  const [loaded, setLoaded] = useState<{ orgId: string; id: string; agent: AgentRow | null } | null>(null);
  const orgId = current?.organization.id ?? '';
  useEffect(() => {
    let live = true;
    if (orgId) listAgents(orgId).then((all) => live && setLoaded({ orgId, id, agent: all.find((a) => a.id === id) ?? null })).catch(() => undefined);
    return () => { live = false; };
  }, [orgId, id]);
  return loaded?.orgId === orgId && loaded.id === id ? loaded.agent : null;
}

/** "Give it to <employee>": creates the task, runs it here and shows the finished work (slides, report or message). */
function TaskButton({ offer }: { offer: TaskOffer }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const copy = useWorkspaceCopy();
  const { current, user } = useCompanyAuth();
  const agent = useAgent(offer.agentId);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done' | 'awaiting_approval' | 'failed'>('idle');
  const [result, setResult] = useState<TaskResult | null>(null);
  const submitting = useRef(false);
  if (!agent || !current || !user || !WRITER_ROLES.includes(current.role)) return null;
  const name = agentLabel(agent, i18n).name;
  const give = async () => {
    if (submitting.current) return;
    submitting.current = true;
    let created = false;
    setPhase('working');
    try {
      const id = await createTask({ orgId: current.organization.id, userId: user.id, title: offer.title, description: offer.details, priority: 'normal', agentId: agent.id });
      created = true;
      let outcome;
      try { outcome = await runTask(id, lang); } catch (err) {
        toast.error(runErrorText(t, err));
        setPhase('failed');
        return;
      }
      if (outcome.status === 'awaiting_approval') {
        setPhase('awaiting_approval');
        return;
      }
      const { data, error } = await requireClient().from('tasks').select('status,result').eq('id', id).eq('organization_id', current.organization.id).maybeSingle();
      if (error || data?.status !== 'completed' || !data.result) {
        toast.error(runErrorText(t, error));
        setPhase('failed');
        return;
      }
      setResult(data?.result ? cleanTaskResult(data.result as TaskResult) : null);
      setPhase('done');
    } catch (err) {
      console.error(err);
      toast.error(t('mis.createError'));
      setPhase(created ? 'failed' : 'idle');
    } finally {
      submitting.current = false;
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="fb-dim text-[12px]">{copy('ctTask', { name })}: <span className="text-[var(--fb-text)]">{offer.title}</span></div>
      {phase === 'idle' && (
        <button type="button" className="fb-btn fb-btn--primary self-start" onClick={() => void give()}>
          <Play size={14} /> {copy('ctGive', { name })}
        </button>
      )}
      {phase === 'working' && <span className="fb-dim inline-flex items-center gap-1.5 text-[12px]" aria-live="polite"><Loader2 size={14} className="animate-spin" /> {copy('ctWorking', { name })}</span>}
      {(phase === 'failed' || phase === 'awaiting_approval') && <span className="fb-dim text-[12px]" aria-live="polite">{t(`audit.taskstate.${phase}`)} <Link className="underline" to="/tasks">{copy('ctInTasks')}</Link></span>}
      {phase === 'done' && (
        <>
          <span className="inline-flex items-center gap-1.5 text-[12px]"><CheckCircle2 size={14} style={{ color: 'var(--fb-ok, #34d399)' }} /> {copy('ctDone')} <Link className="underline" to="/tasks">{copy('ctInTasks')}</Link></span>
          {result?.report && <div className="rounded-lg p-3" style={{ background: 'rgba(5,10,20,.7)', border: '1px solid var(--fb-border)' }}><ReportView result={result} compact /></div>}
        </>
      )}
    </div>
  );
}

/** "Open the meeting": the Missions page with the topic and the employees the CEO proposed, ready to start. */
function MeetButton({ offer }: { offer: MeetingOffer }) {
  const copy = useWorkspaceCopy();
  return (
    <Link className="fb-btn fb-btn--ghost mt-2 inline-flex" to={meetingLink(offer)}>
      <Users size={14} /> {copy('mtOpen')}: {offer.topic}
    </Link>
  );
}
