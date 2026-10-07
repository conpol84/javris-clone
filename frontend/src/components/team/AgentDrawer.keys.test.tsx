import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n/locales/en';
import { KEY_STATUS_COPY } from '../../lib/company/keyStatusCopy';
import type { AgentRow } from '../../lib/company/types';
const fixture = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], index: 0, refIndex: 0, effects: [] as (() => void)[], orgId: 'A', planStatus: 'ready', keysStatus: 'ready', paid: true, retryPlan: vi.fn(), retryKeys: vi.fn() }));
const data = vi.hoisted(() => ({ deleteAgent: vi.fn(), updateAgent: vi.fn(), updateTool: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState(initial: unknown) { const index = fixture.index++; if (!(index in fixture.values)) fixture.values[index] = initial; return [fixture.values[index], (next: unknown) => { fixture.values[index] = next; }]; },
  useRef(initial: unknown) { const index = fixture.refIndex++; return fixture.refs[index] ??= { current: initial }; },
  useEffect(effect: () => void) { fixture.effects.push(effect); },
}));
vi.mock('../../lib/company/usePlan', () => ({
  usePlanUsageState: () => ({ plan: fixture.planStatus === 'ready' ? { plan: { id: fixture.paid ? 'pro' : 'free', features: fixture.paid ? ['byo_keys'] : [] } } : null, status: fixture.planStatus, loading: fixture.planStatus === 'loading', error: fixture.planStatus === 'error' ? new Error('synthetic') : null, retry: fixture.retryPlan }),
  useOwnKeys: () => [[], fixture.retryKeys, { status: fixture.keysStatus, loading: fixture.keysStatus === 'loading', error: fixture.keysStatus === 'error' ? new Error('synthetic') : null }],
  planHas: (plan: { plan: { features: string[] } } | null, feature: string) => !!plan?.plan.features.includes(feature),
}));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.orgId } } }) }));
vi.mock('../../lib/company/data', () => data);
vi.mock('sonner', () => ({ toast: notices }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', fmt: { currency: String }, t: (key: keyof typeof en) => en[key] }) }));
import { AgentDrawer } from './AgentDrawer';
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; 'aria-label'?: string; onClick?: () => void }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement(node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(''); if (isValidElement(node)) return text((node as Element).props.children); return typeof node === 'string' ? node : '';
}
const baseAgent: AgentRow = { id: 'agent-A', slug: 'custom-agent-a', name: 'Synthetic A', type: 'custom', description: null, model: 'auto', enabled: true, autonomous: false, autonomy: 'approval', monthly_budget_usd: null, agent_tools: [] };
const onClose = vi.fn(); const onChanged = vi.fn();
function page(agent = baseAgent) { fixture.index = 0; fixture.refIndex = 0; fixture.effects = []; return AgentDrawer({ agent, state: 'idle', canManage: true, spend: 0, stats: undefined, onClose, onChanged }); }
const modelInput = (tree: ReactNode) => elements(tree).find(e => e.type === 'input' && e.props['aria-label'] === en['drawer.modelAria'])!;
const economy = (tree: ReactNode) => elements(tree).find(e => e.type === 'button' && text(e).trim() === en['drawer.tier.economy'])!;

describe('agent provider status and model changes', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.values = []; fixture.refs = []; fixture.effects = []; fixture.orgId = 'A'; fixture.planStatus = 'ready'; fixture.keysStatus = 'ready'; fixture.paid = true; });
  it('does not show connect or upgrade hints before plan and keys are checked', () => {
    fixture.planStatus = 'loading'; fixture.keysStatus = 'loading'; const tree = page();
    expect(text(tree)).toContain(KEY_STATUS_COPY.en.loadingPlan); expect(text(tree)).toContain(KEY_STATUS_COPY.en.loadingKeys);
    expect(text(tree)).not.toContain(en['drawer.ownKeyHint']); expect(text(tree)).not.toContain(en['drawer.ownKeyPlan']);
    expect(modelInput(tree).props.disabled).toBe(true); expect(economy(tree).props.disabled).toBe(true);
    economy(tree).props.onClick?.(); expect(data.updateAgent).not.toHaveBeenCalled();
  });
  it('shows an explicit failed status and retry without a false upgrade hint', () => {
    fixture.planStatus = 'error'; const tree = page();
    expect(text(tree)).toContain(KEY_STATUS_COPY.en.planError); expect(text(tree)).not.toContain(en['drawer.ownKeyPlan']);
    elements(tree).find(e => e.type === 'button' && text(e).trim() === KEY_STATUS_COPY.en.retry)!.props.onClick?.();
    expect(fixture.retryPlan).toHaveBeenCalledOnce();
  });
  it('shows the genuine own-key hint only after a successful empty lookup on a paid plan', () => {
    expect(text(page())).toContain(en['drawer.ownKeyHint']);
    fixture.keysStatus = 'error'; expect(text(page())).not.toContain(en['drawer.ownKeyHint']);
  });
  it('permits a model change only after successful current-company checks', async () => {
    data.updateAgent.mockResolvedValue(undefined); economy(page()).props.onClick?.();
    expect(data.updateAgent).toHaveBeenCalledWith('agent-A', { model: 'omniroute:firbo-economy' });
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledOnce());
  });
  it('ignores late A write responses and closes the drawer when the company changes', async () => {
    let finish!: () => void; data.updateAgent.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    const old = page(); economy(old).props.onClick?.();
    fixture.orgId = 'B'; const B = page({ ...baseAgent, id: 'agent-B', name: 'Synthetic B', model: 'openai:synthetic-b' });
    expect(modelInput(B).props.value).toBe('openai:synthetic-b');
    fixture.effects.forEach(effect => effect()); expect(onClose).toHaveBeenCalledOnce();
    finish(); await Promise.resolve(); await Promise.resolve();
    expect(notices.success).not.toHaveBeenCalled(); expect(onChanged).not.toHaveBeenCalled();
    // An obsolete A event cannot initiate another write after the switch.
    economy(old).props.onClick?.(); expect(data.updateAgent).toHaveBeenCalledTimes(1);
  });
});
