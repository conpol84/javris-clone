import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ org: 'company-a', index: 0, states: [] as unknown[], setters: [] as ReturnType<typeof vi.fn>[] }));
const api = vi.hoisted(() => ({ createTask: vi.fn(), runTask: vi.fn(), listAgents: vi.fn(), read: vi.fn(), eq: vi.fn(), select: vi.fn(), from: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: () => { const i = fixture.index++; const setter = vi.fn(); fixture.setters[i] = setter; return [fixture.states[i], setter]; },
  useEffect: () => undefined,
  useRef: () => ({ current: false }),
}));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.org }, role: 'owner' }, user: { id: 'owner' } }) }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string) => key }) }));
vi.mock('../../lib/company/workspaceCopy', () => ({ useWorkspaceCopy: () => (key: string) => key }));
vi.mock('../../lib/company/data', () => ({ createTask: api.createTask, listAgents: api.listAgents }));
vi.mock('../../lib/company/runner', () => ({ runTask: api.runTask, runErrorText: () => 'Run failed' }));
vi.mock('../../lib/company/client', () => ({ requireClient: () => ({ from: api.from }) }));
vi.mock('../../lib/company/labels', () => ({ agentLabel: () => ({ name: 'Research Agent' }) }));
vi.mock('./AskButton', () => ({ AskButton: () => null }));
vi.mock('./ReportView', () => ({ ReportView: () => null }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('react-router', () => ({ Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
import { CeoActions } from './CeoActions';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void; offer?: unknown }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const el = node as Element;
  return [el, ...elements(el.props.children)];
}
const offer = { agentId: 'agent-a', title: 'Prepare slides', details: 'Use verified sources' };
function taskTree() {
  fixture.index = 0;
  const child = elements(CeoActions({ task: offer })).find(e => e.props.offer === offer)!;
  return (child.type as (props: unknown) => ReactNode)(child.props);
}
const click = (tree: ReactNode) => elements(tree).find(e => e.type === 'button')!.props.onClick!();
describe('CEO action execution and combined offers', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.org = 'company-a'; fixture.index = 0; fixture.setters = [];
    fixture.states = [{ orgId: 'company-a', id: 'agent-a', agent: { id: 'agent-a' } }, 'idle', null];
    api.createTask.mockResolvedValue('task-a'); api.runTask.mockResolvedValue({ status: 'completed', queued: 0 });
    api.read.mockResolvedValue({ data: { status: 'completed', result: { report: 'Saved work' } }, error: null });
    api.eq.mockReturnValue({ eq: api.eq, maybeSingle: api.read }); api.select.mockReturnValue({ eq: api.eq }); api.from.mockReturnValue({ select: api.select });
  });
  it('renders task, meeting and employee handover together', () => {
    const children = elements(CeoActions({ task: offer, ask: { agentId: 'agent-a', question: 'Explain' }, meet: { topic: 'Pricing', participants: ['agent-a'] } }));
    expect(children.filter(e => typeof e.type === 'function')).toHaveLength(3);
  });
  it('renders both the task submission control and the meeting link', () => {
    const html = renderToStaticMarkup(CeoActions({ task: offer, meet: { topic: 'Pricing', participants: ['agent-a'] } }));
    expect(html).toContain('ctGive'); expect(html).toContain('/missions?meet=Pricing'); expect(html).toContain('mtOpen');
  });
  it('does not mark a rejected run completed or create a second task', async () => {
    api.runTask.mockRejectedValue(new Error('budget_exceeded'));
    click(taskTree());
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('failed'));
    expect(fixture.setters[1]).not.toHaveBeenCalledWith('done'); expect(api.read).not.toHaveBeenCalled();
    expect(api.createTask).toHaveBeenCalledTimes(1);
  });
  it('keeps an approval pending without claiming completion', async () => {
    api.runTask.mockResolvedValue({ status: 'awaiting_approval', queued: 1 });
    click(taskTree());
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('awaiting_approval'));
    expect(fixture.setters[1]).not.toHaveBeenCalledWith('done'); expect(api.read).not.toHaveBeenCalled();
  });
  it.each([
    { data: null, error: null },
    { data: { status: 'failed', result: { report: 'Old draft' } }, error: null },
    { data: { status: 'completed', result: null }, error: null },
    { data: null, error: new Error('Read denied') },
  ])('requires a persisted completed task and result: %j', async response => {
    api.read.mockResolvedValue(response); click(taskTree());
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('failed'));
    expect(fixture.setters[1]).not.toHaveBeenCalledWith('done');
  });
  it('reads the completed artifact within the current company before showing done', async () => {
    click(taskTree());
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('done'));
    expect(api.eq).toHaveBeenCalledWith('organization_id', 'company-a');
    expect(fixture.setters[2]).toHaveBeenCalledWith(expect.objectContaining({ report: 'Saved work' }));
  });
  it('blocks repeated clicks while the same submission is in flight', async () => {
    const tree = taskTree(); click(tree); click(tree);
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('done'));
    expect(api.createTask).toHaveBeenCalledTimes(1);
  });
  it('does not use the previous company employee during a switch', () => {
    fixture.org = 'company-b'; expect(taskTree()).toBeNull(); expect(api.createTask).not.toHaveBeenCalled();
  });
});
