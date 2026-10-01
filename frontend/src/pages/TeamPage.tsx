import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { StatusDot, Wave } from '../components/command/Panel';
import { AgentDrawer } from '../components/team/AgentDrawer';
import { HireDialog } from '../components/team/HireDialog';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { loadDecisionStats, loadMonthlySpend } from '../lib/company/data';
import { agentColor, deriveAgentStates, STATE_LABEL } from '../lib/company/status';
import { AUTONOMY_LEVELS } from '../lib/company/templates';
import { MANAGER_ROLES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

export function TeamPage() {
  const { current } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canManage = MANAGER_ROLES.includes(role);
  const data = useOrgData(orgId, canManage);
  const [hiring, setHiring] = useState(false);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof loadDecisionStats>>>({});
  const [spend, setSpend] = useState<Record<string, number>>({});
  const states = useMemo(() => deriveAgentStates(data.agents, data.tasks, data.approvals), [data.agents, data.tasks, data.approvals]);
  const selected = data.agents.find((a) => a.id === params.get('agent')) ?? null;

  const loadExtras = useCallback(async () => {
    if (!orgId) return;
    try {
      setStats(await loadDecisionStats(orgId));
      if (canManage) setSpend(await loadMonthlySpend(orgId));
    } catch {
      /* optional enrichment: the page works without it */
    }
  }, [orgId, canManage]);
  useEffect(() => {
    void loadExtras();
  }, [loadExtras, data.approvals.length]);

  const select = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('agent', id);
    else next.delete('agent');
    setParams(next, { replace: true });
  };
  const changed = () => {
    void data.reload();
    void loadExtras();
  };

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto max-w-[1300px] px-4 pb-8 pt-14 md:px-6 md:pt-6">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="fb-eyebrow">{current?.organization.name}</div>
            <h1 className="mt-1 text-2xl font-semibold">AI Team</h1>
            <p className="fb-muted mt-1 text-sm">{data.agents.length} employees · decide what each one may do on its own.</p>
          </div>
          {canManage && (
            <button className="fb-btn fb-btn--primary" onClick={() => setHiring(true)}>
              <Plus size={16} /> Hire an AI employee
            </button>
          )}
        </header>

        {data.error && (
          <p role="alert" className="fb-chip mb-3" style={{ color: 'var(--fb-err)' }}>
            {data.error}
          </p>
        )}

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <ul className="grid content-start gap-3 sm:grid-cols-2">
            {data.agents.map((a) => {
              const st = states[a.id] ?? 'idle';
              const color = agentColor(a.type, a.slug);
              const ask = a.agent_tools.filter((t) => t.policy === 'approval').length;
              const blocked = a.agent_tools.filter((t) => t.policy === 'block').length;
              const lvl = AUTONOMY_LEVELS.find((l) => l.id === a.autonomy);
              return (
                <li key={a.id}>
                  <button
                    onClick={() => select(a.id === selected?.id ? null : a.id)}
                    className="fb-glass fb-glass--hover w-full cursor-pointer p-4 text-left"
                    style={{ borderColor: selected?.id === a.id ? color : undefined, opacity: a.enabled ? 1 : 0.55 }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1f`, border: `1px solid ${color}55` }}>
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
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="fb-chip">{lvl?.short ?? a.autonomy}</span>
                      <span className="fb-chip">{a.agent_tools.filter((t) => t.enabled).length} tools</span>
                      {ask > 0 && <span className="fb-chip" style={{ color: 'var(--fb-warn)' }}>{ask} ask first</span>}
                      {blocked > 0 && <span className="fb-chip" style={{ color: 'var(--fb-err)' }}>{blocked} blocked</span>}
                      {a.monthly_budget_usd != null && <span className="fb-chip">${(spend[a.id] ?? 0).toFixed(2)} / ${a.monthly_budget_usd.toFixed(0)}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
            {data.agents.length === 0 && !data.loading && <li className="fb-dim text-sm">No agents yet.</li>}
          </ul>

          {selected && (
            <aside className="lg:sticky lg:top-4 lg:self-start">
              <AgentDrawer
                key={selected.id}
                agent={selected}
                state={states[selected.id] ?? 'idle'}
                canManage={canManage}
                spend={spend[selected.id]}
                stats={stats[selected.id]}
                onClose={() => select(null)}
                onChanged={changed}
              />
            </aside>
          )}
        </div>
      </div>
      {hiring && (
        <HireDialog
          orgId={orgId}
          existing={data.agents}
          onClose={() => setHiring(false)}
          onHired={() => {
            setHiring(false);
            changed();
          }}
        />
      )}
    </div>
  );
}
