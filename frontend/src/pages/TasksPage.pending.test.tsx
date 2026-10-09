import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ states: [] as any[], refs: [] as { current: any }[], index: 0, refIndex: 0,
  effects: [] as (() => void | (() => void))[], org: 'org-1', user: 'owner-1', role: 'owner', tasks: [] as any[] }));
const runTask = vi.hoisted(() => vi.fn());
const reload = vi.hoisted(() => vi.fn());
const append = vi.hoisted(() => vi.fn());
const notice = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = fixture.index++; if (!(i in fixture.states)) fixture.states[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [fixture.states[i], (value: any) => { fixture.states[i] = typeof value === 'function' ? value(fixture.states[i]) : value; }]; },
  useRef: (initial: unknown) => { const i = fixture.refIndex++; return fixture.refs[i] ??= { current: initial }; },
  useEffect: (callback: () => void | (() => void)) => { fixture.effects.push(callback); },
  useMemo: (callback: () => unknown) => callback(),
}));
vi.mock('sonner', () => ({ toast: notice }));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { role: fixture.role, organization: { id: fixture.org, name: 'Company' } }, user: { id: fixture.user } }) }));
vi.mock('../lib/company/useOrgData', () => ({ useOrgData: () => ({ tasks: fixture.tasks, agents: [{ id: 'agent-1', name: 'Employee', type: 'ceo', slug: 'ceo', enabled: true }], approvals: [], error: '', reload }) }));
vi.mock('../lib/company/data', () => ({ appendTaskNote: append, createTask: vi.fn() }));
vi.mock('../lib/company/runner', async original => ({ ...await original<typeof import('../lib/company/runner')>(), runTask }));
vi.mock('../lib/company/labels', () => ({ agentLabel: () => ({ name: 'Employee' }) }));
vi.mock('../i18n/I18nProvider', async original => {
  const module = await original<typeof import('../i18n/I18nProvider')>();
  return { ...module, useI18n: () => module.defaultI18n };
});
import { TasksPage } from './TasksPage';
import { ComputerExecutionView } from '../components/company/ComputerExecutionView';
import { defaultI18n } from '../i18n/I18nProvider';

const JOB = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const execution = () => ({ contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: JOB, request_id: JOB, device_id: DEVICE, device_name: 'Chosen Debian', kind: 'desktop_task', status: 'queued' }] });
const task = () => ({ id: 'task-1', title: 'Open requested app', assigned_agent_id: 'agent-1', status: 'pending', priority: 'normal', due_at: null, created_at: '2026-10-09T00:00:00Z', result: null });
type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; onClick?: () => unknown; execution?: unknown }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children)];
}
function page() { fixture.index = 0; fixture.refIndex = 0; fixture.effects = []; return elements(TasksPage()); }
function runButton() { return page().find(node => node.type === 'button' && node.props.children === defaultI18n.t('run.btn'))!; }
beforeEach(() => {
  vi.clearAllMocks(); fixture.states = []; fixture.refs = []; fixture.tasks = [task()]; fixture.org = 'org-1'; fixture.user = 'owner-1'; fixture.role = 'owner';
  reload.mockResolvedValue(undefined); runTask.mockResolvedValue({ status: 'running', pending: true, queued: 0, computer_execution: execution() });
});

it('uses a pending worker notice for HTTP202 and retains its exact job on the card', async () => {
  await runButton().props.onClick?.();
  await Promise.resolve();
  expect(runTask).toHaveBeenCalledExactlyOnceWith('task-1', 'en');
  expect(notice.message).toHaveBeenCalledOnce();
  expect(notice.message.mock.calls[0][0]).toContain(JOB);
  expect(notice.message.mock.calls[0][0]).toContain('Chosen Debian');
  expect(notice.success).not.toHaveBeenCalled(); expect(notice.error).not.toHaveBeenCalled();
  expect(reload).toHaveBeenCalledOnce();
  expect(page().find(node => node.type === ComputerExecutionView)?.props.execution).toMatchObject({ jobs: [{ job_id: JOB, device_id: DEVICE }] });
  expect(runButton().props.disabled).toBe(true); // stale reload cannot enable replay
});

it.each([['completed', 0, 'success'], ['awaiting_approval', 2, 'message'], ['failed', 0, 'error'], ['blocked', 0, 'error']] as const)(
  'keeps the existing %s status truthful', async (status, queued, tone) => {
    runTask.mockResolvedValue({ status, queued, pending: false });
    await runButton().props.onClick?.(); await Promise.resolve();
    expect(notice[tone]).toHaveBeenCalledOnce();
    if (status !== 'completed') expect(notice.success).not.toHaveBeenCalled();
  });

it.each(['org', 'user', 'role'] as const)('ignores an old running response after a %s switch', async key => {
  let finish!: (value: unknown) => void;
  runTask.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  runButton().props.onClick?.();
  fixture[key] = 'changed'; page();
  finish({ status: 'running', queued: 0, pending: true, computer_execution: execution() });
  await Promise.resolve(); await Promise.resolve();
  expect(notice.message).not.toHaveBeenCalled(); expect(notice.success).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
});

it('ignores a late response after the page closes', async () => {
  let finish!: (value: unknown) => void;
  runTask.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const button = runButton();
  const cleanup = fixture.effects[0]()!;
  button.props.onClick?.(); cleanup();
  finish({ status: 'running', queued: 0, pending: true, computer_execution: execution() });
  await Promise.resolve(); await Promise.resolve();
  expect(notice.message).not.toHaveBeenCalled(); expect(reload).not.toHaveBeenCalled();
});

it('keeps pending receipt work out of the rerun action', () => {
  fixture.tasks[0] = { ...task(), status: 'running', result: { report: 'Still pending', computer_execution: execution() } };
  const tree = page();
  expect(tree.filter(node => node.type === 'button' && node.props.children === defaultI18n.t('run.btn'))).toHaveLength(0);
  expect(tree.find(node => node.type === ComputerExecutionView)?.props.execution).toMatchObject({ status: 'pending' });
});
