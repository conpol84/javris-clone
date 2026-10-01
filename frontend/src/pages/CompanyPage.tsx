import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import {
  createTask,
  decideApproval,
  listAgents,
  listPendingApprovals,
  listTasks,
  loadCounts,
  setAgentEnabled,
  setTaskStatus,
} from '../lib/company/data';
import {
  MANAGER_ROLES,
  OPEN_TASK_STATUSES,
  WRITER_ROLES,
  type AgentRow,
  type ApprovalRow,
  type OrgCounts,
  type TaskPriority,
  type TaskRow,
  type TaskStatus,
} from '../lib/company/types';

const STATUSES: TaskStatus[] = ['pending', 'running', 'blocked', 'awaiting_approval', 'completed', 'failed', 'cancelled'];
const PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

const panel = {
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-text)',
} as const;
const field = {
  background: 'var(--color-input-bg)',
  border: '1px solid var(--color-input-border)',
  color: 'var(--color-text)',
} as const;
const muted = { color: 'var(--color-text-tertiary)' } as const;

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Request failed';
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl px-4 py-3" style={panel}>
      <div className="text-xs" style={muted}>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

export function CompanyPage() {
  const { current, user, memberships, selectOrg, signOut } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canManage = MANAGER_ROLES.includes(role);
  const canWrite = WRITER_ROLES.includes(role);
  const canSeeUsage = MANAGER_ROLES.includes(role);

  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [counts, setCounts] = useState<OrgCounts | null>(null);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const [agentId, setAgentId] = useState('');

  const reload = useCallback(async () => {
    if (!orgId) return;
    try {
      const [a, t, p, c] = await Promise.all([
        listAgents(orgId),
        listTasks(orgId),
        listPendingApprovals(orgId),
        loadCounts(orgId, canSeeUsage),
      ]);
      setAgents(a);
      setTasks(t);
      setApprovals(p);
      setCounts(c);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setLoading(false);
    }
  }, [orgId, canSeeUsage]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? 'Unassigned';
  const openTasks = tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status)).length;

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      await reload();
    } catch (err) {
      toast.error(message(err));
    }
  };

  const onCreateTask = (e: FormEvent) => {
    e.preventDefault();
    if (!user || !title.trim()) return;
    void run(async () => {
      await createTask({ orgId, userId: user.id, title, priority, agentId: agentId || null });
      setTitle('');
    }, 'Task created');
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
              {current?.organization.name}
            </h1>
            <p className="text-xs" style={muted}>
              {user?.email} · {role}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {memberships.length > 1 && (
              <select
                aria-label="Switch company"
                value={orgId}
                onChange={(e) => selectOrg(e.target.value)}
                className="h-8 rounded-lg px-2 text-xs"
                style={field}
              >
                {memberships.map((m) => (
                  <option key={m.organization.id} value={m.organization.id}>
                    {m.organization.name}
                  </option>
                ))}
              </select>
            )}
            <button
              onClick={() => void signOut()}
              className="h-8 rounded-lg px-3 text-xs cursor-pointer"
              style={{ ...panel, color: 'var(--color-text-secondary)' }}
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Agents" value={agents.filter((a) => a.enabled).length} />
          <Stat label="Open tasks" value={openTasks} />
          <Stat label="Awaiting approval" value={approvals.length} />
          <Stat label="Memories" value={counts?.memories ?? '–'} />
          <Stat label="Workflows" value={counts?.workflows ?? '–'} />
          <Stat label="Knowledge sources" value={counts?.knowledgeSources ?? '–'} />
          {canSeeUsage && <Stat label="Tokens (30d)" value={counts ? counts.tokens30d.toLocaleString() : '–'} />}
          {canSeeUsage && <Stat label="Cost (30d)" value={counts ? `$${counts.cost30d.toFixed(2)}` : '–'} />}
        </section>

        {loading && (
          <p className="text-sm" style={muted}>
            Loading…
          </p>
        )}

        <section className="rounded-xl p-4" style={panel}>
          <h2 className="mb-3 text-sm font-semibold">Approvals</h2>
          {approvals.length === 0 ? (
            <p className="text-xs" style={muted}>
              Nothing is waiting for approval.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {approvals.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3" style={field}>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{a.action}</div>
                    <div className="truncate text-xs" style={muted}>
                      {agentName(a.agent_id)} · {new Date(a.requested_at).toLocaleString()}
                    </div>
                  </div>
                  {canManage && user && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => void run(() => decideApproval(a.id, user.id, 'approved'), 'Approved')}
                        className="h-7 rounded-lg px-3 text-xs cursor-pointer"
                        style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => void run(() => decideApproval(a.id, user.id, 'rejected'), 'Rejected')}
                        className="h-7 rounded-lg px-3 text-xs cursor-pointer"
                        style={{ ...panel, color: 'var(--color-error)' }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl p-4" style={panel}>
          <h2 className="mb-3 text-sm font-semibold">Tasks</h2>
          {canWrite && (
            <form onSubmit={onCreateTask} className="mb-4 flex flex-wrap gap-2">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="New task…"
                maxLength={200}
                className="h-8 min-w-[12rem] flex-1 rounded-lg px-3 text-sm outline-none"
                style={field}
              />
              <select aria-label="Assign to agent" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-8 rounded-lg px-2 text-xs" style={field}>
                <option value="">Unassigned</option>
                {agents.filter((a) => a.enabled).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
              <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)} className="h-8 rounded-lg px-2 text-xs" style={field}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={!title.trim()}
                className="h-8 rounded-lg px-3 text-xs font-medium cursor-pointer disabled:opacity-50"
                style={{ background: 'var(--color-accent)', color: 'var(--color-on-accent)' }}
              >
                Add
              </button>
            </form>
          )}
          {tasks.length === 0 ? (
            <p className="text-xs" style={muted}>
              No tasks yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {tasks.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3" style={field}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{t.title}</div>
                    <div className="text-xs" style={muted}>
                      {agentName(t.assigned_agent_id)} · {t.priority}
                    </div>
                  </div>
                  <select
                    aria-label={`Status of ${t.title}`}
                    value={t.status}
                    disabled={!canWrite}
                    onChange={(e) => void run(() => setTaskStatus(t.id, e.target.value as TaskStatus))}
                    className="h-7 rounded-lg px-2 text-xs"
                    style={panel}
                  >
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl p-4" style={panel}>
          <h2 className="mb-3 text-sm font-semibold">AI team</h2>
          <ul className="grid gap-2 md:grid-cols-2">
            {agents.map((a) => (
              <li key={a.id} className="rounded-lg p-3" style={field}>
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{a.name}</div>
                  <label className="flex items-center gap-1.5 text-xs" style={muted}>
                    <input
                      type="checkbox"
                      checked={a.enabled}
                      disabled={!canManage}
                      onChange={(e) => void run(() => setAgentEnabled(a.id, e.target.checked))}
                    />
                    {a.enabled ? 'Enabled' : 'Disabled'}
                  </label>
                </div>
                {a.description && (
                  <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {a.description}
                  </p>
                )}
                <p className="mt-2 text-xs" style={muted}>
                  {a.agent_tools.filter((t) => t.enabled).length} tools · model {a.model}
                  {a.autonomous ? ' · autonomous' : ' · needs approval for external actions'}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
