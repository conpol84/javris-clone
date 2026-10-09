import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ org: 'org-a', index: 0, refIndex: 0, values: [] as unknown[], refs: [] as { current: unknown }[],
  effects: [] as (() => void | (() => void))[] }));
const api = vi.hoisted(() => ({ createTask: vi.fn(), runTask: vi.fn(), listAgents: vi.fn(), listShifts: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = fixture.index++; if (!(i in fixture.values)) fixture.values[i] = typeof initial === 'function' ? initial() : initial;
    return [fixture.values[i], (next: unknown) => { fixture.values[i] = typeof next === 'function' ? next(fixture.values[i]) : next; }]; },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ??= { current: initial },
  useCallback: (callback: unknown) => callback, useMemo: (callback: () => unknown) => callback(),
  useEffect: (effect: () => void | (() => void)) => { fixture.effects.push(effect); },
}));
vi.mock('../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.org, name: 'Company A' }, role: 'owner' }, user: { id: 'owner-a' } }) }));
vi.mock('../lib/company/data', () => ({ createTask: api.createTask, listAgents: api.listAgents }));
vi.mock('../lib/company/runner', async original => ({ ...await original<typeof import('../lib/company/runner')>(), runTask: api.runTask }));
vi.mock('../lib/company/shifts', () => ({ listShifts: api.listShifts, createShift: vi.fn(), deleteShift: vi.fn(), setShiftEnabled: vi.fn() }));
vi.mock('../lib/company/labels', () => ({ agentLabel: () => ({ name: 'Employee A' }) }));
vi.mock('../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string, vars?: Record<string, unknown>) => vars ? `${key} ${JSON.stringify(vars)}` : key, fmt: { dateTime: () => '' } }) }));
vi.mock('sonner', () => ({ toast: notices }));
import { ShiftsPage } from './ShiftsPage';

type Element = ReactElement<{ children?: ReactNode; onClick?: () => void }>;
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
function page(): ReactNode {
  fixture.index = 0; fixture.refIndex = 0; fixture.effects = [];
  const outer = ShiftsPage();
  return typeof outer.type === 'function' ? (outer.type as (props: unknown) => ReactNode)(outer.props) : outer;
}
async function loadedPage() {
  page(); for (const effect of [...fixture.effects]) effect();
  await Promise.resolve(); await Promise.resolve();
  return page();
}
const execution = {
  contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: '11111111-1111-4111-8111-111111111111', request_id: '11111111-1111-4111-8111-111111111111',
    device_id: '22222222-2222-4222-8222-222222222222', device_name: 'Chosen Debian', kind: 'desktop_task', status: 'queued' }],
};
describe('scheduled employee manual run acknowledgement', () => {
  beforeEach(() => {
    vi.clearAllMocks(); fixture.org = 'org-a'; fixture.index = 0; fixture.refIndex = 0; fixture.values = []; fixture.refs = []; fixture.effects = [];
    api.listAgents.mockResolvedValue([{ id: 'agent-a', enabled: true, name: 'Employee A', type: 'custom', slug: 'employee-a' }]);
    api.listShifts.mockResolvedValue([{ id: 'shift-a', agent_id: 'agent-a', title: 'Browse company sources', instruction: 'Read the approved page', enabled: true, cadence: 'daily', hour: 8 }]);
    api.createTask.mockResolvedValue('task-a');
  });
  it('shows pending worker identity instead of completion when Run now returns running202', async () => {
    api.runTask.mockResolvedValue({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    const tree = await loadedPage();
    elements(tree).find(element => element.type === 'button' && text(element).includes('shift.runNow'))!.props.onClick!();
    await vi.waitFor(() => expect(notices.message).toHaveBeenCalled());
    expect(notices.message).toHaveBeenCalledWith(expect.stringContaining('Chosen Debian'));
    expect(notices.message).toHaveBeenCalledWith(expect.stringContaining(execution.jobs[0].job_id));
    expect(notices.success).not.toHaveBeenCalledWith('run.completed'); expect(notices.error).not.toHaveBeenCalled();
    expect(api.createTask).toHaveBeenCalledOnce(); expect(api.runTask).toHaveBeenCalledExactlyOnceWith('task-a', 'en');
  });
  it('does not announce the old company worker result after a company switch', async () => {
    let finish!: (outcome: unknown) => void;
    api.runTask.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const tree = await loadedPage();
    elements(tree).find(element => element.type === 'button' && text(element).includes('shift.runNow'))!.props.onClick!();
    await vi.waitFor(() => expect(api.runTask).toHaveBeenCalledOnce());
    fixture.org = 'org-b'; page();
    finish({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    await Promise.resolve(); await Promise.resolve();
    expect(notices.message).not.toHaveBeenCalled(); expect(notices.success).not.toHaveBeenCalled(); expect(notices.error).not.toHaveBeenCalled();
  });
});
