import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { en } from '../../i18n/locales/en';
import { KEY_STATUS_COPY } from '../../lib/company/keyStatusCopy';
import type { OwnKeyRow } from '../../lib/company/ownKeys';

const fixture = vi.hoisted(() => ({ values: [] as any[], refs: [] as any[], index: 0, refIndex: 0, effects: [] as (() => void)[], planStatus: 'ready', keysStatus: 'ready', paid: true, rows: [] as OwnKeyRow[], retryPlan: vi.fn(), retryKeys: vi.fn() }));
const writes = vi.hoisted(() => ({ saveOwnKey: vi.fn(), removeOwnKey: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState(initial: unknown) { const index = fixture.index++; if (!(index in fixture.values)) fixture.values[index] = initial; return [fixture.values[index], (next: unknown) => { fixture.values[index] = next; }]; },
  useRef(initial: unknown) { const index = fixture.refIndex++; return fixture.refs[index] ??= { current: initial }; },
  useEffect(effect: () => void) { fixture.effects.push(effect); },
}));
vi.mock('../../lib/company/usePlan', () => ({
  usePlanUsageState: () => ({ plan: fixture.planStatus === 'ready' ? { plan: { features: fixture.paid ? ['byo_keys'] : [] } } : null, status: fixture.planStatus, loading: fixture.planStatus === 'loading', error: fixture.planStatus === 'error' ? new Error('synthetic') : null, retry: fixture.retryPlan }),
  useOwnKeys: () => [fixture.keysStatus === 'ready' ? fixture.rows : [], fixture.retryKeys, { status: fixture.keysStatus, loading: fixture.keysStatus === 'loading', error: fixture.keysStatus === 'error' ? new Error('synthetic') : null }],
  planHas: (plan: { plan: { features: string[] } } | null, feature: string) => !!plan?.plan.features.includes(feature),
}));
vi.mock('../../lib/company/ownKeys', async original => ({ ...await original<typeof import('../../lib/company/ownKeys')>(), ...writes }));
vi.mock('sonner', () => ({ toast: notices }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: keyof typeof en) => en[key] }) }));
import { OwnKeysPanel } from './OwnKeysPanel';

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; value?: string; onClick?: () => void }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement(node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(''); if (isValidElement(node)) return text((node as Element).props.children); return typeof node === 'string' ? node : '';
}
function page(orgId = 'A', canManage = true) {
  fixture.index = 0; fixture.refIndex = 0; fixture.effects = []; return OwnKeysPanel({ orgId, canManage });
}
const findButton = (tree: ReactNode, name: string) => elements(tree).find(e => e.type === 'button' && text(e).trim() === name)!;

describe('provider key status and company isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.values = []; fixture.refs = []; fixture.effects = []; fixture.planStatus = 'ready'; fixture.keysStatus = 'ready'; fixture.paid = true; fixture.rows = [];
  });
  it('never renders not-connected or an upgrade lock while key status is loading', () => {
    fixture.keysStatus = 'loading'; fixture.paid = false;
    const tree = page(); expect(text(tree)).toContain(KEY_STATUS_COPY.en.loadingKeys);
    expect(text(tree)).not.toContain(en['keys.notConnected']); expect(text(tree)).not.toContain(en['keys.locked']);
    expect(elements(tree).some(e => e.type === 'button' && text(e).trim() === en['keys.connect'])).toBe(false);
  });
  it('shows a failed lookup with a working retry rather than pretending providers are disconnected', () => {
    fixture.keysStatus = 'error'; const tree = page();
    expect(text(tree)).toContain(KEY_STATUS_COPY.en.keysError); expect(text(tree)).not.toContain(en['keys.notConnected']);
    findButton(tree, KEY_STATUS_COPY.en.retry).props.onClick?.(); expect(fixture.retryKeys).toHaveBeenCalledOnce();
  });
  it('does not suggest an upgrade while the plan cannot be read', () => {
    fixture.planStatus = 'error'; fixture.paid = false; const tree = page();
    expect(text(tree)).toContain(KEY_STATUS_COPY.en.planError); expect(text(tree)).not.toContain(en['keys.locked']); expect(text(tree)).not.toContain(en['keys.notConnected']);
    findButton(tree, KEY_STATUS_COPY.en.retry).props.onClick?.(); expect(fixture.retryPlan).toHaveBeenCalledOnce();
  });
  it('reports not connected only after a successful empty lookup, and locks only a verified plan', () => {
    expect(text(page())).toContain(en['keys.notConnected']);
    fixture.paid = false; expect(text(page())).toContain(en['keys.locked']);
  });
  it('rejects a forced save handler when connection status is unavailable', () => {
    fixture.values = ['openai', 'synthetic-key-at-least-twenty-characters', false, 'A']; fixture.keysStatus = 'error';
    const tree = page(); const save = findButton(tree, en['keys.save']); expect(save.props.disabled).toBe(true);
    save.props.onClick?.(); expect(writes.saveOwnKey).not.toHaveBeenCalled();
  });
  it('hides and clears a company A key draft as soon as company B is selected', () => {
    fixture.values = ['openai', 'synthetic-key-at-least-twenty-characters', false, 'A'];
    expect(elements(page()).filter(e => e.type === 'input')).toHaveLength(1);
    const B = page('B'); expect(elements(B).filter(e => e.type === 'input')).toHaveLength(0);
    fixture.effects.forEach(effect => effect());
    expect(fixture.values.slice(0, 4)).toEqual([null, '', false, 'B']);
  });
  it('ignores a late company A save response after switching to B', async () => {
    let finish!: (value: { models: string[] }) => void;
    writes.saveOwnKey.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    fixture.values = ['openai', 'synthetic-key-at-least-twenty-characters', false, 'A'];
    findButton(page(), en['keys.save']).props.onClick?.();
    expect(writes.saveOwnKey).toHaveBeenCalledWith('A', 'openai', 'synthetic-key-at-least-twenty-characters');
    page('B'); fixture.effects.forEach(effect => effect());
    finish({ models: ['synthetic-model'] }); await Promise.resolve(); await Promise.resolve();
    expect(notices.success).not.toHaveBeenCalled(); expect(fixture.retryKeys).not.toHaveBeenCalled();
    expect(fixture.values.slice(0, 4)).toEqual([null, '', false, 'B']);
  });
  it('does not permit writes for a read-only user even if an editor event is forced', () => {
    fixture.values = ['openai', 'synthetic-key-at-least-twenty-characters', false, 'A'];
    const tree = page('A', false); findButton(tree, en['keys.save']).props.onClick?.(); expect(writes.saveOwnKey).not.toHaveBeenCalled();
  });
  it('provides status and retry copy for all eight languages', () => {
    expect(Object.keys(KEY_STATUS_COPY)).toHaveLength(8);
    for (const copy of Object.values(KEY_STATUS_COPY)) expect(Object.keys(copy)).toEqual(Object.keys(KEY_STATUS_COPY.en));
  });
});
