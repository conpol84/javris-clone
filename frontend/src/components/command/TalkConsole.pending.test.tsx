import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({ org: 'org-a', index: 0, refIndex: 0, values: [] as unknown[], refs: [] as { current: unknown }[] }));
const api = vi.hoisted(() => ({ createTask: vi.fn(), runTask: vi.fn(), reload: vi.fn() }));
const notices = vi.hoisted(() => ({ success: vi.fn(), message: vi.fn(), error: vi.fn() }));
vi.mock('react', async original => ({ ...await original<typeof import('react')>(),
  useState: (initial: unknown) => { const i = fixture.index++; if (!(i in fixture.values)) fixture.values[i] = typeof initial === 'function' ? initial() : initial;
    return [fixture.values[i], (next: unknown) => { fixture.values[i] = typeof next === 'function' ? next(fixture.values[i]) : next; }]; },
  useRef: (initial: unknown) => fixture.refs[fixture.refIndex++] ??= { current: initial }, useEffect: () => undefined,
  useMemo: (callback: () => unknown) => callback(),
}));
vi.mock('../../lib/company/AuthProvider', () => ({ useCompanyAuth: () => ({ current: { organization: { id: fixture.org, name: 'Company A' }, role: 'owner' }, user: { id: 'owner-a' } }) }));
vi.mock('../../lib/company/data', () => ({ createTask: api.createTask }));
vi.mock('../../lib/company/runner', async original => ({ ...await original<typeof import('../../lib/company/runner')>(), runTask: api.runTask }));
vi.mock('../../lib/company/useOrgData', () => ({ useOrgData: () => ({ agents: [{ id: 'agent-a', enabled: true, name: 'CEO', type: 'ceo', slug: 'ceo' }], tasks: [], approvals: [], reload: api.reload }) }));
vi.mock('../../lib/company/useCeoSession', () => ({ useCeoSession: () => ({ ceo: { id: 'agent-a', name: 'CEO', type: 'ceo', slug: 'ceo' }, state: 'idle', lines: [], interim: '', voiceStatus: '', voiceLog: [], muted: false, handsFree: false, canTalk: false }) }));
vi.mock('../../lib/company/labels', () => ({ agentLabel: () => ({ name: 'CEO' }) }));
vi.mock('../../i18n/I18nProvider', () => ({ useI18n: () => ({ lang: 'en', t: (key: string, vars?: Record<string, unknown>) => vars ? `${key} ${JSON.stringify(vars)}` : key, fmt: { time: () => '' } }) }));
vi.mock('react-router', () => ({ useNavigate: () => vi.fn(), Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a> }));
vi.mock('sonner', () => ({ toast: notices }));
vi.mock('../voice/VoiceProfileControl', () => ({ VoiceProfileControl: () => null }));
vi.mock('../company/CeoActions', () => ({ CeoActions: () => null }));
import { TalkConsole } from './TalkConsole';
import { ComputerExecutionView } from '../company/ComputerExecutionView';

type Element = ReactElement<{ children?: ReactNode; role?: string; execution?: unknown; 'aria-label'?: string; onClick?: () => void;
  onChange?: (event: { target: { value: string } }) => void; onSubmit?: (event: { preventDefault: () => void }) => Promise<void> }>;
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
  fixture.index = 0; fixture.refIndex = 0;
  const outer = TalkConsole({ onClose: () => undefined });
  return typeof outer.type === 'function' ? (outer.type as (props: unknown) => ReactNode)(outer.props) : outer;
}
const execution = {
  contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: '11111111-1111-4111-8111-111111111111', request_id: '11111111-1111-4111-8111-111111111111',
    device_id: '22222222-2222-4222-8222-222222222222', device_name: 'Chosen Debian', kind: 'desktop_task', status: 'queued' }],
};
describe('Talk console employee command acknowledgement', () => {
  beforeEach(() => { vi.clearAllMocks(); fixture.org = 'org-a'; fixture.index = 0; fixture.refIndex = 0; fixture.values = []; fixture.refs = []; api.createTask.mockResolvedValue('task-a'); });
  it('shows the pending worker result after sending a command instead of silently dropping running202', async () => {
    api.runTask.mockResolvedValue({ status: 'running', queued: 0, pending: true, computer_execution: execution });
    elements(page()).find(element => element.props.role === 'tab' && text(element) === 'talk.tab.command')!.props.onClick!();
    elements(page()).find(element => element.type === 'textarea' && element.props['aria-label'] === 'cmd.placeholder')!.props.onChange!({ target: { value: 'Browse the approved company page' } });
    await elements(page()).find(element => element.type === 'form')!.props.onSubmit!({ preventDefault: vi.fn() });
    expect(notices.message).toHaveBeenCalledWith(expect.stringContaining('Chosen Debian'));
    expect(notices.message).toHaveBeenCalledWith(expect.stringContaining(execution.jobs[0].job_id));
    expect(notices.success).not.toHaveBeenCalledWith('run.completed'); expect(notices.error).not.toHaveBeenCalled();
    expect(api.createTask).toHaveBeenCalledOnce(); expect(api.runTask).toHaveBeenCalledExactlyOnceWith('task-a', 'en');
    expect(api.reload).toHaveBeenCalledOnce();
    const rendered = page();
    const pendingPanel = elements(rendered).find(element => element.props.role === 'status' && text(element).includes('run.worker.pending'));
    expect(pendingPanel).toBeDefined(); expect(text(pendingPanel)).toContain('Chosen Debian');
    expect(text(pendingPanel)).toContain(execution.jobs[0].job_id);
    expect(elements(pendingPanel).find(element => element.type === ComputerExecutionView)!.props.execution).toEqual(execution);
  });
  it('does not show or reload an old company worker acknowledgement after switching company', async () => {
    let finish!: (outcome: unknown) => void;
    api.runTask.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    elements(page()).find(element => element.props.role === 'tab' && text(element) === 'talk.tab.command')!.props.onClick!();
    elements(page()).find(element => element.type === 'textarea')!.props.onChange!({ target: { value: 'Browse the approved company page' } });
    const pending = elements(page()).find(element => element.type === 'form')!.props.onSubmit!({ preventDefault: vi.fn() });
    await vi.waitFor(() => expect(api.runTask).toHaveBeenCalledOnce());
    fixture.org = 'org-b'; page();
    finish({ status: 'running', queued: 0, pending: true, computer_execution: execution }); await pending;
    expect(notices.message).not.toHaveBeenCalled(); expect(notices.error).not.toHaveBeenCalled(); expect(api.reload).not.toHaveBeenCalled();
  });
});
