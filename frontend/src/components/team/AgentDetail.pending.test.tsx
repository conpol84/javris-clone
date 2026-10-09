import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentRow, TaskRow } from '../../lib/company/types';

const fixture = vi.hoisted(() => ({ index: 0, refIndex: 0, values: [] as unknown[], refs: [] as { current: unknown }[] }));
const api = vi.hoisted(() => ({ runTask: vi.fn(), changed: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = fixture.index++; if (!(i in fixture.values)) fixture.values[i] = typeof initial === 'function' ? initial() : initial;
    return [fixture.values[i], (next: unknown) => { fixture.values[i] = typeof next === 'function' ? next(fixture.values[i]) : next; }]; },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ??= { current: initial }, useEffect: () => undefined,
}));
vi.mock('../../lib/company/runner', async original => ({ ...await original<typeof import('../../lib/company/runner')>(), runTask: api.runTask }));
vi.mock('../../lib/company/data', () => ({ loadAgentUsage: vi.fn() }));
vi.mock('../../lib/company/labels', () => ({ agentLabel: () => ({ name: 'Employee A' }) }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string, vars?: Record<string, unknown>) => vars ? `${key} ${JSON.stringify(vars)}` : key }) }));
vi.mock('sonner', () => ({ toast: notices }));
import { AgentDetail } from './AgentDetail';
import { ComputerExecutionView } from '../company/ComputerExecutionView';

type Element = ReactElement<{ children?: ReactNode; disabled?: boolean; execution?: unknown; onClick?: () => void }>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as Element; return [element, ...elements(element.props.children)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join('');
  if (isValidElement(node)) return text((node as Element).props.children);
  return typeof node === 'string' ? node : '';
}
const agent = { id: 'agent-a', name: 'Employee A', type: 'custom', slug: 'employee-a', enabled: true, autonomy: 'guarded', monthly_budget_usd: null, agent_tools: [] } as unknown as AgentRow;
const task = { id: 'task-a', title: 'Browse company sources', assigned_agent_id: 'agent-a', status: 'pending', result: null } as TaskRow;
const execution = {
  contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: '11111111-1111-4111-8111-111111111111', request_id: '11111111-1111-4111-8111-111111111111',
    device_id: '22222222-2222-4222-8222-222222222222', device_name: 'Chosen Debian', kind: 'desktop_task', status: 'queued' }],
};
function page(tasks: TaskRow[] = [task]) {
  fixture.index = 0; fixture.refIndex = 0;
  return AgentDetail({ orgId: 'org-a', agent, tasks, canSeeUsage: false, canRun: true, onChanged: api.changed });
}
const runButton = (tree: ReactNode) => elements(tree).find(element => element.type === 'button' && text(element) === 'office.run')!;
describe('employee detail task acknowledgement', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.index = 0; fixture.refIndex = 0; fixture.values = []; fixture.refs = []; });
  it('keeps running work pending and refreshes the persisted task without reporting completion', async () => {
    api.runTask.mockResolvedValue({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    const tree = AgentDetail({ orgId: 'org-a', agent, tasks: [task], canSeeUsage: false, canRun: true, onChanged: api.changed });
    elements(tree).find(element => element.type === 'button' && text(element) === 'office.run')!.props.onClick!();
    await vi.waitFor(() => expect(api.changed).toHaveBeenCalled());
    expect(notices.message).toHaveBeenCalledWith(expect.stringContaining('Chosen Debian'));
    expect(notices.message).toHaveBeenCalledWith(expect.stringContaining(execution.jobs[0].job_id));
    expect(notices.success).not.toHaveBeenCalledWith('run.completed'); expect(notices.error).not.toHaveBeenCalled();
    expect(api.runTask).toHaveBeenCalledExactlyOnceWith('task-a', 'en');
  });
  it('blocks a second run while stale pending props wait for the acknowledged worker result', async () => {
    api.runTask.mockResolvedValue({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    runButton(page()).props.onClick!();
    await vi.waitFor(() => expect(api.changed).toHaveBeenCalledOnce());
    const stale = page();
    expect(runButton(stale).props.disabled).toBe(true);
    expect(elements(stale).find(element => element.type === ComputerExecutionView)!.props.execution).toEqual(execution);
    expect(text(stale)).toContain('Chosen Debian'); expect(text(stale)).toContain(execution.jobs[0].job_id);
    runButton(stale).props.onClick!();
    await Promise.resolve();
    expect(api.runTask).toHaveBeenCalledOnce(); expect(api.changed).toHaveBeenCalledOnce();
  });
  it('shows the durable terminal receipt instead of the earlier pending acknowledgement', async () => {
    api.runTask.mockResolvedValue({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    runButton(page()).props.onClick!();
    await vi.waitFor(() => expect(api.changed).toHaveBeenCalledOnce());
    const job = execution.jobs[0];
    const result = { summary: 'Worker finished the page', report: 'Observed browser result', computer_execution: {
      ...execution, status: 'completed', verified_success: true,
      jobs: [{ ...job, status: 'done', result: { completed: true }, receipt: { contract: 'firbo-execution-receipt/v1', job_id: job.job_id,
        device_id: job.device_id, kind: job.kind, ok: true, report_sha256: 'a'.repeat(64), finished_at: '2026-10-09T14:00:00Z' } }],
    } };
    const terminal = page([{ ...task, status: 'completed', result }]);
    expect(text(terminal)).not.toContain('run.worker.pending'); expect(text(terminal)).not.toContain('run.pending');
    expect(elements(terminal).some(element => element.type === 'button' && text(element) === 'office.run')).toBe(false);
    expect(elements(terminal).find(element => element.type === ComputerExecutionView)!.props.execution).toMatchObject({
      status: 'completed', verified_success: true, jobs: [{ job_id: job.job_id, status: 'done', receipt: { ok: true } }],
    });
    expect(api.runTask).toHaveBeenCalledOnce();
  });
  it('does not refresh another company employee with a late worker acknowledgement', async () => {
    let finish!: (outcome: unknown) => void;
    api.runTask.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const tree = AgentDetail({ orgId: 'org-a', agent, tasks: [task], canSeeUsage: false, canRun: true, onChanged: api.changed });
    elements(tree).find(element => element.type === 'button' && text(element) === 'office.run')!.props.onClick!();
    fixture.index = 0; fixture.refIndex = 0;
    AgentDetail({ orgId: 'org-b', agent: { ...agent, id: 'agent-b' }, tasks: [], canSeeUsage: false, canRun: true, onChanged: api.changed });
    finish({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    await Promise.resolve(); await Promise.resolve();
    expect(notices.message).not.toHaveBeenCalled(); expect(notices.success).not.toHaveBeenCalled(); expect(notices.error).not.toHaveBeenCalled();
    expect(api.changed).not.toHaveBeenCalled();
  });
});
