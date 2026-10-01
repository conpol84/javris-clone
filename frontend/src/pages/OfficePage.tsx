import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createTask } from '../lib/company/data';
import { agentColor, deriveAgentStates, STATE_LABEL } from '../lib/company/status';
import { MANAGER_ROLES, OPEN_TASK_STATUSES, WRITER_ROLES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const OfficeScene = lazy(() => import('../components/scenes/OfficeScene'));

export function OfficePage() {
  const { current, user } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const data = useOrgData(orgId, MANAGER_ROLES.includes(role), 10_000);
  const states = useMemo(() => deriveAgentStates(data.agents, data.tasks, data.approvals), [data.agents, data.tasks, data.approvals]);
  const selectedId = params.get('agent');
  const selected = data.agents.find((a) => a.id === selectedId) ?? null;
  const [title, setTitle] = useState('');
  const canWrite = WRITER_ROLES.includes(role);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('agent', id);
    else next.delete('agent');
    setParams(next, { replace: true });
  };

  const assign = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected || !user || !title.trim()) return;
    try {
      await createTask({ orgId, userId: user.id, title, priority: 'normal', agentId: selected.id });
      setTitle('');
      toast.success(`Task assigned to ${selected.name}`);
      await data.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the task');
    }
  };

  const agentTasks = selected
    ? data.tasks.filter((t) => t.assigned_agent_id === selected.id && OPEN_TASK_STATUSES.includes(t.status)).slice(0, 5)
    : [];
  const open = data.tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status)).length;

  return (
    <div className="fb-root flex h-full flex-col lg:flex-row">
      <div className="relative min-h-[360px] flex-1">
        <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">Loading 3D office…</div>}>
          <OfficeScene
            agents={data.agents}
            states={states}
            selectedId={selectedId}
            onSelect={select}
            openTasks={open}
            pendingApprovals={data.approvals.length}
          />
        </Suspense>
        <div className="pointer-events-none absolute left-14 top-4 md:left-4">
          <div className="fb-eyebrow">3D office</div>
          <div className="fb-dim mt-1 text-xs">Drag to orbit · scroll to zoom · click a room</div>
        </div>
      </div>

      <aside className="w-full shrink-0 overflow-y-auto p-3 lg:w-[360px]">
        {selected ? (
          <Panel
            title={selected.name}
            right={
              <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => select(null)}>
                Close
              </button>
            }
          >
            <div className="fb-chip mb-3" style={{ color: agentColor(selected.type) }}>
              <StatusDot tone={states[selected.id] === 'active' ? 'ok' : states[selected.id] === 'waiting' ? 'warn' : 'idle'} live={states[selected.id] === 'active'} />
              {STATE_LABEL[states[selected.id] ?? 'idle']}
            </div>
            {selected.description && <p className="fb-muted text-sm">{selected.description}</p>}
            <div className="fb-dim mt-3 text-xs">
              Model <b className="text-[color:var(--fb-text)]">{selected.model}</b> ·{' '}
              {selected.autonomous ? 'autonomous' : 'asks before external actions'}
            </div>
            <div className="fb-eyebrow mb-2 mt-4">Tools ({selected.agent_tools.filter((t) => t.enabled).length})</div>
            <div className="flex flex-wrap gap-1.5">
              {selected.agent_tools
                .filter((t) => t.enabled)
                .map((t) => (
                  <span key={t.tool_name} className="fb-chip">
                    {t.tool_name}
                  </span>
                ))}
            </div>
            <div className="fb-eyebrow mb-2 mt-4">Open tasks</div>
            {agentTasks.length === 0 ? (
              <p className="fb-dim text-sm">Nothing assigned right now.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {agentTasks.map((t) => (
                  <li key={t.id} className="fb-row py-2">
                    <StatusDot tone={t.status === 'running' ? 'ok' : t.status === 'awaiting_approval' ? 'warn' : 'idle'} />
                    <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                    <span className="fb-dim text-[11px]">{t.status.replace('_', ' ')}</span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <form onSubmit={assign} className="mt-4 flex gap-2">
                <input className="fb-input" placeholder={`Assign a task to ${selected.name.replace(' Agent', '')}…`} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label="Task title" />
                <button className="fb-btn fb-btn--primary" style={{ height: 42 }} disabled={!title.trim()}>
                  Assign
                </button>
              </form>
            )}
          </Panel>
        ) : (
          <Panel title="Your AI team">
            {data.error && (
              <p role="alert" className="mb-2 text-xs" style={{ color: 'var(--fb-err)' }}>
                {data.error}
              </p>
            )}
            <ul className="flex flex-col gap-2">
              {data.agents.map((a) => {
                const st = states[a.id] ?? 'idle';
                return (
                  <li key={a.id}>
                    <button onClick={() => select(a.id)} className="fb-row fb-glass--hover w-full cursor-pointer text-left">
                      <span className="fb-dot" style={{ background: agentColor(a.type), boxShadow: `0 0 10px ${agentColor(a.type)}` }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.name}</span>
                      <span className="fb-dim text-xs">{STATE_LABEL[st]}</span>
                    </button>
                  </li>
                );
              })}
              {data.agents.length === 0 && !data.loading && <li className="fb-dim text-sm">No agents yet.</li>}
            </ul>
          </Panel>
        )}
      </aside>
    </div>
  );
}
