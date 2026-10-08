import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Panel, StatusDot } from '../command/Panel';
import { deleteAgent, updateAgent, updateTool } from '../../lib/company/data';
import { Modal } from './Modal';
import { useCompanyAuth } from '../../lib/company/AuthProvider';
import { OWN_KEY_PROVIDERS } from '../../lib/company/ownKeys';
import { planHas, useOwnKeys, usePlanUsageState } from '../../lib/company/usePlan';
import { keyStatusCopy } from '../../lib/company/keyStatusCopy';
import { AUTONOMY_LEVELS } from '../../lib/company/templates';
import { agentLabel } from '../../lib/company/labels';
import { agentColor, STATE_KEY, type AgentState } from '../../lib/company/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/locales/en';
import type { AgentRow, Autonomy, ToolPolicy } from '../../lib/company/types';
import { agentBehaviorLabels } from '../../lib/company/agent-behavior-labels';

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
  const behavior = agentBehaviorLabels[i18n.lang];
  const label = agentLabel(agent, i18n);
  const color = agentColor(agent.type, agent.slug);
  const [budget, setBudget] = useState(agent.monthly_budget_usd?.toString() ?? '');
  const [model, setModel] = useState(agent.model ?? 'auto');
  const [instructions, setInstructions] = useState(agent.owner_instructions ?? '');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const suggestion = autonomySuggestion(stats, agent.autonomy);
  const { current } = useCompanyAuth();
  const orgId = current?.organization.id;
  const planState = usePlanUsageState(orgId);
  const plan = planState.plan;
  const [ownKeys, reloadKeys, keyState] = useOwnKeys(orgId);
  const copy = keyStatusCopy(i18n.lang);
  const checked = planState.status === 'ready' && keyState.status === 'ready';
  const canChangeModel = canManage && checked && !!orgId;
  const scopeKey = `${orgId ?? ''}:${agent.id}`;
  const [draftScope, setDraftScope] = useState(scopeKey);
  const shownModel = draftScope === scopeKey ? model : agent.model ?? 'auto';
  const shownBudget = draftScope === scopeKey ? budget : agent.monthly_budget_usd?.toString() ?? '';
  const shownInstructions = draftScope === scopeKey ? instructions : agent.owner_instructions ?? '';
  const scope = useRef({ key: scopeKey, orgId, generation: 0 });
  if (scope.current.key !== scopeKey) scope.current = { key: scopeKey, orgId, generation: scope.current.generation + 1 };
  const generation = scope.current.generation;
  const priorOrg = useRef(orgId);
  useEffect(() => {
    if (priorOrg.current !== orgId) onClose();
    priorOrg.current = orgId;
    setBudget(agent.monthly_budget_usd?.toString() ?? ''); setModel(agent.model ?? 'auto'); setInstructions(agent.owner_instructions ?? ''); setConfirmRemove(false); setRemoving(false); setDraftScope(scopeKey);
  }, [orgId, agent.id, agent.model, agent.monthly_budget_usd, agent.owner_instructions]); // eslint-disable-line react-hooks/exhaustive-deps
  // Free companies always run on Firbo's free models (server rule), so the model choice is locked there instead of pretending.
  const freePlan = plan?.plan.id === 'free';
  const ownAllowed = planHas(plan, 'byo_keys');

  const run = async (fn: () => Promise<void>, ok?: string) => {
    if (!canManage || !orgId || scope.current.generation !== generation) return;
    try {
      await fn();
      if (scope.current.generation !== generation) return;
      if (ok) toast.success(ok);
      onChanged();
    } catch (err) {
      if (scope.current.generation !== generation) return;
      console.error(err);
      // Show the short reason (e.g. not_removed) so a failure is never silent or vague.
      const code = err instanceof Error && /^[a-z0-9_ .:-]{1,80}$/i.test(err.message) ? ` [${err.message}]` : '';
      toast.error(t('drawer.saveError') + code);
    }
  };

  const saveBudget = () => {
    if (draftScope !== scopeKey) return;
    const v = budget.trim() === '' ? null : Number(budget);
    if (v !== null && (!Number.isFinite(v) || v < 0)) return toast.error(t('drawer.budgetInvalid'));
    void run(() => updateAgent(agent.id, { monthly_budget_usd: v }), t('drawer.budgetSaved'));
  };

  const saveInstructions = () => {
    if (!canManage || draftScope !== scopeKey) return;
    const value = instructions.trim().slice(0, 4000);
    setInstructions(value);
    void run(() => updateAgent(agent.id, { owner_instructions: value }), behavior.saved);
  };

  const saveModel = () => {
    if (!canChangeModel || freePlan || draftScope !== scopeKey) return;
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

      <div className="fb-eyebrow mb-2">{behavior.title}</div>
      <p className="fb-dim mb-2 text-xs">{behavior.help}</p>
      <textarea
        className="fb-input min-h-[110px]"
        maxLength={4000}
        value={shownInstructions}
        disabled={!canManage}
        placeholder={behavior.placeholder}
        aria-label={behavior.title}
        onChange={(e) => setInstructions(e.target.value)}
      />
      <div className="mt-2 flex justify-end">
        <button className="fb-btn fb-btn--ghost" disabled={!canManage} onClick={saveInstructions}>
          {behavior.save}
        </button>
      </div>

      <div className="fb-eyebrow mb-2 mt-5">{t('drawer.autonomy')}</div>
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
      {planState.loading && <p role="status" className="fb-dim mb-2 text-xs">{copy.loadingPlan}</p>}
      {keyState.loading && <p role="status" className="fb-dim mb-2 text-xs">{copy.loadingKeys}</p>}
      {planState.status === 'error' && <div role="alert" className="mb-2 text-xs">{copy.planError} <button className="fb-link" onClick={planState.retry}>{copy.retry}</button></div>}
      {keyState.status === 'error' && <div role="alert" className="mb-2 text-xs">{copy.keysError} <button className="fb-link" onClick={reloadKeys}>{copy.retry}</button></div>}
      {!checked && <p className="fb-dim mb-2 text-xs">{copy.waiting}</p>}
      {checked && freePlan ? (
        <p className="rounded-xl p-3 text-xs" style={{ border: '1px solid var(--fb-border)', background: 'rgba(34,211,238,0.06)' }}>
          {t('drawer.freeModel')}{' '}
          <a className="fb-link font-semibold" href="/billing">
            {t('bill.seePlans')}
          </a>
        </p>
      ) : (
      <>
      {checked && ownAllowed && ownKeys.length > 0 && (
        <div className="mb-2">
          <select
            className="fb-input text-xs"
            disabled={!canChangeModel}
            aria-label={t('drawer.ownKeyPick')}
            value={ownKeys.some((k) => k.models.some((m) => `${k.provider}:${m}` === shownModel)) ? shownModel : ''}
            onChange={(e) => {
              if (!canChangeModel || freePlan) return;
              const v = e.target.value;
              if (!v) return;
              setModel(v);
              void run(() => updateAgent(agent.id, { model: v }), t('drawer.modelSaved'));
            }}
          >
            <option value="">{t('drawer.ownKeyPick')}</option>
            {ownKeys.map((k) => (
              <optgroup key={k.provider} label={`${OWN_KEY_PROVIDERS.find((p) => p.id === k.provider)?.name ?? k.provider} · ${t('drawer.ownKeyTag')}`}>
                {k.models.map((m) => (
                  <option key={m} value={`${k.provider}:${m}`}>
                    {m}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      )}
      {checked && ownKeys.length === 0 && (
        <p className="fb-dim mb-2 text-[11px]">
          {t(ownAllowed ? 'drawer.ownKeyHint' : 'drawer.ownKeyPlan')}{' '}
          <a className="fb-link" href={ownAllowed ? '/settings' : '/billing'}>
            {t(ownAllowed ? 'drawer.ownKeyGo' : 'bill.seePlans')}
          </a>
        </p>
      )}
      <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label={t('drawer.tier')}>
        {(['omniroute:firbo-economy', 'omniroute:firbo-quality', 'auto'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className="fb-chip cursor-pointer"
            disabled={!canChangeModel}
            aria-pressed={shownModel === v}
            style={shownModel === v ? { color: 'var(--fb-accent)', borderColor: 'var(--fb-border-strong)' } : undefined}
            onClick={() => { if (!canChangeModel || freePlan) return; setModel(v); void run(() => updateAgent(agent.id, { model: v }), t('drawer.modelSaved')); }}
          >
            {t(v === 'auto' ? 'drawer.tier.auto' : v.endsWith('economy') ? 'drawer.tier.economy' : 'drawer.tier.quality')}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="fb-input font-mono text-xs"
          list={`models-${agent.id}`}
          value={shownModel}
          disabled={!canChangeModel}
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
        <button className="fb-btn fb-btn--ghost shrink-0 whitespace-nowrap" style={{ height: 42 }} disabled={!canChangeModel} onClick={saveModel}>
          {t('common.save')}
        </button>
      </div>
      <p className="fb-dim mt-1 text-[11px]">{t('drawer.modelHint')}</p>
      </>
      )}

      <div className="fb-eyebrow mb-2 mt-5">{t('drawer.budget')}</div>
      <div className="flex gap-2">
        <input
          className="fb-input"
          inputMode="decimal"
          placeholder={t('drawer.budgetPlaceholder')}
          value={shownBudget}
          disabled={!canManage}
          aria-label={t('drawer.budgetAria')}
          onChange={(e) => setBudget(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && saveBudget()}
        />
        <button className="fb-btn fb-btn--ghost shrink-0 whitespace-nowrap" style={{ height: 42 }} disabled={!canManage} onClick={saveBudget}>
          {t('common.save')}
        </button>
      </div>
      <p className="fb-dim mt-1 text-[11px]">{t(freePlan ? 'drawer.budgetFree' : 'drawer.budgetWhat')}</p>
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
      {canManage && agent.type !== 'ceo' && (
        <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--fb-border)' }}>
          <button className="fb-btn fb-btn--ghost w-full justify-center" style={{ color: 'var(--fb-warn)' }} onClick={() => setConfirmRemove(true)}>
            <Trash2 size={14} /> {t('drawer.remove')}
          </button>
        </div>
      )}
      {confirmRemove && (
        // A dialog on top of everything: an inline question at the bottom of a long panel was easy to miss.
        <Modal title={t('drawer.remove')} onClose={() => !removing && setConfirmRemove(false)}>
          <p className="text-sm" style={{ color: 'var(--fb-warn)' }}>{t('drawer.removeAsk', { name: label.name })}</p>
          <div className="mt-4 flex gap-2">
            <button className="fb-btn fb-btn--ghost flex-1" disabled={removing} onClick={() => setConfirmRemove(false)}>{t('drawer.removeNo')}</button>
            <button
              className="fb-btn flex-1"
              style={{ color: 'var(--fb-warn)' }}
              disabled={removing}
              onClick={() => {
                setRemoving(true);
                void run(async () => {
                  await deleteAgent(agent.id);
                  if (scope.current.generation !== generation) return;
                  setConfirmRemove(false);
                  onClose();
                }, t('drawer.removed')).finally(() => { if (scope.current.generation === generation) setRemoving(false); });
              }}
            >
              <Trash2 size={14} /> {removing ? '…' : t('drawer.removeYes')}
            </button>
          </div>
        </Modal>
      )}
      {!canManage && <p className="fb-dim mt-3 text-xs">{t('drawer.readonly')}</p>}
    </Panel>
  );
}
