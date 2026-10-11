import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ org: 'company-a', index: 0, refIndex: 0, states: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as (() => void | (() => void))[], setters: [] as ReturnType<typeof vi.fn>[] }));
const api = vi.hoisted(() => ({ createTask: vi.fn(), runTask: vi.fn(), listAgents: vi.fn(), read: vi.fn(), eq: vi.fn(), select: vi.fn(), from: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = fixture.index++; const setter = vi.fn(); fixture.setters[i] = setter;
    return [i in fixture.states ? fixture.states[i] : initial, setter]; },
  useEffect: (effect: () => void | (() => void)) => { fixture.effects.push(effect); },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ??= { current: initial },
}));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.org }, role: 'owner' }, user: { id: 'owner' } }) }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string, vars?: Record<string, unknown>) => vars ? `${key} ${JSON.stringify(vars)}` : key }) }));
vi.mock('../../lib/company/workspaceCopy', () => ({ useWorkspaceCopy: () => (key: string) => key }));
vi.mock('../../lib/company/data', () => ({ createTask: api.createTask, listAgents: api.listAgents }));
vi.mock('../../lib/company/runner', async original => ({ ...await original<typeof import('../../lib/company/runner')>(), runTask: api.runTask, runErrorText: () => 'Run failed' }));
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
const execution = {
  contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: '11111111-1111-4111-8111-111111111111', request_id: '11111111-1111-4111-8111-111111111111',
    device_id: '22222222-2222-4222-8222-222222222222', device_name: 'Chosen Debian', kind: 'desktop_task', status: 'queued' }],
};
function taskTree() {
  fixture.index = 0; fixture.refIndex = 0; fixture.effects = [];
  const child = elements(CeoActions({ task: offer })).find(e => e.props.offer === offer)!;
  return (child.type as (props: unknown) => ReactNode)(child.props);
}
const click = (tree: ReactNode) => elements(tree).find(e => e.type === 'button')!.props.onClick!();
describe('CEO action execution and combined offers', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.org = 'company-a'; fixture.index = 0; fixture.refIndex = 0; fixture.refs = []; fixture.effects = []; fixture.setters = [];
    fixture.states = [{ orgId: 'company-a', id: 'agent-a', agent: { id: 'agent-a' } }, 'idle', null, null];
    api.createTask.mockResolvedValue('task-a'); api.runTask.mockResolvedValue({ status: 'completed', queued: 0 });
    api.listAgents.mockResolvedValue([]);
    api.read.mockResolvedValue({ data: { status: 'completed', result: { report: 'Saved work' } }, error: null });
    api.eq.mockReturnValue({ eq: api.eq, maybeSingle: api.read }); api.select.mockReturnValue({ eq: api.eq }); api.from.mockReturnValue({ select: api.select });
  });
  it('renders task, meeting and employee handover together', () => {
    const children = elements(CeoActions({ task: offer, ask: { agentId: 'agent-a', question: 'Explain' }, meet: { topic: 'Pricing', participants: ['agent-a'] }, app: { kind: 'gdrive_read', name: 'Google Drive · read', reason: 'Use approved briefs' } }));
    expect(children.filter(e => typeof e.type === 'function')).toHaveLength(4);
  });
  it('renders both the task submission control and the meeting link', () => {
    const html = renderToStaticMarkup(CeoActions({ task: offer, meet: { topic: 'Pricing', participants: ['agent-a'] } }));
    expect(html).toContain('ctGive'); expect(html).toContain('/missions?meet=Pricing'); expect(html).toContain('mtOpen');
  });
  it('renders a work-source suggestion as a review link, not an automatic connection', () => {
    const html = renderToStaticMarkup(CeoActions({ app: { kind: 'gdrive_read', name: 'Google Drive · read', reason: 'Use approved briefs' } }));
    expect(html).toContain('caSource');
    expect(html).toContain('Use approved briefs');
    expect(html).toContain('/integrations?connect=gdrive_read');
    expect(html).toContain('caConnect');
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
  it('keeps the worker running acknowledgement pending without reading a completed result or retrying', async () => {
    api.runTask.mockResolvedValue({ status: 'running', pending: true, computer_execution: execution });
    click(taskTree());
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('running'));
    expect(fixture.setters[1]).not.toHaveBeenCalledWith('done');
    expect(fixture.setters[1]).not.toHaveBeenCalledWith('failed');
    expect(api.read).not.toHaveBeenCalled();
    expect(api.createTask).toHaveBeenCalledOnce(); expect(api.runTask).toHaveBeenCalledExactlyOnceWith('task-a', 'en');
  });
  it('shows the selected worker and queued job while the task is still running', () => {
    fixture.states = [fixture.states[0], 'running', null, { status: 'running', queued: 0, pending: true, computer_execution: execution }];
    const html = renderToStaticMarkup(taskTree());
    expect(html).toContain('Chosen Debian'); expect(html).toContain(execution.jobs[0].job_id);
    expect(html).toContain('status.pending'); expect(html).toContain('/tasks');
    expect(html).not.toContain('ctDone'); expect(html).not.toContain('audit.taskstate.failed');
  });
  it('keeps a persisted task that is still running pending after the immediate response', async () => {
    api.read.mockResolvedValue({ data: { status: 'running', result: { computer_execution: execution } }, error: null });
    click(taskTree());
    await vi.waitFor(() => expect(fixture.setters[1]).toHaveBeenCalledWith('running'));
    expect(fixture.setters[1]).not.toHaveBeenCalledWith('failed'); expect(fixture.setters[1]).not.toHaveBeenCalledWith('done');
    expect(api.eq).toHaveBeenCalledWith('organization_id', 'company-a'); expect(api.runTask).toHaveBeenCalledOnce();
  });
  it('does not start the old company task if the action closes during task creation', async () => {
    let finish!: (id: string) => void;
    api.createTask.mockReturnValue(new Promise<string>(resolve => { finish = resolve; }));
    const tree = taskTree(); const cleanups = fixture.effects.map(effect=>effect()).filter((value):value is () => void=>typeof value==='function'); const cleanup=cleanups[cleanups.length-1]!;
    click(tree); cleanup(); finish('old-company-task');
    await Promise.resolve(); await Promise.resolve();
    expect(api.runTask).not.toHaveBeenCalled(); expect(api.read).not.toHaveBeenCalled();
    expect(fixture.setters[1]).toHaveBeenCalledExactlyOnceWith('working');
  });
  it('rejects a late worker acknowledgement after switching company', async () => {
    let finish!: (outcome: unknown) => void;
    api.runTask.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    click(taskTree()); await vi.waitFor(() => expect(api.runTask).toHaveBeenCalledOnce());
    const originalPhase = fixture.setters[1]; const originalAcknowledgement = fixture.setters[3];
    fixture.org = 'company-b'; expect(taskTree()).toBeNull();
    finish({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    await Promise.resolve(); await Promise.resolve();
    expect(originalPhase).not.toHaveBeenCalledWith('running'); expect(originalPhase).not.toHaveBeenCalledWith('done');
    expect(originalAcknowledgement).not.toHaveBeenCalled(); expect(api.read).not.toHaveBeenCalled();
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
