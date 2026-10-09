import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixture = vi.hoisted(() => ({ org: 'org-a', role: 'owner', values: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0,
  setters: [] as ReturnType<typeof vi.fn>[], effects: [] as (() => unknown)[] }));
const data = vi.hoisted(() => ({ listWorkflows: vi.fn(), listWorkflowRuns: vi.fn(), listAgents: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = fixture.stateIndex++; fixture.setters[i] ??= vi.fn(); return [fixture.values[i] ?? initial, fixture.setters[i]]; },
  useRef: (initial: unknown) => { const i = fixture.refIndex++; fixture.refs[i] ??= { current: initial }; return fixture.refs[i]; },
  useCallback: (fn: unknown) => fn, useMemo: (fn: () => unknown) => fn(), useEffect: (effect: () => unknown) => { fixture.effects.push(effect); },
}));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.org }, role: fixture.role }, user: { id: 'user-a' } }) }));
vi.mock('../lib/company/data', () => ({ listAgents: data.listAgents }));
vi.mock('../lib/company/workspace', () => ({ ...data, saveWorkflow: vi.fn(), deleteWorkflow: vi.fn(), startWorkflow: vi.fn(), workflowHook: vi.fn() }));
vi.mock('../lib/company/workspaceCopy', () => ({ useWorkspaceCopy: () => (key: string) => key }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }));
import { WorkflowWorkspace, WorkflowsPage } from './WorkflowsPage';
function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
}
const flush = async () => { await new Promise(resolve => setTimeout(resolve, 0)); };
describe('workflow workspace loading and identity boundary', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.org = 'org-a'; fixture.role = 'owner'; fixture.values = []; fixture.refs = []; fixture.setters = []; fixture.effects = []; fixture.stateIndex = 0; fixture.refIndex = 0;
    data.listWorkflows.mockResolvedValue([]); data.listWorkflowRuns.mockResolvedValue([]); data.listAgents.mockResolvedValue([]); });
  it('remounts stateful workflows on company or role changes so old drafts, inputs and hooks cannot survive', () => {
    expect(WorkflowsPage().key).toBe('user-a:org-a:owner');
    fixture.org = 'org-b'; expect(WorkflowsPage().key).toBe('user-a:org-b:owner');
    fixture.role = 'viewer'; expect(WorkflowsPage().key).toBe('user-a:org-b:viewer');
  });
  it('shows loading rather than a false empty state', () => {
    const tree = WorkflowWorkspace();
    expect(elements(tree).some(e => e.props.role === 'status')).toBe(true);
    expect(elements(tree).some(e => e.props.title === 'wEmpty')).toBe(false);
  });
  it('rejects late reads after the previous workspace unmounts', async () => {
    let resolve!: (rows: unknown[]) => void;
    data.listWorkflows.mockImplementation(() => new Promise(r => { resolve = r; }));
    WorkflowWorkspace(); const cleanup = fixture.effects[0]() as () => void; fixture.effects[1]();
    cleanup(); resolve([{ id: 'old-flow' }]); await flush();
    expect(fixture.setters[0]).not.toHaveBeenCalled(); expect(fixture.setters[1]).not.toHaveBeenCalled();
  });
  it('keeps the newer refresh when two reads finish out of order', async () => {
    let resolveFirst!: (rows: unknown[]) => void; let resolveSecond!: (rows: unknown[]) => void;
    data.listWorkflows.mockImplementationOnce(() => new Promise(r => { resolveFirst = r; }))
      .mockImplementationOnce(() => new Promise(r => { resolveSecond = r; }));
    fixture.values = [[], [], [], null, {}, null, false, false, true];
    const tree = WorkflowWorkspace(); fixture.effects[0](); fixture.effects[1]();
    const retry = elements(tree).find(e => e.type === 'button' && e.props.children === 'Retry');
    (retry!.props.onClick as () => void)(); resolveSecond([{ id: 'new-flow' }]); await flush();
    resolveFirst([{ id: 'old-flow' }]); await flush();
    expect(fixture.setters[0]).toHaveBeenCalledExactlyOnceWith([{ id: 'new-flow' }]);
  });
  it('represents failed reads as unavailable and offers retry', async () => {
    data.listWorkflows.mockRejectedValue(new Error('synthetic offline'));
    WorkflowWorkspace(); fixture.effects[0](); fixture.effects[1](); await flush();
    expect(fixture.setters[8]).toHaveBeenCalledWith(true);
    fixture.values = [[], [], [], null, {}, null, false, false, true]; fixture.stateIndex = 0; fixture.refIndex = 0; fixture.effects = [];
    const tree = WorkflowWorkspace();
    expect(elements(tree).some(e => e.props.role === 'alert')).toBe(true);
    expect(elements(tree).some(e => e.type === 'button' && e.props.children === 'Retry')).toBe(true);
  });
});
