import { useState } from 'react';
import { toast } from 'sonner';
import { Panel, StatusDot } from '../command/Panel';
import { updateAgent, updateTool } from '../../lib/company/data';
import { AUTONOMY_LEVELS } from '../../lib/company/templates';
import { agentColor, STATE_LABEL, type AgentState } from '../../lib/company/status';
import type { AgentRow, Autonomy, ToolPolicy } from '../../lib/company/types';

const POLICIES: { id: ToolPolicy; label: string; hint: string }[] = [
  { id: 'allow', label: 'Allow', hint: 'Agent may use this tool freely' },
  { id: 'approval', label: 'Ask', hint: 'Every use needs your approval' },
  { id: 'block', label: 'Block', hint: 'Agent can never use this tool' },
];

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
  const color = agentColor(agent.type, agent.slug);
  const [budget, setBudget] = useState(agent.monthly_budget_usd?.toString() ?? '');
  const suggestion = autonomySuggestion(stats, agent.autonomy);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const saveBudget = () => {
    const v = budget.trim() === '' ? null : Number(budget);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return toast.error('Budget must be a positive number');
    void run(() => updateAgent(agent.id, { monthly_budget_usd: v }), 'Budget saved');
  };

  const budgetValue = agent.monthly_budget_usd;
  const pct = budgetValue && spend !== undefined ? Math.min(100, (spend / budgetValue) * 100) : 0;

  return (
    <Panel
      title={agent.name}
      right={
        <button className="fb-link fb-muted cursor-pointer text-xs hover:text-white" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="fb-chip" style={{ color }}>
          <StatusDot tone={state === 'active' ? 'ok' : state === 'waiting' ? 'warn' : 'idle'} live={state === 'active'} />
          {STATE_LABEL[state]}
        </span>
        <label className="fb-chip cursor-pointer">
          <input
            type="checkbox"
            checked={agent.enabled}
            disabled={!canManage}
            onChange={(e) => void run(() => updateAgent(agent.id, { enabled: e.target.checked }), e.target.checked ? 'Agent enabled' : 'Agent disabled')}
          />
          {agent.enabled ? 'Enabled' : 'Disabled'}
        </label>
      </div>
      {agent.description && <p className="fb-muted mb-4 text-sm">{agent.description}</p>}

      <div className="fb-eyebrow mb-2">Autonomy</div>
      <div role="radiogroup" aria-label="Autonomy level" className="grid gap-2">
        {AUTONOMY_LEVELS.map((lvl) => {
          const on = agent.autonomy === lvl.id;
          return (
            <button
              key={lvl.id}
              role="radio"
              aria-checked={on}
              disabled={!canManage}
              onClick={() => !on && void run(() => updateAgent(agent.id, { autonomy: lvl.id }), `${agent.name}: ${lvl.label}`)}
              className="fb-row cursor-pointer text-left disabled:cursor-not-allowed"
              style={on ? { borderColor: color, background: `${color}14` } : undefined}
            >
              <span className="fb-dot" style={on ? { background: color, boxShadow: `0 0 10px ${color}` } : undefined} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{lvl.label}</span>
                <span className="fb-dim block text-xs">{lvl.text}</span>
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
          Your decisions: <b>{Math.round(suggestion.rate * 100)}%</b> approved over {suggestion.decisions} request{suggestion.decisions === 1 ? '' : 's'}.{' '}
          {suggestion.ready
            ? 'This agent has earned more trust — consider "Act, then tell me".'
            : suggestion.decisions < 10
              ? 'A track record builds after 10 decisions.'
              : 'Keep it on approval until the acceptance rate is above 85%.'}
        </p>
      )}

      <div className="fb-eyebrow mb-2 mt-5">Monthly budget (USD)</div>
      <div className="flex gap-2">
        <input
          className="fb-input"
          inputMode="decimal"
          placeholder="No limit"
          value={budget}
          disabled={!canManage}
          aria-label="Monthly budget in USD"
          onChange={(e) => setBudget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveBudget()}
        />
        <button className="fb-btn fb-btn--ghost" style={{ height: 42 }} disabled={!canManage} onClick={saveBudget}>
          Save
        </button>
      </div>
      {budgetValue != null && (
        <div className="mt-2">
          <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct > 90 ? 'var(--fb-err)' : pct > 70 ? 'var(--fb-warn)' : 'var(--fb-accent)' }} />
          </div>
          <div className="fb-dim mt-1 text-[11px]">
            ${(spend ?? 0).toFixed(2)} of ${budgetValue.toFixed(2)} this month · enforced by the agent backend when connected
          </div>
        </div>
      )}

      <div className="fb-eyebrow mb-2 mt-5">Tools & permissions</div>
      <ul className="flex flex-col gap-2">
        {agent.agent_tools.map((t) => (
          <li key={t.id} className="fb-row flex-wrap py-2" style={!t.enabled ? { opacity: 0.55 } : undefined}>
            <input
              type="checkbox"
              checked={t.enabled}
              disabled={!canManage}
              aria-label={`${t.tool_name} enabled`}
              onChange={(e) => void run(() => updateTool(t.id, { enabled: e.target.checked }))}
            />
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{t.tool_name}</span>
            <span role="radiogroup" aria-label={`${t.tool_name} policy`} className="inline-flex overflow-hidden rounded-lg" style={{ border: '1px solid var(--fb-border)' }}>
              {POLICIES.map((p) => (
                <button
                  key={p.id}
                  role="radio"
                  aria-checked={t.policy === p.id}
                  title={p.hint}
                  disabled={!canManage}
                  onClick={() => t.policy !== p.id && void run(() => updateTool(t.id, { policy: p.id }))}
                  className="cursor-pointer px-2.5 py-1 text-[11px] font-semibold disabled:cursor-not-allowed"
                  style={{
                    background: t.policy === p.id ? (p.id === 'block' ? 'rgba(248,113,113,0.2)' : p.id === 'approval' ? 'rgba(251,191,36,0.18)' : 'rgba(52,211,153,0.16)') : 'transparent',
                    color: t.policy === p.id ? (p.id === 'block' ? 'var(--fb-err)' : p.id === 'approval' ? 'var(--fb-warn)' : 'var(--fb-ok)') : 'var(--fb-dim)',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </span>
          </li>
        ))}
        {agent.agent_tools.length === 0 && <li className="fb-dim text-sm">This agent has no tools.</li>}
      </ul>
      {!canManage && <p className="fb-dim mt-3 text-xs">Only managers, admins and owners can change these settings.</p>}
    </Panel>
  );
}
