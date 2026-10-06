import { useEffect, useState } from 'react';
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
  if (ask) return <AskButton ask={ask} />;
  if (task) return <TaskButton offer={task} />;
  if (meet) return <MeetButton offer={meet} />;
  return null;
}

function useAgent(id: string) {
  const { current } = useCompanyAuth();
  const [agent, setAgent] = useState<AgentRow | null>(null);
  const orgId = current?.organization.id ?? '';
  useEffect(() => {
    let live = true;
    if (orgId) listAgents(orgId).then((all) => live && setAgent(all.find((a) => a.id === id) ?? null)).catch(() => undefined);
    return () => { live = false; };
  }, [orgId, id]);
  return agent;
}

/** "Give it to <employee>": creates the task, runs it here and shows the finished work (slides, report or message). */
function TaskButton({ offer }: { offer: TaskOffer }) {
  const i18n = useI18n();
  const { t, lang } = i18n;
  const copy = useWorkspaceCopy();
  const { current, user } = useCompanyAuth();
  const agent = useAgent(offer.agentId);
  const [phase, setPhase] = useState<'idle' | 'working' | 'done'>('idle');
  const [result, setResult] = useState<TaskResult | null>(null);
  if (!agent || !current || !user || !WRITER_ROLES.includes(current.role)) return null;
  const name = agentLabel(agent, i18n).name;
  const give = async () => {
    setPhase('working');
    try {
      const id = await createTask({ orgId: current.organization.id, userId: user.id, title: offer.title, description: offer.details, priority: 'normal', agentId: agent.id });
      try { await runTask(id, lang); } catch (err) { toast.error(runErrorText(t, err)); }
      const { data } = await requireClient().from('tasks').select('result').eq('id', id).maybeSingle();
      setResult(data?.result ? cleanTaskResult(data.result as TaskResult) : null);
      setPhase('done');
    } catch (err) {
      console.error(err);
      toast.error(t('mis.createError'));
      setPhase('idle');
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
