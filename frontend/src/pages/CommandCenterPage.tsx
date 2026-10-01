import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowRight, Box, Brain, ListChecks, MessageSquare, ShieldCheck, Users, Waypoints } from 'lucide-react';
import { Panel, StatusDot, Wave } from '../components/command/Panel';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { buildFeed, timeAgo } from '../lib/company/feed';
import { CHAT_PATH } from '../lib/company/routes';
import { agentColor, deriveAgentStates, STATE_LABEL } from '../lib/company/status';
import { MANAGER_ROLES, OPEN_TASK_STATUSES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import { useGateway } from '../lib/gateway';
import '../styles/firbo.css';

const CoreOrb = lazy(() => import('../components/scenes/CoreOrb'));

const LEVEL_TONE = { info: 'idle', ok: 'ok', warn: 'warn', err: 'err' } as const;

function greeting(hour: number): string {
  return hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
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
  const { current, user } = useCompanyAuth();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const data = useOrgData(orgId, MANAGER_ROLES.includes(role));
  const gateway = useGateway();
  const now = useClock();

  const states = useMemo(() => deriveAgentStates(data.agents, data.tasks, data.approvals), [data.agents, data.tasks, data.approvals]);
  const satellites = useMemo(
    () => data.agents.map((a) => ({ id: a.id, color: agentColor(a.type, a.slug), active: states[a.id] === 'active' })),
    [data.agents, states],
  );
  const feed = useMemo(() => buildFeed(data.tasks, data.approvals, data.agents), [data.tasks, data.approvals, data.agents]);
  const openTasks = data.tasks.filter((t) => OPEN_TASK_STATUSES.includes(t.status));
  const timeline = [...openTasks]
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : Infinity) - (b.due_at ? Date.parse(b.due_at) : Infinity))
    .slice(0, 5);
  const activeCount = Object.values(states).filter((s) => s === 'active').length;
  const name = (user?.email ?? 'there').split('@')[0];
  const gw = gateway.status === 'ready' ? gateway.data : null;
  const gwOnline = !!gw?.connected;
  const degraded = !!data.error;

  const rows = [
    { icon: Brain, label: 'AI Core', value: degraded ? 'Degraded' : data.loading ? 'Starting…' : 'Online', tone: degraded ? 'err' : 'ok' },
    { icon: ListChecks, label: 'Agents', value: `${activeCount} active · ${data.agents.filter((a) => a.enabled).length} ready`, tone: activeCount ? 'ok' : 'idle' },
    { icon: ShieldCheck, label: 'Approvals', value: `${data.approvals.length} pending`, tone: data.approvals.length ? 'warn' : 'ok' },
    { icon: Brain, label: 'Memory', value: `${data.counts?.memories ?? '–'} stored`, tone: 'idle' },
    {
      icon: Waypoints,
      label: 'AI Gateway',
      value: gateway.status === 'loading' ? 'Checking…' : gwOnline ? `${gw!.models.total} models` : 'Not connected',
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
              {greeting(now.getHours())}, <span className="fb-grad-text">{name}</span>
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="fb-chip">
              <StatusDot tone={degraded ? 'err' : 'ok'} live /> SYSTEM {degraded ? 'DEGRADED' : 'OPTIMAL'}
            </span>
            <div className="text-right">
              <div className="text-lg font-semibold tabular-nums">{now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
              <div className="fb-dim text-xs">{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</div>
            </div>
          </div>
        </header>

        {data.error && (
          <p role="alert" className="fb-chip mb-3" style={{ color: 'var(--fb-err)' }}>
            Could not refresh company data: {data.error}
          </p>
        )}

        <div className="fb-cc">
          <Panel title="AI Core overview" area="overview">
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
              <div className="fb-eyebrow mt-1">AI core · {data.agents.length} agents online</div>
            </div>
          </section>

          <Panel
            title="Live intelligence feed"
            area="feed"
            right={
              <span className="fb-chip">
                <StatusDot tone="ok" live /> LIVE
              </span>
            }
          >
            {feed.length === 0 ? (
              <p className="fb-dim text-sm">Nothing yet. Tasks and approvals will stream in here as your agents work.</p>
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
                        <b style={{ color: `var(--fb-${e.level === 'info' ? 'accent' : e.level})` }}>{e.tag}</b> · {e.detail} · {timeAgo(e.at)}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Active agents"
            area="agents"
            right={
              <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => navigate('/office')}>
                View in 3D office →
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
                      className="fb-row fb-glass--hover w-full cursor-pointer text-left"
                      style={{ borderColor: st === 'active' ? `${color}66` : undefined }}
                    >
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1f`, border: `1px solid ${color}55` }}>
                        <span className="fb-dot" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{a.name}</div>
                        <div className="fb-dim flex items-center gap-1.5 text-xs">
                          <StatusDot tone={st === 'active' ? 'ok' : st === 'waiting' ? 'warn' : 'idle'} live={st === 'active'} />
                          {STATE_LABEL[st]}
                        </div>
                      </div>
                      <Wave color={color} active={st === 'active'} />
                    </button>
                  </li>
                );
              })}
              {data.agents.length === 0 && !data.loading && <li className="fb-dim text-sm">No agents yet.</li>}
            </ul>
          </Panel>

          <Panel title="Quick commands" area="commands">
            <ul className="flex flex-col gap-2">
              {[
                { icon: ListChecks, label: 'Start new task', to: '/tasks' },
                { icon: Box, label: 'Open 3D office', to: '/office' },
                { icon: ShieldCheck, label: `Review approvals${data.approvals.length ? ` (${data.approvals.length})` : ''}`, to: '/inbox' },
                { icon: Users, label: 'Hire an AI employee', to: '/team' },
                { icon: Waypoints, label: 'AI Gateway', to: '/gateway' },
                { icon: MessageSquare, label: 'Chat with Firbo AI', to: CHAT_PATH },
              ].map(({ icon: Icon, label, to }) => (
                <li key={label}>
                  <button className="fb-row fb-glass--hover w-full cursor-pointer text-left" onClick={() => navigate(to)}>
                    <Icon size={16} style={{ color: 'var(--fb-accent)' }} />
                    <span className="flex-1 text-sm font-medium">{label}</span>
                    <ArrowRight size={14} className="fb-dim" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>

          <Panel title="Mission timeline" area="timeline">
            {timeline.length === 0 ? (
              <p className="fb-dim text-sm">No open tasks. Create one to put your agents to work.</p>
            ) : (
              <ul className="flex flex-col gap-2.5">
                {timeline.map((t) => {
                  const overdue = t.due_at && Date.parse(t.due_at) < now.getTime();
                  return (
                    <li key={t.id} className="flex items-start gap-3">
                      <span className="mt-1.5">
                        <StatusDot tone={overdue ? 'warn' : t.status === 'running' ? 'ok' : 'idle'} live={t.status === 'running'} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{t.title}</div>
                        <div className="fb-dim text-xs">
                          {t.due_at ? `${overdue ? 'Overdue · ' : 'Due '}${new Date(t.due_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'No deadline'} · {t.status.replace('_', ' ')}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel title="Memory & knowledge" area="memory">
            <div className="grid grid-cols-3 gap-3 text-center">
              {[
                ['Memories', data.counts?.memories],
                ['Sources', data.counts?.knowledgeSources],
                ['Workflows', data.counts?.workflows],
              ].map(([label, value]) => (
                <div key={label as string} className="fb-row flex-col py-4">
                  <div className="fb-grad-text text-2xl font-bold tabular-nums">{value ?? '–'}</div>
                  <div className="fb-dim text-xs">{label}</div>
                </div>
              ))}
            </div>
            {data.counts && MANAGER_ROLES.includes(role) && (
              <p className="fb-dim mt-3 text-xs">
                Last 30 days: {data.counts.tokens30d.toLocaleString()} tokens · ${data.counts.cost30d.toFixed(2)}
              </p>
            )}
          </Panel>

          <Panel
            title="AI gateway status"
            area="llm"
            right={
              <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={() => navigate('/gateway')}>
                Manage →
              </button>
            }
          >
            {gateway.status === 'loading' ? (
              <p className="fb-dim text-sm">Checking gateway…</p>
            ) : gateway.status === 'unreachable' ? (
              <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
                Firbo backend isn't reachable from here, so gateway status is unavailable.
              </p>
            ) : !gwOnline ? (
              <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>
                Gateway offline. Start it and set <code>OMNIROUTE_HOST</code> on the backend.
              </p>
            ) : gw!.connections.length === 0 ? (
              <p className="fb-dim text-sm">Gateway online, but no providers are connected yet.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-2">
                {gw!.connections.slice(0, 8).map((c) => (
                  <li key={c.provider} className="fb-row py-2">
                    <StatusDot tone={c.limited ? 'warn' : c.healthy ? 'ok' : 'idle'} />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold">{c.provider}</div>
                      <div className="fb-dim text-[11px]">{c.connections} connected</div>
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
        <button className="fb-talk" onClick={() => navigate(CHAT_PATH)}>
          <Wave color="var(--fb-accent)" />
          Talk to Firbo AI
          <Wave color="var(--fb-accent)" />
        </button>
      </div>
    </div>
  );
}
