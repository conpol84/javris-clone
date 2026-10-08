import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  org: 'org-a', states: [] as unknown[], stateIndex: 0,
  refs: [] as { current: unknown }[], refIndex: 0,
  effects: [] as (() => undefined | (() => void))[],
}));
const data = vi.hoisted(() => ({
  listKnowledge: vi.fn(), searchKnowledge: vi.fn(), addKnowledgeText: vi.fn(), addKnowledgeUrl: vi.fn(),
  addKnowledgeApp: vi.fn(), deleteKnowledge: vi.fn(), syncKnowledge: vi.fn(),
}));
const integrations = vi.hoisted(() => ({ listIntegrations: vi.fn() }));
const notices = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = fixture.stateIndex++;
    if (!(index in fixture.states)) fixture.states[index] = initial;
    return [fixture.states[index], (value: unknown) => { fixture.states[index] = value; }];
  },
  useRef: (initial: unknown) => {
    const index = fixture.refIndex++;
    return fixture.refs[index] ??= { current: initial };
  },
  useEffect: (effect: () => undefined | (() => void)) => { fixture.effects.push(effect); },
  useCallback: (callback: unknown) => callback,
  useMemo: (callback: () => unknown) => callback(),
}));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.org }, role: 'owner' } }) }));
vi.mock('../lib/company/workspace', () => ({ ...data, READABLE_APPS: ['notion'] }));
vi.mock('../lib/company/integrations', () => integrations);
vi.mock('../lib/company/workspaceCopy', () => ({ useWorkspaceCopy: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: notices }));

import { KnowledgePage, KnowledgeWorkspace } from './KnowledgePage';
import { Pill } from '../components/ui/kit';

type Element = ReactElement<{
  children?: ReactNode; value?: string; placeholder?: string; tone?: string;
  onSubmit?: (event: { preventDefault: () => void }) => unknown;
}>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function page(states: unknown[] = []) {
  fixture.states = states; fixture.stateIndex = 0; fixture.refIndex = 0;
  fixture.refs = []; fixture.effects = [];
  return KnowledgeWorkspace({ orgId: fixture.org, canManage: true });
}
function mountEffects() {
  const cleanup = fixture.effects.map(effect => effect());
  return () => cleanup.forEach(fn => fn?.());
}
const submit = { preventDefault: vi.fn() };

describe('Knowledge company boundaries and refresh status', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.org = 'org-a';
    data.listKnowledge.mockResolvedValue([]); integrations.listIntegrations.mockResolvedValue([]);
    data.addKnowledgeText.mockResolvedValue({ source_id: 'source-a' });
    data.searchKnowledge.mockResolvedValue({ results: [] });
  });
  it('keys the workspace by company so switching resets all drafts/lists/search state', () => {
    const first = KnowledgePage(); fixture.org = 'org-b'; const next = KnowledgePage();
    expect(first.key).toBe('org-a'); expect(next.key).toBe('org-b');
    expect(first.type).toBe(KnowledgeWorkspace); expect(next.type).toBe(KnowledgeWorkspace);
    const fresh = page();
    const values = elements(fresh).filter(element => element.type === 'input' || element.type === 'textarea')
      .map(element => element.props.value).filter(value => value != null);
    expect(values.every(value => value === '')).toBe(true);
    expect(fixture.states[0]).toEqual([]); expect(fixture.states[1]).toEqual([]); expect(fixture.states[8]).toBeNull();
  });
  it('discards source/app responses that arrive after the old company unmounts', async () => {
    const sources = deferred<unknown[]>(); const apps = deferred<unknown[]>();
    data.listKnowledge.mockReturnValue(sources.promise); integrations.listIntegrations.mockReturnValue(apps.promise);
    page(); const unmount = mountEffects(); unmount();
    sources.resolve([{ id: 'source-a', name: 'Private company A' }]); apps.resolve([{ id: 'app-a', kind: 'notion' }]);
    await Promise.all([sources.promise, apps.promise]); await Promise.resolve();
    expect(fixture.states[0]).toEqual([]); expect(fixture.states[1]).toEqual([]);
    expect(notices.error).not.toHaveBeenCalled();
  });
  it('discards old search hits and busy-state updates after unmount', async () => {
    const response = deferred<{ results: unknown[] }>(); data.searchKnowledge.mockReturnValue(response.promise);
    const tree = page([[], [], '', '', '', '', '', 'private question', null]); const unmount = mountEffects();
    const forms = elements(tree).filter(element => element.type === 'form');
    const job = forms[3].props.onSubmit?.(submit); unmount();
    response.resolve({ results: [{ title: 'Private company A', content: 'private' }] }); await job;
    expect(fixture.states[8]).toBeNull(); expect(notices.error).not.toHaveBeenCalled();
    expect(fixture.states[6]).toBe('search');
  });
  it('finishes an old-company mutation without resetting the new company draft or showing success there', async () => {
    const response = deferred<unknown>(); data.addKnowledgeText.mockReturnValue(response.promise);
    const tree = page([[], [], 'Draft A', 'Long synthetic company document.', '', '', '', '', null]);
    const unmount = mountEffects();
    elements(tree).find(element => element.type === 'form')?.props.onSubmit?.(submit); unmount();
    fixture.states[2] = 'New company draft'; fixture.states[3] = 'New company text';
    response.resolve({ source_id: 'source-a' }); await response.promise; await Promise.resolve();
    expect(fixture.states[2]).toBe('New company draft'); expect(fixture.states[3]).toBe('New company text');
    expect(notices.success).not.toHaveBeenCalled();
    expect(data.addKnowledgeText).toHaveBeenCalledWith('org-a', 'Draft A', 'Long synthetic company document.');
  });
  it('renders the database failed state as an error pill', () => {
    const tree = page([[{ id: 'source-a', name: 'Document', type: 'url', status: 'failed', item_count: 1, last_error: 'save_failed' }]]);
    const pill = elements(tree).find(element => element.type === Pill);
    expect(pill?.props.tone).toBe('err'); expect(pill?.props.children).toBe('failed');
  });
  it('reloads source status after a failed refresh instead of retaining a stale ready label', async () => {
    data.syncKnowledge.mockRejectedValue(new Error('sync_failed'));
    const source = { id: 'source-a', name: 'Document', type: 'url', status: 'ready', item_count: 1, last_error: null };
    const tree = page([[source]]); mountEffects();
    const button = elements(tree).find(element => element.type === 'button' && (element.props as Record<string, unknown>)['aria-label'] === 'kSync');
    await (button?.props as { onClick?: () => Promise<void> }).onClick?.();
    expect(notices.error).toHaveBeenCalledWith('kErr'); expect(data.listKnowledge).toHaveBeenCalledTimes(2);
  });
});
