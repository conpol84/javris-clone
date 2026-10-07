import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: any }[], index: 0, refIndex: 0, effects: [] as (() => void | (() => void))[], role: 'owner', org: 'org', user: 'owner', setters: [] as ReturnType<typeof vi.fn>[] }));
const dispatch = vi.hoisted(() => vi.fn());
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => { const i = fixture.index++; const setter = vi.fn(); fixture.setters[i] = setter; return [fixture.states[i], setter]; },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ?? { current: initial },
  useEffect: (callback: () => void | (() => void)) => { fixture.effects.push(callback); },
  useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
}));
vi.mock('react-router', () => ({ useSearchParams: () => [new URLSearchParams('c=chat'), vi.fn()] }));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { role: fixture.role, organization: { id: fixture.org } }, user: { id: fixture.user } }) }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key, fmt: { relative: () => 'now', date: () => 'today' } }) }));
vi.mock('../lib/company/labels', () => ({ agentLabel: () => ({ name: 'CEO' }) }));
vi.mock('../lib/company/voice', () => ({ unlockAudio: vi.fn(), speak: vi.fn(), listenSmart: vi.fn() }));
vi.mock('../lib/company/laptop-bridge', async original => ({ ...await original<typeof import('../lib/company/laptop-bridge')>(), dispatchDirectComputerCommand: dispatch }));
import { AgentChatPage } from './AgentChatPage';

type Element = ReactElement<{ children?: ReactNode; 'aria-label'?: string; onClick?: () => void; onSubmit?: (e: { preventDefault: () => void }) => Promise<void> }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function page(text = 'yes', running = false) {
  fixture.index = 0; fixture.refIndex = 0; fixture.effects = [];
  fixture.states = [[{ id: 'ceo', slug: 'ceo', type: 'ceo', name: 'CEO' }], [{ id: 'chat', agent_id: 'ceo' }], [], text, false, false, false, '', false, running, true];
  return AgentChatPage();
}
beforeEach(() => {
  vi.clearAllMocks(); fixture.role = 'owner'; fixture.org = 'org'; fixture.user = 'owner';
  fixture.refs = [{ current: vi.fn() }, { current: null }, { current: null }, { current: null }, { current: false }, { current: null }, { current: '' }];
});
it('exposes an accessible Stop control that aborts the running command', () => {
  const controller = new AbortController(); fixture.refs[2].current = controller;
  elements(page('yes', true)).find(e => e.props['aria-label'] === 'ceo.stop')!.props.onClick?.();
  expect(controller.signal.aborted).toBe(true);
});
it('clears pending approval and aborts the old command on company, user or role changes', () => {
  for (const change of ['org', 'user', 'role'] as const) {
    const controller = new AbortController(); fixture.refs[1].current = { kind: 'open_app' }; fixture.refs[2].current = controller;
    fixture[change] = 'changed'; page(); fixture.effects[0]();
    expect(controller.signal.aborted).toBe(true); expect(fixture.refs[1].current).toBeNull(); expect(fixture.refs[2].current).toBeNull();
  }
});
it('requests Stop when the page unmounts', () => {
  page(); const cleanup = fixture.effects[0]()!;
  const controller = new AbortController(); fixture.refs[2].current = controller;
  cleanup(); expect(controller.signal.aborted).toBe(true);
});
it('runs the same pending action for no, do it yourself without delegating', async () => {
  const proposal = { kind: 'open_app', params: { app: 'Microsoft Word' }, description: 'Open Word' };
  fixture.refs[1].current = proposal; dispatch.mockResolvedValue({ reply: 'confirmed' });
  await elements(page('no, do it yourself')).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: vi.fn() });
  expect(dispatch).toHaveBeenCalledOnce(); expect(dispatch).toHaveBeenCalledWith('org', proposal, 'en', expect.any(AbortSignal));
  expect(fixture.refs[1].current).toBeNull();
});
it('never dispatches an explicit rejected app command', async () => {
  await elements(page('do not open Microsoft Word')).find(e => e.type === 'form')!.props.onSubmit?.({ preventDefault: vi.fn() });
  expect(dispatch).not.toHaveBeenCalled(); expect(fixture.refs[1].current).toBeNull();
});
