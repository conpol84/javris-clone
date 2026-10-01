import { lazy, Suspense, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { createTask } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { agentColor, deriveAgentStates, STATE_KEY, type AgentState } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { MANAGER_ROLES, OPEN_TASK_STATUSES, WRITER_ROLES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const OfficeScene = lazy(() => import('../components/scenes/OfficeScene'));

export function OfficePage() {
  const i18n = useI18n();
  const { t, lang } = i18n;
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

  const nameOf = (a: { slug: string; name: string }) => agentLabel(a, i18n).name;
  const shortName = (a: { slug: string; name: string }) => (lang === 'en' ? nameOf(a).replace(' Agent', '') : nameOf(a));
  const stateText = (s: AgentState) => t(STATE_KEY[s]);

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
      toast.success(t('office.assigned', { agent: nameOf(selected) }));
      await data.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('tasks.createError'));
    }
  };

  const agentTasks = selected
    ? data.tasks.filter((x) => x.assigned_agent_id === selected.id && OPEN_TASK_STATUSES.includes(x.status)).slice(0, 5)
    : [];
  const open = data.tasks.filter((x) => OPEN_TASK_STATUSES.includes(x.status)).length;

  return (
    <div className="fb-root flex h-full flex-col lg:flex-row">
      <div className="relative min-h-[360px] flex-1">
        <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
          <OfficeScene
            agents={data.agents}
            states={states}
            selectedId={selectedId}
            onSelect={select}
            openTasks={open}
            pendingApprovals={data.approvals.length}
            labels={{
              agentName: shortName,
              state: { active: stateText('active'), waiting: stateText('waiting'), idle: stateText('idle'), disabled: stateText('disabled') },
              tableOpen: t('office.tableOpen', { count: open }),
              tableApprovals: t('office.tableApprovals', { count: data.approvals.length }),
              noWebgl: t('office.noWebgl'),
            }}
          />
        </Suspense>
        <div className="pointer-events-none absolute start-14 top-4 md:start-4">
          <div className="fb-eyebrow">{t('office.eyebrow')}</div>
          <div className="fb-dim mt-1 text-xs">{t('office.hint')}</div>
        </div>
      </div>

      <aside className="w-full shrink-0 overflow-y-auto p-3 lg:w-[360px]">
        {selected ? (
          <Panel
            title={nameOf(selected)}
            right={
              <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => select(null)}>
                {t('common.close')}
              </button>
            }
          >
            <div className="fb-chip mb-3" style={{ color: agentColor(selected.type, selected.slug) }}>
              <StatusDot tone={states[selected.id] === 'active' ? 'ok' : states[selected.id] === 'waiting' ? 'warn' : 'idle'} live={states[selected.id] === 'active'} />
              {stateText(states[selected.id] ?? 'idle')}
            </div>
            {selected.description && <p className="fb-muted text-sm">{agentLabel(selected, i18n).description}</p>}
            <div className="fb-dim mt-3 text-xs">
              {t('office.model')} <b className="text-[color:var(--fb-text)]">{selected.model}</b> ·{' '}
              {selected.autonomous ? t('office.autonomous') : t('office.asksBefore')}
            </div>
            <div className="fb-eyebrow mb-2 mt-4">{t('office.tools', { count: selected.agent_tools.filter((x) => x.enabled).length })}</div>
            <div className="flex flex-wrap gap-1.5">
              {selected.agent_tools
                .filter((x) => x.enabled)
                .map((x) => (
                  <span key={x.tool_name} className="fb-chip">
                    {x.tool_name}
                  </span>
                ))}
            </div>
            <div className="fb-eyebrow mb-2 mt-4">{t('office.openTasks')}</div>
            {agentTasks.length === 0 ? (
              <p className="fb-dim text-sm">{t('office.noneAssigned')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {agentTasks.map((task) => (
                  <li key={task.id} className="fb-row py-2">
                    <StatusDot tone={task.status === 'running' ? 'ok' : task.status === 'awaiting_approval' ? 'warn' : 'idle'} />
                    <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                    <span className="fb-dim text-[11px]">{t(`status.${task.status}` as TKey)}</span>
                  </li>
                ))}
              </ul>
            )}
            {canWrite && (
              <form onSubmit={assign} className="mt-4 flex gap-2">
                <input className="fb-input" placeholder={t('office.assignPlaceholder', { agent: shortName(selected) })} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} aria-label={t('office.taskTitleAria')} />
                <button className="fb-btn fb-btn--primary" style={{ height: 42 }} disabled={!title.trim()}>
                  {t('office.assign')}
                </button>
              </form>
            )}
          </Panel>
        ) : (
          <Panel title={t('office.team')}>
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
                    <button onClick={() => select(a.id)} className="fb-row fb-glass--hover w-full cursor-pointer text-start">
                      <span className="fb-dot" style={{ background: agentColor(a.type, a.slug), boxShadow: `0 0 10px ${agentColor(a.type, a.slug)}` }} />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{nameOf(a)}</span>
                      <span className="fb-dim text-xs">{stateText(st)}</span>
                    </button>
                  </li>
                );
              })}
              {data.agents.length === 0 && !data.loading && <li className="fb-dim text-sm">{t('office.noAgents')}</li>}
            </ul>
          </Panel>
        )}
      </aside>
    </div>
  );
}
