import { useEffect, useState } from 'react';
import { ReportView } from '../company/ReportView';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { StatusDot } from '../command/Panel';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import { loadAgentUsage, type AgentUsage } from '../../lib/company/data';
import { agentLabel } from '../../lib/company/labels';
import { RunError, runErrorText, runTask } from '../../lib/company/runner';
import { agentColor } from '../../lib/company/status';
import { OPEN_TASK_STATUSES, safeAutonomy, type AgentRow, type TaskRow } from '../../lib/company/types';

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-2.5" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid var(--fb-border)' }}>
      <div className="fb-dim text-[11px]">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

/** Everything about one AI employee: usage, budget, tools and what it has delivered. */
export function AgentDetail({
  orgId,
  agent,
  tasks,
  canSeeUsage,
  canRun,
  onChanged,
}: {
  orgId: string;
  agent: AgentRow;
  tasks: TaskRow[];
  canSeeUsage: boolean;
  canRun: boolean;
  onChanged: () => void;
}) {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const [usage, setUsage] = useState<AgentUsage | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  useEffect(() => {
    setUsage(null);
    if (!canSeeUsage) return;
    let live = true;
    loadAgentUsage(orgId, agent.id)
      .then((u) => live && setUsage(u))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [orgId, agent.id, canSeeUsage]);

  const mine = tasks.filter((x) => x.assigned_agent_id === agent.id);
  const open = mine.filter((x) => OPEN_TASK_STATUSES.includes(x.status)).slice(0, 5);
  const done = mine.filter((x) => x.result && (x.result.report || x.result.error)).slice(0, 4);
  const color = agentColor(agent.type, agent.slug);
  const budget = agent.monthly_budget_usd;
  const pct = budget && usage ? Math.min(100, (usage.cost / budget) * 100) : 0;
  const tools = agent.agent_tools.filter((x) => x.enabled);

  const run = async (id: string) => {
    setRunningId(id);
    try {
      const out = await runTask(id, lang);
      toast.success(out.queued > 0 ? t('run.queued', { count: out.queued }) : t('run.completed'));
      setOpenId(id);
    } catch (err) {
      toast.error(runErrorText(t, err));
    } finally {
      setRunningId(null);
      onChanged();
    }
  };

  return (
    <div>
      {canSeeUsage && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <Mini label={t('office.stat.cost')} value={usage ? fmt.currency(usage.cost) : '–'} />
          <Mini label={t('office.stat.runs')} value={usage ? fmt.number(usage.runs) : '–'} />
          <Mini label={t('office.stat.tokens')} value={usage ? fmt.number(usage.tokens) : '–'} />
          <Mini label={t('office.stat.latency')} value={usage && usage.avgLatencyMs ? `${fmt.number(Math.round(usage.avgLatencyMs / 100) / 10)} s` : '–'} />
        </div>
      )}

      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="fb-dim">{t('office.budget')}</span>
        <b>{budget != null ? fmt.currency(budget) : t('office.noBudget')}</b>
      </div>
      {budget != null && (
        <div className="mb-3 h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.06)' }}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--fb-err)' : color }} />
        </div>
      )}
      <div className="fb-dim text-xs">
        {t('office.autonomyLabel')}: <b className="text-[color:var(--fb-text)]">{t(`autonomy.${safeAutonomy(agent.autonomy)}.label` as TKey)}</b>
      </div>

      <div className="fb-eyebrow mb-2 mt-4">{t('office.tools', { count: tools.length })}</div>
      <div className="flex flex-wrap gap-1.5">
        {tools.map((x) => (
          <span key={x.tool_name} className="fb-chip" title={t(`policy.${x.policy}.hint` as TKey)} style={x.policy === 'approval' ? { color: 'var(--fb-warn)' } : x.policy === 'block' ? { color: 'var(--fb-err)' } : undefined}>
            {x.tool_name}
            {x.policy !== 'allow' && <span className="opacity-70"> · {t(`policy.${x.policy}` as TKey)}</span>}
          </span>
        ))}
      </div>

      <div className="fb-eyebrow mb-2 mt-4">{t('office.openTasks')}</div>
      {open.length === 0 ? (
        <p className="fb-dim text-sm">{t('office.noneAssigned')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {open.map((task) => (
            <li key={task.id} className="fb-row py-2">
              <StatusDot tone={task.status === 'running' ? 'ok' : task.status === 'awaiting_approval' ? 'warn' : 'idle'} />
              <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
              {canRun && ['pending', 'blocked', 'failed'].includes(task.status) ? (
                <button className="fb-btn fb-btn--primary" style={{ height: 28, padding: '0 10px', fontSize: 12 }} disabled={runningId !== null} onClick={() => void run(task.id)}>
                  {runningId === task.id ? t('run.busy') : t('office.run')}
                </button>
              ) : (
                <span className="fb-dim text-[11px]">{t(`status.${task.status}` as TKey)}</span>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="fb-eyebrow mb-2 mt-4">{t('office.recent')}</div>
      {done.length === 0 ? (
        <p className="fb-dim text-sm">{t('office.noResults')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {done.map((task) => (
            <li key={task.id} className="fb-row flex-col items-stretch gap-1 py-2">
              <button className="flex w-full cursor-pointer items-center gap-2 text-start" onClick={() => setOpenId(openId === task.id ? null : task.id)} aria-expanded={openId === task.id}>
                <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                <span className="fb-dim text-[11px]">{openId === task.id ? t('run.hide') : t('run.show')}</span>
              </button>
              {openId === task.id && task.result && (
                <div className="text-[13px]">
                  {task.result.summary && <p className="mb-1 font-medium">{task.result.summary}</p>}
                  <ReportView result={task.result} compact />
                  {task.result.error && <p style={{ color: 'var(--fb-err)' }}>{t(`run.err.${task.result.error === 'model_error' ? 'model_error' : 'unknown'}` as TKey)}</p>}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <Link to="/team" className="fb-link fb-muted mt-4 inline-block text-xs underline hover:text-white">
        {t('office.configure')} →
      </Link>
      <span className="sr-only">{agentLabel(agent, i18n).name}</span>
    </div>
  );
}
