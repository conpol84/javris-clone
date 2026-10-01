import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Box, Brain, ListChecks, MessageSquare, ShieldCheck, Users, Waypoints } from 'lucide-react';
import { CommandDialog } from '../components/command/CommandDialog';
import { Panel, StatusDot, Wave } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { buildFeed, timeAgo } from '../lib/company/feed';
import { CHAT_PATH } from '../lib/company/routes';
import { agentLabel } from '../lib/company/labels';
import { agentColor, deriveAgentStates, STATE_KEY } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { MANAGER_ROLES, OPEN_TASK_STATUSES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import { useGateway } from '../lib/gateway';
import '../styles/firbo.css';

const CoreOrb = lazy(() => import('../components/scenes/CoreOrb'));

const LEVEL_TONE = { info: 'idle', ok: 'ok', warn: 'warn', err: 'err' } as const;

function greetingKey(hour: number): TKey {
  return hour < 5 ? 'cc.greet.late' : hour < 12 ? 'cc.greet.morning' : hour < 18 ? 'cc.greet.afternoon' : 'cc.greet.evening';
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

export function CommandCenterPage() {
  const navigate = useNavigate();
  const i18n = useI18n();
  const { t, fmt, rich } = i18n;
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const data = useOrgData(orgId, MANAGER_ROLES.includes(role));
  const gateway = useGateway();
  const now = useClock();
  const [commanding, setCommanding] = useState(false);

  const states = useMemo(() => deriveAgentStates(data.agents, data.tasks, data.approvals), [data.agents, data.tasks, data.approvals]);
  const satellites = useMemo(
    () => data.agents.map((a) => ({ id: a.id, color: agentColor(a.type, a.slug), active: states[a.id] === 'active' })),
    [data.agents, states],
  );
  const feed = useMemo(() => buildFeed(data.tasks, data.approvals, data.agents.map((a) => ({ ...a, name: agentLabel(a, i18n).name })), Date.now(), 8, i18n), [data.tasks, data.approvals, data.agents, i18n]);
  const openTasks = data.tasks.filter((task) => OPEN_TASK_STATUSES.includes(task.status));
  const timeline = [...openTasks]
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity))
    .slice(0, 5);
  const activeCount = Object.values(states).filter((s) => s === 'active').length;
  const name = (user?.email ?? '').split('@')[0];
  const gw = gateway.status === 'ready' ? gateway.data : null;
  const gwOnline = !!gw?.connected;
  const degraded = !!data.error;

  const readyCount = data.agents.filter((a) => a.enabled).length;
  const rows = [
    { icon: Brain, label: t('cc.row.core'), value: degraded ? t('cc.core.degraded') : data.loading ? t('cc.core.starting') : t('cc.core.online'), tone: degraded ? 'err' : 'ok' },
    { icon: ListChecks, label: t('cc.row.agents'), value: t('cc.agents.summary', { active: activeCount, ready: readyCount }), tone: activeCount ? 'ok' : 'idle' },
    { icon: ShieldCheck, label: t('cc.row.approvals'), value: t('cc.approvals.pending', { count: data.approvals.length }), tone: data.approvals.length ? 'warn' : 'ok' },
    { icon: Brain, label: t('cc.row.memory'), value: t('cc.memory.stored', { count: data.counts?.memories ?? '–' }), tone: 'idle' },
    {
      icon: Waypoints,
      label: t('cc.row.gateway'),
      value: gateway.status === 'loading' ? t('cc.gw.checking') : gwOnline ? t('cc.gw.models', { count: gw!.models.total }) : t('cc.gw.notConnected'),
      tone: gwOnline ? 'ok' : gateway.status === 'loading' ? 'idle' : 'warn',
    },
  ] as const;

  return (
    <div className="fb-root flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1500px] px-4 pb-6 pt-14 md:px-6 md:pt-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="fb-eyebrow">{current?.organization.name}</div>
            <h1 className="mt-1 text-xl font-semibold md:text-2xl">
              {rich('cc.greeting', { greeting: t(greetingKey(now.getHours())), name: <span className="fb-grad-text">{name}</span> })}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="fb-chip">
              <StatusDot tone={degraded ? 'err' : 'ok'} live /> {degraded ? t('cc.system.degraded') : t('cc.system.optimal')}
            </span>
            <div className="text-end">
              <div className="text-lg font-semibold tabular-nums">{fmt.time(now)}</div>
              <div className="fb-dim text-xs">{fmt.longDate(now)}</div>
            </div>
          </div>
        </header>

        {data.error && (
          <p role="alert" className="fb-chip mb-3" style={{ color: 'var(--fb-err)' }}>
            {t('cc.refreshError', { error: data.error })}
          </p>
        )}

        <div className="fb-cc">
          <Panel title={t('cc.overview')} area="overview">
            <ul className="flex flex-col gap-2">
              {rows.map(({ icon: Icon, label, value, tone }) => (
                <li key={label} className="fb-row">
                  <Icon size={16} style={{ color: 'var(--fb-accent)' }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{label}</div>
                    <div className="fb-dim truncate text-xs">{value}</div>
                  </div>
                  <StatusDot tone={tone} />
                </li>
              ))}
            </ul>
          </Panel>

          <section className="fb-glass fb-a-hero relative min-h-[320px] overflow-hidden md:min-h-[440px]" style={{ padding: 0 }}>
            <div className="fb-scan" />
            <Suspense fallback={null}>
              <CoreOrb satellites={satellites} className="absolute inset-0" />
            </Suspense>
            <div className="pointer-events-none absolute inset-x-0 bottom-5 text-center">
              <div className="fb-grad-text text-2xl font-bold tracking-[0.35em] md:text-3xl">FIRBO AI</div>
              <div className="fb-eyebrow mt-1">{t('cc.orb.sub', { count: data.agents.length })}</div>
            </div>
          </section>

          <Panel
            title={t('cc.feed')}
            area="feed"
            right={
              <span className="fb-chip">
                <StatusDot tone="ok" live /> {t('cc.live')}
              </span>
            }
          >
            {feed.length === 0 ? (
              <p className="fb-dim text-sm">{t('cc.feed.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {feed.map((e) => (
                  <li key={e.id} className="fb-row fb-start">
                    <span className="mt-1.5">
                      <StatusDot tone={LEVEL_TONE[e.level]} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{e.title}</div>
                      <div className="fb-dim truncate text-xs">
                        <b style={{ color: `var(--fb-${e.level === 'info' ? 'accent' : e.level})` }}><span className="uppercase">{e.tag}</span></b> · {e.detail} · {timeAgo(e.at, Date.now(), fmt)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title={t('cc.agents')}
            area="agents"
            right={
              <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => navigate('/office')}>
                {t('cc.agents.viewOffice')}
              </button>
            }
          >
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {data.agents.map((a) => {
                const st = states[a.id] ?? 'idle';
                const color = agentColor(a.type, a.slug);
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => navigate(`/office?agent=${a.id}`)}
                      className="fb-row fb-glass--hover w-full cursor-pointer text-start"
                      style={{ borderColor: st === 'active' ? `${color}66` : undefined }}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1f`, border: `1px solid ${color}55` }}>
                        <span className="fb-dot" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{agentLabel(a, i18n).name}</div>
                        <div className="fb-dim flex items-center gap-1.5 text-xs">
                          <StatusDot tone={st === 'active' ? 'ok' : st === 'waiting' ? 'warn' : 'idle'} live={st === 'active'} />
                          {t(STATE_KEY[st])}
                        </div>
                      </div>
                      <Wave color={color} active={st === 'active'} />
                    </button>
                  </li>
                );
              })}
              {data.agents.length === 0 && !data.loading && <li className="fb-dim text-sm">{t('cc.agents.none')}</li>}
            </ul>
          </Panel>

          <Panel title={t('cc.commands')} area="commands">
            <ul className="flex flex-col gap-2">
              {[
                { icon: ListChecks, label: t('cc.cmd.newTask'), to: '/tasks' },
                { icon: Box, label: t('cc.cmd.office'), to: '/office' },
                { icon: ShieldCheck, label: data.approvals.length ? t('cc.cmd.approvalsN', { count: data.approvals.length }) : t('cc.cmd.approvals'), to: '/inbox' },
                { icon: Users, label: t('cc.cmd.hire'), to: '/team' },
                { icon: Waypoints, label: t('cc.cmd.gateway'), to: '/gateway' },
                { icon: MessageSquare, label: t('cc.cmd.chat'), to: CHAT_PATH },
              ].map(({ icon: Icon, label, to }) => (
                <li key={label}>
                  <button className="fb-row fb-glass--hover w-full cursor-pointer text-start" onClick={() => navigate(to)}>
                    <Icon size={16} style={{ color: 'var(--fb-accent)' }} />
                    <span className="flex-1 text-sm font-medium">{label}</span>
                    <ArrowRight size={14} className="fb-dim rtl:rotate-180" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title={t('cc.timeline')} area="timeline">
            {timeline.length === 0 ? (
              <p className="fb-dim text-sm">{t('cc.timeline.empty')}</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {timeline.map((task) => {
                  const overdue = task.due_at && Date.parse(task.due_at) < now.getTime();
                  return (
                    <li key={task.id} className="flex items-start gap-3">
                      <span className="mt-1.5">
                        <StatusDot tone={overdue ? 'warn' : task.status === 'running' ? 'ok' : 'idle'} live={task.status === 'running'} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{task.title}</div>
                        <div className="fb-dim text-xs">
                          {task.due_at ? t(overdue ? 'cc.timeline.overdue' : 'cc.timeline.due', { date: fmt.dateTime(task.due_at) }) : t('cc.timeline.noDeadline')} · {t(`status.${task.status}` as TKey)}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title={t('cc.memory')} area="memory">
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                [t('cc.mem.memories'), data.counts?.memories],
                [t('cc.mem.sources'), data.counts?.knowledgeSources],
                [t('cc.mem.workflows'), data.counts?.workflows],
              ].map(([label, value]) => (
                <div key={label as string} className="fb-row flex-col py-4">
                  <div className="fb-grad-text text-2xl font-bold tabular-nums">{value ?? '–'}</div>
                  <div className="fb-dim text-xs">{label}</div>
                </div>
              ))}
            </div>
            {data.counts && MANAGER_ROLES.includes(role) && (
              <p className="fb-dim mt-3 text-xs">
                {t('cc.mem.usage', { tokens: fmt.number(data.counts.tokens30d), cost: fmt.currency(data.counts.cost30d) })}
              </p>
            )}
          </Panel>

          <Panel
            title={t('cc.gateway')}
            area="llm"
            right={
              <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => navigate('/gateway')}>
                {t('cc.gw.manage')}
              </button>
            }
          >
            {gateway.status === 'loading' ? (
              <p className="fb-dim text-sm">{t('cc.gw.checking')}</p>
            ) : gateway.status === 'unreachable' ? (
              <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
                {t('cc.gw.unreachable')}
              </p>
            ) : !gwOnline ? (
              <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
                {t('cc.gw.offline')}
              </p>
            ) : gw!.connections.length === 0 ? (
              <p className="fb-dim text-sm">{t('cc.gw.noProviders')}</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {gw!.connections.slice(0, 8).map((c) => (
                  <li key={c.provider} className="fb-row py-2">
                    <StatusDot tone={c.limited ? 'warn' : c.healthy ? 'ok' : 'idle'} />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{c.provider}</div>
                      <div className="fb-dim text-[11px]">{t('cc.gw.connected', { count: c.connections })}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      </div>
      <div className="relative z-10 flex shrink-0 justify-center px-4 pb-4 pt-1">
        <button className="fb-talk" onClick={() => setCommanding(true)}>
          <Wave color="var(--fb-accent)" />
          {t('cc.talk')}
          <Wave color="var(--fb-accent)" />
        </button>
      </div>
      {commanding && <CommandDialog agents={data.agents} onClose={() => setCommanding(false)} />}
    </div>
  );
}
