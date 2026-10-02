import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { StatusDot } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createTask, setTaskStatus } from '../lib/company/data';
import { RunError, runTask } from '../lib/company/runner';
import { agentLabel } from '../lib/company/labels';
import { agentColor } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import {
  MANAGER_ROLES,
  OPEN_TASK_STATUSES,
  WRITER_ROLES,
  type TaskPriority,
  type TaskStatus,
} from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const STATUSES: TaskStatus[] = ['pending', 'running', 'blocked', 'awaiting_approval', 'completed', 'failed', 'cancelled'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
const PRIORITY_COLOR: Record<TaskPriority, string> = { low: 'var(--fb-dim)', normal: 'var(--fb-muted)', high: 'var(--fb-warn)', urgent: 'var(--fb-err)' };
type Filter = 'open' | 'done' | 'all';

export function TasksPage() {
  const i18n = useI18n();
  const { t, fmt, lang } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canWrite = WRITER_ROLES.includes(role);
  const data = useOrgData(orgId, MANAGER_ROLES.includes(role));
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [agentId, setAgentId] = useState('');
  const [due, setDue] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const now = Date.now();
  const shown = useMemo(
    () =>
      data.tasks.filter((x) => {
        const open = OPEN_TASK_STATUSES.includes(x.status);
        return filter === 'all' || (filter === 'open' ? open : !open);
      }),
    [data.tasks, filter],
  );
  const openCount = data.tasks.filter((x) => OPEN_TASK_STATUSES.includes(x.status)).length;
  const agent = (id: string | null) => data.agents.find((a) => a.id === id);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setBusy(true);
    try {
      await createTask({ orgId, userId: user.id, title, priority, agentId: agentId || null, dueAt: due ? new Date(due).toISOString() : null });
      setTitle('');
      setDue('');
      toast.success(t('tasks.created'));
      await data.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('tasks.createError'));
    } finally {
      setBusy(false);
    }
  };

  const run = async (id: string) => {
    setRunningId(id);
    try {
      const out = await runTask(id, lang);
      toast.success(out.queued > 0 ? t('run.queued', { count: out.queued }) : t('run.completed'));
      setOpenId(id);
    } catch (err) {
      const code = err instanceof RunError ? err.code : 'unknown';
      toast.error(t(`run.err.${code}` as TKey));
    } finally {
      setRunningId(null);
      await data.reload();
    }
  };

  const changeStatus = async (id: string, status: TaskStatus) => {
    try {
      await setTaskStatus(id, status);
      await data.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('tasks.updateError'));
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">{t('tasks.title')}</h1>
          <p className="fb-muted mt-1 text-sm">{t('tasks.sub', { count: openCount })}</p>
        </header>

        {canWrite && (
          <form onSubmit={create} className="fb-glass mb-4 p-4">
            <input className="fb-input" placeholder={t('tasks.titlePlaceholder')} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-label={t('tasks.titleAria')} />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select className="fb-input fb-w-role" style={{ width: 'auto', minWidth: 150 }} value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label={t('tasks.assignAria')}>
                <option value="">{t('tasks.anyAgent')}</option>
                {data.agents.filter((a) => a.enabled).map((a) => (
                  <option key={a.id} value={a.id}>
                    {agentLabel(a, i18n).name}
                  </option>
                ))}
              </select>
              <select className="fb-input" style={{ width: 'auto' }} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} aria-label={t('tasks.priorityAria')}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {t(`priority.${p}` as TKey)}
                  </option>
                ))}
              </select>
              <input className="fb-input" style={{ width: 'auto' }} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label={t('tasks.dueAria')} />
              <button className="fb-btn fb-btn--primary ms-auto" disabled={busy || !title.trim()}>
                {busy ? t('tasks.adding') : t('tasks.add')}
              </button>
            </div>
          </form>
        )}

        <div className="mb-3 flex gap-2" role="tablist">
          {(['open', 'done', 'all'] as const).map((f) => (
            <button
              key={f}
              role="tab"
              aria-selected={filter === f}
              onClick={() => setFilter(f)}
              className="fb-chip cursor-pointer"
              style={filter === f ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34, 211, 238,.1)' } : undefined}
            >
              {t(`tasks.f.${f}` as TKey)}
            </button>
          ))}
        </div>

        {data.error && (
          <p role="alert" className="fb-chip mb-3" style={{ color: 'var(--fb-err)' }}>
            {data.error}
          </p>
        )}

        {shown.length === 0 ? (
          <div className="fb-glass p-5 text-sm fb-muted">
            {filter === 'open' ? t('tasks.empty.open') : t('tasks.empty.other')}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((task) => {
              const a = agent(task.assigned_agent_id);
              const overdue = task.due_at && OPEN_TASK_STATUSES.includes(task.status) && Date.parse(task.due_at) < now;
              return (
                <li key={task.id} className="fb-glass flex flex-wrap items-center gap-3 p-3.5">
                  <StatusDot tone={task.status === 'running' ? 'ok' : task.status === 'completed' ? 'ok' : task.status === 'failed' ? 'err' : task.status === 'awaiting_approval' || overdue ? 'warn' : 'idle'} live={task.status === 'running'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{task.title}</div>
                    <div className="fb-dim flex flex-wrap gap-x-2 text-xs">
                      <span style={{ color: a ? agentColor(a.type, a.slug) : undefined }}>{a ? agentLabel(a, i18n).name : t('unassigned')}</span>
                      <span style={{ color: PRIORITY_COLOR[task.priority] }}>{t(`priority.${task.priority}` as TKey)}</span>
                      {task.due_at && (
                        <span style={{ color: overdue ? 'var(--fb-warn)' : undefined }}>
                          {t(overdue ? 'tasks.overdue' : 'tasks.due', { date: fmt.dateTime(task.due_at) })}
                        </span>
                      )}
                    </div>
                  </div>
                  {task.result && (task.result.report || task.result.error) && (
                    <button className="fb-link fb-muted cursor-pointer text-xs underline" onClick={() => setOpenId(openId === task.id ? null : task.id)}>
                      {openId === task.id ? t('run.hide') : t('run.show')}
                    </button>
                  )}
                  {canWrite && task.assigned_agent_id && ['pending', 'blocked', 'failed'].includes(task.status) && (
                    <button className="fb-btn fb-btn--primary" style={{ height: 32, padding: '0 14px', fontSize: 13 }} disabled={runningId !== null} onClick={() => void run(task.id)}>
                      {runningId === task.id ? t('run.busy') : task.status === 'failed' ? t('run.again') : t('run.btn')}
                    </button>
                  )}
                  <select
                    className="fb-input"
                    style={{ width: 'auto', height: 32, fontSize: 12 }}
                    value={task.status}
                    disabled={!canWrite}
                    aria-label={t('tasks.statusAria', { title: task.title })}
                    onChange={(e) => void changeStatus(task.id, e.target.value as TaskStatus)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}` as TKey)}
                      </option>
                    ))}
                  </select>
                  {openId === task.id && task.result && (
                    <div className="w-full rounded-xl p-3 text-sm" style={{ background: 'rgba(5,10,20,.7)', border: '1px solid var(--fb-border)' }}>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="fb-eyebrow">{t('run.result')}</span>
                        {task.result.ai_generated && <span className="fb-chip">{t('run.ai')}</span>}
                      </div>
                      {task.result.summary && <p className="mb-2 font-medium">{task.result.summary}</p>}
                      {task.result.report && <div className="fb-muted whitespace-pre-wrap break-words text-[13px] leading-relaxed">{task.result.report}</div>}
                      {task.result.error && <p style={{ color: 'var(--fb-err)' }}>{t(`run.err.${task.result.error === 'model_error' ? 'model_error' : 'unknown'}` as TKey)}</p>}
                      {task.result.actions && task.result.actions.length > 0 && (
                        <div className="mt-3">
                          <div className="fb-eyebrow mb-1">{t(task.result.queued ? 'run.actions' : 'run.suggested')}</div>
                          <ul className="flex flex-wrap gap-1.5">
                            {task.result.actions.map((x, i) => (
                              <li key={i} className="fb-chip">{x.action}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {task.result.dropped && task.result.dropped.length > 0 && (
                        <p className="fb-dim mt-2 text-xs">{t('run.dropped', { list: task.result.dropped.join(', ') })}</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
