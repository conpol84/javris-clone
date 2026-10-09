import { lazy, Suspense, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { useCompanyAuth } from '../lib/company/AuthProvider';
import { updateTool } from '../lib/company/data';
import { agentLabel } from '../lib/company/labels';
import { powerLabel, powerMeta } from '../lib/company/powers';
import { agentColor, deriveAgentStates } from '../lib/company/status';
import { useI18n } from '../i18n/I18nProvider';
import { MANAGER_ROLES } from '../lib/company/types';
import { useOrgData } from '../lib/company/useOrgData';
import '../styles/firbo.css';

const StudioScene = lazy(() => import('../components/scenes/StudioScene'));

/** Pick an AI employee in a space hangar and equip its powers (real tool permissions in your workspace). */
export function StudioPage() {
  const i18n = useI18n();
  const { t } = i18n;
  const { current } = useCompanyAuth();
  const [params, setParams] = useSearchParams();
  const orgId = current?.organization.id ?? '';
  const canManage = MANAGER_ROLES.includes(current?.role ?? 'viewer');
  const data = useOrgData(orgId, canManage, 15_000);
  const states = useMemo(() => deriveAgentStates(data.agents, data.tasks, data.approvals), [data.agents, data.tasks, data.approvals]);
  const selected = data.agents.find((a) => a.id === params.get('agent')) ?? data.agents[0] ?? null;
  const nameOf = (a: { slug: string; name: string }) => agentLabel(a, i18n).name;

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('agent', id);
    setParams(next, { replace: true });
  };

  const tools = selected?.agent_tools ?? [];
  const powers = tools.map((tool) => {
    const meta = powerMeta(tool.tool_name);
    return { id: tool.id, label: powerLabel(tool.tool_name), color: meta.color, on: tool.enabled && tool.policy !== 'block', live: meta.live };
  });

  const toggle = async (toolId: string) => {
    const tool = tools.find((x) => x.id === toolId);
    if (!tool || !canManage) return;
    const on = tool.enabled && tool.policy !== 'block';
    try {
      await updateTool(toolId, on ? { enabled: false } : { enabled: true, ...(tool.policy === 'block' ? { policy: 'approval' as const } : {}) });
      await data.reload();
    } catch (err) {
      console.error(err);
      toast.error(t('drawer.saveError'));
    }
  };

  const equipped = powers.filter((p) => p.on).length;

  return (
    <div className="fb-root h-full overflow-y-auto">
      <div className="mx-auto grid max-w-[1400px] gap-4 px-4 pb-8 pt-14 md:px-6 md:pt-6 lg:grid-cols-[1fr_380px]">
        <header className="lg:col-span-2">
          <div className="fb-eyebrow">{t('studio.eyebrow')}</div>
          <h1 className="fb-grad-text mt-1 text-2xl font-semibold">{t('studio.title')}</h1>
          <p className="fb-muted mt-1 max-w-3xl text-sm">{t('studio.intro')}</p>
        </header>

        <div className="fb-glass relative h-[52vh] min-h-[340px] overflow-hidden lg:h-[68vh]">
          {data.agents.length === 0 ? (
            <div className="fb-muted grid h-full place-items-center p-6 text-center text-sm">{t('studio.noAgents')}</div>
          ) : (
            <Suspense fallback={<div className="fb-muted grid h-full place-items-center text-sm">{t('office.loading')}</div>}>
              <StudioScene
                agents={data.agents}
                states={states}
                selectedId={selected?.id ?? null}
                onSelect={select}
                powers={powers}
                onTogglePower={(id) => void toggle(id)}
                agentName={(a) => nameOf(a).replace(' Agent', '')}
                canManage={canManage}
                noWebgl={t('studio.noWebgl')}
              />
            </Suspense>
          )}
          <p className="fb-dim pointer-events-none absolute bottom-2 start-3 text-[11px]">{t('studio.hint')}</p>
        </div>

        <aside className="fb-col gap-4">
          <section className="fb-glass fb-col gap-2 p-4">
            <h2 className="fb-eyebrow">{t('studio.pick')}</h2>
            <div className="flex flex-wrap gap-2">
              {data.agents.map((a) => (
                <button key={a.id} className="fb-chip cursor-pointer" aria-pressed={selected?.id === a.id} onClick={() => select(a.id)} style={selected?.id === a.id ? { color: agentColor(a.type, a.slug), borderColor: agentColor(a.type, a.slug) } : undefined}>
                  {nameOf(a).replace(' Agent', '')}
                </button>
              ))}
            </div>
          </section>

          {selected && (
            <section className="fb-glass fb-col gap-2 p-4">
              <div className="flex items-baseline justify-between">
                <h2 className="fb-eyebrow">{t('studio.powers')}</h2>
                <span className="fb-dim text-xs">{t('studio.equipped', { on: equipped, total: powers.length })}</span>
              </div>
              <ul className="fb-col gap-2">
                {tools.map((tool) => {
                  const meta = powerMeta(tool.tool_name);
                  const on = tool.enabled && tool.policy !== 'block';
                  return (
                    <li key={tool.id} className="fb-row flex-wrap gap-2 py-2">
                      <span aria-hidden className="inline-block h-3 w-3 rounded-full" style={{ background: on ? meta.color : '#334155', boxShadow: on ? `0 0 10px ${meta.color}` : 'none' }} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold">{powerLabel(tool.tool_name)}</span>
                          <span className="fb-chip" style={{ fontSize: 10, color: meta.live ? 'var(--fb-accent)' : 'var(--fb-dim)' }} title={t(meta.live ? 'studio.live.hint' : 'studio.perm.hint')}>
                            {t(meta.live ? 'studio.live' : 'studio.perm')}
                          </span>
                        </div>
                        <p className="fb-dim text-xs">{t(meta.desc)}</p>
                      </div>
                      <button className="fb-btn fb-btn--ghost" style={{ height: 32 }} disabled={!canManage} aria-pressed={on} onClick={() => void toggle(tool.id)}>
                        {t(on ? 'studio.remove' : 'studio.equip')}
                      </button>
                    </li>
                  );
                })}
                {tools.length === 0 && <li className="fb-dim text-sm">{t('drawer.noTools')}</li>}
              </ul>
              {!canManage && <p className="fb-dim text-xs">{t('studio.readonly')}</p>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
