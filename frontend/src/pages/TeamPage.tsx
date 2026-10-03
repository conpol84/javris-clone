import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Plus } from 'lucide-react';
import { StatusDot, Wave } from '../components/command/Panel';
import { AgentDrawer } from '../components/team/AgentDrawer';
import { CharacterEditor } from '../components/team/CharacterEditor';
import type { Persona } from '../lib/company/persona';
import { HireDialog } from '../components/team/HireDialog';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { loadDecisionStats, loadMonthlySpend } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { agentColor, deriveAgentStates, STATE_KEY } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import type { TKey } from '../i18n/locales/en';
import { MANAGER_ROLES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const TeamStage = lazy(() => import('../components/scenes/TeamStage'));

export function TeamPage() {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const { current } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const role = current?.role ?? 'viewer';
  const canManage = MANAGER_ROLES.includes(role);
  const data = useOrgData(orgId, canManage);
  const [hiring, setHiring] = useState(false);
  const [draft, setDraft] = useState<Persona | null>(null);
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
    setDraft(null);
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
            <h1 className="mt-1 text-2xl font-semibold">{t('team.title')}</h1>
            <p className="fb-muted mt-1 text-sm">{t('team.subtitle', { count: data.agents.length })}</p>
          </div>
          {canManage && (
            <button className="fb-btn fb-btn--primary" onClick={() => setHiring(true)}>
              <Plus size={16} /> {t('team.hire')}
            </button>
          )}
        </header>

        {data.error && (
          <p role="alert" className="fb-chip mb-3" style={{ color: 'var(--fb-err)' }}>
            {data.error}
          </p>
        )}

        <div className="fb-glass relative mb-4 h-[46vh] min-h-[320px] overflow-hidden">
          {data.agents.length === 0 ? (
            <div className="fb-muted grid h-full place-items-center p-6 text-center text-sm">{t('team.noAgents')}</div>
          ) : (
            <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
              <TeamStage agents={data.agents} states={states} selectedId={selected?.id ?? null} onSelect={(id) => select(id)} agentName={(a) => agentLabel(a, i18n).name} draft={draft} noWebgl={t('studio.noWebgl')} />
            </Suspense>
          )}
          <p className="fb-dim pointer-events-none absolute bottom-2 start-3 text-[11px]">{t('team.stage.hint')}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
          <ul className="grid content-start gap-3 sm:grid-cols-2">
            {data.agents.map((a) => {
              const st = states[a.id] ?? 'idle';
              const color = agentColor(a.type, a.slug);
              const ask = a.agent_tools.filter((x) => x.policy === 'approval').length;
              const blocked = a.agent_tools.filter((x) => x.policy === 'block').length;
              return (
                <li key={a.id}>
                  <button
                    onClick={() => select(a.id === selected?.id ? null : a.id)}
                    className="fb-glass fb-glass--hover w-full cursor-pointer p-4 text-start"
                    style={{ borderColor: selected?.id === a.id ? color : undefined, opacity: a.enabled ? 1 : 0.55 }}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl" style={{ background: `${color}1f`, border: `1px solid ${color}55` }}>
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
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="fb-chip">{t(`autonomy.${a.autonomy}.short` as TKey)}</span>
                      <span className="fb-chip">{t('chip.tools', { count: a.agent_tools.filter((x) => x.enabled).length })}</span>
                      {ask > 0 && <span className="fb-chip" style={{ color: 'var(--fb-warn)' }}>{t('chip.ask', { count: ask })}</span>}
                      {blocked > 0 && <span className="fb-chip" style={{ color: 'var(--fb-err)' }}>{t('chip.blocked', { count: blocked })}</span>}
                      {a.monthly_budget_usd != null && <span className="fb-chip">{fmt.currency(spend[a.id] ?? 0)} / {fmt.currency(a.monthly_budget_usd)}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
            {data.agents.length === 0 && !data.loading && <li className="fb-dim text-sm">{t('team.noAgents')}</li>}
          </ul>

          {selected && (
            <aside className="fb-col gap-4 lg:sticky lg:top-4 lg:self-start">
              <CharacterEditor key={`c-${selected.id}-${selected.name}`} agent={selected} canManage={canManage} onDraft={setDraft} onSaved={() => (setDraft(null), changed())} />
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
