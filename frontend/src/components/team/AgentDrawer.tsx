import { useState } from 'react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../command/Panel';
import { updateAgent, updateTool } from '../../lib/company/data';
import { AUTONOMY_LEVELS } from '../../lib/company/templates';
import { agentLabel } from '../../lib/company/labels';
import { agentColor, STATE_KEY, type AgentState } from '../../lib/company/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import type { AgentRow, Autonomy, ToolPolicy } from '../../lib/company/types';

const POLICIES: ToolPolicy[] = ['allow', 'approval', 'block'];

/** Suggest more autonomy only when there is real evidence: >= 10 decisions and >= 85% approved. */
export function autonomySuggestion(
  stats: { approved: number; rejected: number } | undefined,
  autonomy: Autonomy,
): { rate: number; decisions: number; ready: boolean } | null {
  if (!stats) return null;
  const decisions = stats.approved + stats.rejected;
  if (decisions === 0) return null;
  const rate = stats.approved / decisions;
  return { rate, decisions, ready: decisions >= 10 && rate >= 0.85 && (autonomy === 'suggest' || autonomy === 'approval') };
}

export function AgentDrawer({
  agent,
  state,
  canManage,
  spend,
  stats,
  onClose,
  onChanged,
}: {
  agent: AgentRow;
  state: AgentState;
  canManage: boolean;
  spend: number | undefined;
  stats: { approved: number; rejected: number } | undefined;
  onClose: () => void;
  onChanged: () => void;
}) {
  const i18n = useI18n();
  const { t, fmt } = i18n;
  const label = agentLabel(agent, i18n);
  const color = agentColor(agent.type, agent.slug);
  const [budget, setBudget] = useState(agent.monthly_budget_usd?.toString() ?? '');
  const [model, setModel] = useState(agent.model ?? 'auto');
  const suggestion = autonomySuggestion(stats, agent.autonomy);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (err) {
      console.error(err);
      toast.error(t('drawer.saveError'));
    }
  };

  const saveBudget = () => {
    const v = budget.trim() === '' ? null : Number(budget);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return toast.error(t('drawer.budgetInvalid'));
    void run(() => updateAgent(agent.id, { monthly_budget_usd: v }), t('drawer.budgetSaved'));
  };

  const saveModel = () => {
    const v = model.trim() || 'auto';
    if (!/^(auto|[a-z0-9_-]{1,32}:\S{1,100})$/i.test(v)) return toast.error(t('drawer.modelInvalid'));
    void run(() => updateAgent(agent.id, { model: v }), t('drawer.modelSaved'));
  };

  const budgetValue = agent.monthly_budget_usd;
  const pct = budgetValue && spend !== undefined ? Math.min(100, (spend / budgetValue) * 100) : 0;

  return (
    <Panel
      title={label.name}
      right={
        <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={onClose}>
          {t('common.close')}
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="fb-chip" style={{ color }}>
          <StatusDot tone={state === 'active' ? 'ok' : state === 'waiting' ? 'warn' : 'idle'} live={state === 'active'} />
          {t(STATE_KEY[state])}
        </span>
        <label className="fb-chip cursor-pointer">
          <input
            type="checkbox"
            checked={agent.enabled}
            disabled={!canManage}
            onChange={(e) => void run(() => updateAgent(agent.id, { enabled: e.target.checked }), t(e.target.checked ? 'drawer.toast.enabled' : 'drawer.toast.disabled'))}
          />
          {agent.enabled ? t('drawer.enabled') : t('drawer.disabled')}
        </label>
      </div>
      {label.description && <p className="fb-muted mb-4 text-sm">{label.description}</p>}

      <div className="fb-eyebrow mb-2">{t('drawer.autonomy')}</div>
      <div role="radiogroup" aria-label={t('drawer.autonomyAria')} className="grid gap-2">
        {AUTONOMY_LEVELS.map((lvl) => {
          const on = agent.autonomy === lvl.id;
          return (
            <button
              key={lvl.id}
              role="radio"
              aria-checked={on}
              disabled={!canManage}
              onClick={() => !on && void run(() => updateAgent(agent.id, { autonomy: lvl.id }), t('drawer.autonomyToast', { agent: label.name, level: t(`autonomy.${lvl.id}.label` as TKey) }))}
              className="fb-row cursor-pointer text-start disabled:cursor-not-allowed"
              style={on ? { borderColor: color, background: `${color}14` } : undefined}
            >
              <span className="fb-dot" style={on ? { background: color, boxShadow: `0 0 10px ${color}` } : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{t(`autonomy.${lvl.id}.label` as TKey)}</span>
                <span className="fb-dim block text-xs">{t(`autonomy.${lvl.id}.text` as TKey)}</span>
              </span>
            </button>
          );
        })}
      </div>

      {suggestion && (
        <p
          className="mt-3 rounded-xl p-3 text-xs"
          style={{ border: '1px solid var(--fb-border)', background: suggestion.ready ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.02)' }}
        >
          {t('drawer.trust', { rate: Math.round(suggestion.rate * 100), count: suggestion.decisions })}{' '}
          {suggestion.ready ? t('drawer.trust.ready') : suggestion.decisions < 10 ? t('drawer.trust.few') : t('drawer.trust.keep')}
        </p>
      )}

      <div className="fb-eyebrow mb-2 mt-5">{t('drawer.model')}</div>
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label={t('drawer.tier')}>
        {(['omniroute:firbo-economy', 'omniroute:firbo-quality', 'auto'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="fb-chip cursor-pointer"
            disabled={!canManage}
            aria-pressed={model === v}
            style={model === v ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}
            onClick={() => (setModel(v), void run(() => updateAgent(agent.id, { model: v }), t('drawer.modelSaved')))}
          >
            {t(v === 'auto' ? 'drawer.tier.auto' : v.endsWith('economy') ? 'drawer.tier.economy' : 'drawer.tier.quality')}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="fb-input font-mono text-xs"
          list={`models-${agent.id}`}
          value={model}
          disabled={!canManage}
          aria-label={t('drawer.modelAria')}
          dir="ltr"
          onChange={(e) => setModel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveModel()}
        />
        <datalist id={`models-${agent.id}`}>
          {['auto', 'omniroute:firbo-economy', 'omniroute:firbo-quality', 'openai:', 'anthropic:claude-sonnet-5-5', 'anthropic:claude-opus-5-5', 'anthropic:claude-haiku-4-5-20251001', 'kimi:', 'glm:', 'mimo:'].map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <button className="fb-btn fb-btn--ghost" style={{ height: 42 }} disabled={!canManage} onClick={saveModel}>
          {t('common.save')}
        </button>
      </div>
      <p className="fb-dim mt-1 text-[11px]">{t('drawer.modelHint')}</p>

      <div className="fb-eyebrow mb-2 mt-5">{t('drawer.budget')}</div>
      <div className="flex gap-2">
        <input
          className="fb-input"
          inputMode="decimal"
          placeholder={t('drawer.budgetPlaceholder')}
          value={budget}
          disabled={!canManage}
          aria-label={t('drawer.budgetAria')}
          onChange={(e) => setBudget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveBudget()}
        />
        <button className="fb-btn fb-btn--ghost" style={{ height: 42 }} disabled={!canManage} onClick={saveBudget}>
          {t('common.save')}
        </button>
      </div>
      {budgetValue != null && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--fb-err)' : pct > 70 ? 'var(--fb-warn)' : 'var(--fb-accent)' }} />
          </div>
          <div className="fb-dim mt-1 text-[11px]">
            {t('drawer.budgetProgress', { spent: fmt.currency(spend ?? 0), budget: fmt.currency(budgetValue) })}
          </div>
        </div>
      )}

      <div className="fb-eyebrow mb-2 mt-5">{t('drawer.tools')}</div>
      <ul className="flex flex-col gap-2">
        {agent.agent_tools.map((tool) => (
          <li key={tool.id} className="fb-row flex-wrap py-2" style={!tool.enabled ? { opacity: 0.55 } : undefined}>
            <input
              type="checkbox"
              checked={tool.enabled}
              disabled={!canManage}
              aria-label={t('drawer.toolEnabledAria', { tool: tool.tool_name })}
              onChange={(e) => void run(() => updateTool(tool.id, { enabled: e.target.checked }))}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{tool.tool_name}</span>
            <span role="radiogroup" aria-label={t('drawer.toolPolicyAria', { tool: tool.tool_name })} className="inline-flex overflow-hidden rounded-lg" style={{ border: '1px solid var(--fb-border)' }}>
              {POLICIES.map((p) => (
                <button
                  key={p}
                  role="radio"
                  aria-checked={tool.policy === p}
                  title={t(`policy.${p}.hint` as TKey)}
                  disabled={!canManage}
                  onClick={() => tool.policy !== p && void run(() => updateTool(tool.id, { policy: p }))}
                  className="cursor-pointer px-2.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed"
                  style={{
                    background: tool.policy === p ? (p === 'block' ? 'rgba(248,113,113,0.2)' : p === 'approval' ? 'rgba(251,191,36,0.18)' : 'rgba(52,211,153,0.16)') : 'transparent',
                    color: tool.policy === p ? (p === 'block' ? 'var(--fb-err)' : p === 'approval' ? 'var(--fb-warn)' : 'var(--fb-ok)') : 'var(--fb-dim)',
                  }}
                >
                  {t(`policy.${p}` as TKey)}
                </button>
              ))}
            </span>
          </li>
        ))}
        {agent.agent_tools.length === 0 && <li className="fb-dim text-sm">{t('drawer.noTools')}</li>}
      </ul>
      {!canManage && <p className="fb-dim mt-3 text-xs">{t('drawer.readonly')}</p>}
    </Panel>
  );
}
