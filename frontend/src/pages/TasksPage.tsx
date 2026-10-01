import { useMemo, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { StatusDot } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createTask, setTaskStatus } from '../lib/company/data';
import { agentColor } from '../lib/company/status';
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

  const now = Date.now();
  const shown = useMemo(
    () =>
      data.tasks.filter((t) => {
        const open = OPEN_TASK_STATUSES.includes(t.status);
        return filter === 'all' || (filter === 'open' ? open : !open);
      }),
    [data.tasks, filter],
  );
  const openCount = data.tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status)).length;
  const agent = (id: string | null) => data.agents.find((a) => a.id === id);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    setBusy(true);
    try {
      await createTask({ orgId, userId: user.id, title, priority, agentId: agentId || null, dueAt: due ? new Date(due).toISOString() : null });
      setTitle('');
      setDue('');
      toast.success('Task created');
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the task');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (id: string, status: TaskStatus) => {
    try {
      await setTaskStatus(id, status);
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the task');
    }
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5">
          <div className="fb-eyebrow">{current?.organization.name}</div>
          <h1 className="mt-1 text-2xl font-semibold">Tasks</h1>
          <p className="fb-muted mt-1 text-sm">Give your AI team work, with a deadline if it matters. {openCount} open.</p>
        </header>

        {canWrite && (
          <form onSubmit={create} className="fb-glass mb-4 p-4">
            <input className="fb-input" placeholder="What should your team do?" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Task title" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select className="fb-input fb-w-role" style={{ width: 'auto', minWidth: 150 }} value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Assign to agent">
                <option value="">Any agent</option>
                {data.agents.filter((a) => a.enabled).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select className="fb-input" style={{ width: 'auto' }} value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} aria-label="Priority">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <input className="fb-input" style={{ width: 'auto' }} type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" />
              <button className="fb-btn fb-btn--primary ml-auto" disabled={busy || !title.trim()}>
                {busy ? 'Adding…' : 'Add task'}
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
              style={filter === f ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)', background: 'rgba(34,211,238,.1)' } : undefined}
            >
              {f === 'open' ? 'Open' : f === 'done' ? 'Finished' : 'All'}
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
            {filter === 'open' ? 'No open tasks. Add one above and an agent will pick it up.' : 'Nothing here yet.'}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((t) => {
              const a = agent(t.assigned_agent_id);
              const overdue = t.due_at && OPEN_TASK_STATUSES.includes(t.status) && Date.parse(t.due_at) < now;
              return (
                <li key={t.id} className="fb-glass flex flex-wrap items-center gap-3 p-3.5">
                  <StatusDot tone={t.status === 'running' ? 'ok' : t.status === 'completed' ? 'ok' : t.status === 'failed' ? 'err' : t.status === 'awaiting_approval' || overdue ? 'warn' : 'idle'} live={t.status === 'running'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="fb-dim flex flex-wrap gap-x-2 text-xs">
                      <span style={{ color: a ? agentColor(a.type, a.slug) : undefined }}>{a?.name ?? 'Unassigned'}</span>
                      <span style={{ color: PRIORITY_COLOR[t.priority] }}>{t.priority}</span>
                      {t.due_at && (
                        <span style={{ color: overdue ? 'var(--fb-warn)' : undefined }}>
                          {overdue ? 'Overdue · ' : 'Due '}
                          {new Date(t.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <select
                    className="fb-input"
                    style={{ width: 'auto', height: 32, fontSize: 12 }}
                    value={t.status}
                    disabled={!canWrite}
                    aria-label={`Status of ${t.title}`}
                    onChange={(e) => void changeStatus(t.id, e.target.value as TaskStatus)}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
