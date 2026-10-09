import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultI18n } from '../../i18n/I18nProvider';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ requireClient: () => ({ functions: { invoke } }) }));
import { computerExecutionOf, refreshComputerOutcome, RunError, runOutcomeNotice, runTask, type RunOutcome } from './runner';

const JOB = '11111111-1111-4111-8111-111111111111';
const DEVICE = '22222222-2222-4222-8222-222222222222';
const marker = () => ({ contract: 'firbo-worker-execution/v1', status: 'pending', verified_success: false,
  jobs: [{ job_id: JOB, request_id: JOB, device_id: DEVICE, device_name: 'Chosen Debian', kind: 'desktop_task', status: 'queued' }] });
const completed = () => ({ ...marker(), status: 'completed', verified_success: true,
  jobs: [{ ...marker().jobs[0], status: 'done', result: { completed: true, summary: 'Observed browser opened.' },
    receipt: { contract: 'firbo-execution-receipt/v1', job_id: JOB, device_id: DEVICE, kind: 'desktop_task', ok: true, report_sha256: 'a'.repeat(64) } }] });

beforeEach(() => vi.clearAllMocks());

describe('agent-runner acknowledgement contract', () => {
  it('keeps the real HTTP202 pending receipt and never announces completed', async () => {
    invoke.mockResolvedValue({ data: { status: 'running', pending: true, retry_safe: false, computer_execution: marker() }, error: null });
    const out = await runTask('task-1', 'en');
    expect(out).toMatchObject({ status: 'running', pending: true, queued: 0, computer_execution: { jobs: [{ job_id: JOB, device_id: DEVICE }] } });
    const notice = runOutcomeNotice(defaultI18n.t, out);
    expect(notice.tone).toBe('message');
    expect(notice.text).toContain('Chosen Debian');
    expect(notice.text).toContain(JOB);
    expect(notice.text).not.toContain('Done');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('agent-runner', { body: { task_id: 'task-1', lang: 'en' } });
  });

  it.each(['completed', 'awaiting_approval'] as const)('retains the existing %s result and approval count', async status => {
    invoke.mockResolvedValue({ data: { status, queued: status === 'completed' ? 0 : 2 }, error: null });
    const out = await runTask('task-1', 'en');
    expect(out).toMatchObject({ status, pending: false, queued: status === 'completed' ? 0 : 2 });
    const notice = runOutcomeNotice(defaultI18n.t, out);
    expect(notice.tone).toBe(status === 'completed' ? 'success' : 'message');
    expect(notice.text).toBe(status === 'completed' ? 'Done.' : 'Done — 2 actions are waiting for your approval in the Inbox.');
  });

  it('uses neutral pending copy if a running acknowledgement has no job metadata', async () => {
    invoke.mockResolvedValue({ data: { status: 'running', pending: true }, error: null });
    const out = await runTask('task-1', 'en');
    expect(runOutcomeNotice(defaultI18n.t, out)).toEqual({ tone: 'message', text: defaultI18n.t('run.pending') });
  });

  it.each(['blocked', 'failed'] as const)('never calls a %s task completed or awaiting approval', async status => {
    invoke.mockResolvedValue({ data: { status, queued: 2 }, error: null });
    const notice = runOutcomeNotice(defaultI18n.t, await runTask('task-1', 'en'));
    expect(notice).toEqual({ tone: 'error', text: defaultI18n.t(`status.${status}`) });
  });

  it('accepts completed computer work only with the correlated terminal receipt', async () => {
    invoke.mockResolvedValue({ data: { status: 'completed', computer_execution: completed() }, error: null });
    const out = await runTask('task-1', 'en');
    expect(out.computer_execution?.verified_success).toBe(true);
    expect(runOutcomeNotice(defaultI18n.t, out).tone).toBe('success');
  });

  it.each([null, {}, { status: 'unexpected' }, { status: ['completed'] }, { status: 'completed', pending: true }, { status: 'completed', queued: -1 },
    { status: 'completed', queued: 0, computer_execution: marker() }, { status: 'running', computer_execution: { ...marker(), jobs: [] } }])(
    'rejects malformed or unverified outcomes without a success receipt (%j)', async data => {
      invoke.mockResolvedValue({ data, error: null });
      await expect(runTask('task-1', 'en')).rejects.toBeInstanceOf(RunError);
    });
});

describe('computer receipt readback', () => {
  it('retains bounded display fields without exposing dispatch parameters or run claims', () => {
    const execution = computerExecutionOf({ computer_execution: { ...marker(), jobs: [{ ...marker().jobs[0], params: { secret: 'private' }, run_claim: 'claim' }] } });
    expect(execution?.jobs[0]).not.toHaveProperty('params');
    expect(execution?.jobs[0]).not.toHaveProperty('run_claim');
  });

  it('does not interpret a running envelope as completed even if its embedded marker says completed', async () => {
    invoke.mockResolvedValue({ data: { status: 'running', pending: true, computer_execution: completed() }, error: null });
    await expect(runTask('task-1', 'en')).rejects.toMatchObject({ reason: 'invalid_computer_status' });
  });

  it.each(['job_id', 'device_id', 'kind', 'report_sha256', 'ok'] as const)('does not label a mismatched terminal %s receipt verified', key => {
    const value = completed();
    const receipt = value.jobs[0].receipt as Record<string, unknown>;
    receipt[key] = key === 'ok' ? false : key === 'report_sha256' ? 'invalid' : 'mismatch';
    expect(computerExecutionOf({ computer_execution: value })).toBeNull();
  });

  it('does not accept prose or duplicated jobs as receipt evidence', () => {
    expect(computerExecutionOf({ report: 'The job completed', computer_execution: { ...marker(), jobs: [marker().jobs[0], marker().jobs[0]] } })).toBeNull();
    expect(computerExecutionOf({ computer_execution: { ...completed(), jobs: [{ ...marker().jobs[0], status: 'done' }] } })).toBeNull();
    expect(computerExecutionOf({ computer_execution: { ...marker(), status: ['pending'] } })).toBeNull();
    expect(computerExecutionOf({ computer_execution: { ...marker(), jobs: [{ ...marker().jobs[0], status: ['queued'] }] } })).toBeNull();
  });

  it('does not announce native completion from a terminal receipt when the observed job remains incomplete', () => {
    const result = completed(); result.jobs[0].result.completed = false;
    expect(computerExecutionOf({ computer_execution: result })).toBeNull();
  });

  it.each(['failed', 'blocked'])('cannot release a pending acknowledgement from a %s marker carrying unfinished jobs', status => {
    const out: RunOutcome = { status: 'running', pending: true, queued: 0, computer_execution: computerExecutionOf({ computer_execution: marker() })! };
    const result = { computer_execution: { ...marker(), status } };
    expect(computerExecutionOf(result)).toBeNull();
    expect(refreshComputerOutcome(out, result)).toBe(out);
  });

  it('replaces pending text after durable readback of the same terminal jobs', () => {
    const out: RunOutcome = { status: 'running', pending: true, queued: 0, computer_execution: computerExecutionOf({ computer_execution: marker() })! };
    const current = refreshComputerOutcome(out, { computer_execution: completed() });
    expect(current).toMatchObject({ status: 'completed', pending: false, computer_execution: { verified_success: true } });
    expect(runOutcomeNotice(defaultI18n.t, current).tone).toBe('success');
  });

  it('does not promote an old acknowledgement with another worker or job result', () => {
    const out: RunOutcome = { status: 'running', pending: true, queued: 0, computer_execution: computerExecutionOf({ computer_execution: marker() })! };
    const result = completed(); result.jobs[0].device_id = '33333333-3333-4333-8333-333333333333'; result.jobs[0].receipt.device_id = result.jobs[0].device_id;
    expect(refreshComputerOutcome(out, { computer_execution: result })).toBe(out);
    expect(refreshComputerOutcome(out, { report: 'Completed', computer_execution: marker() }).pending).toBe(true);
  });
});
