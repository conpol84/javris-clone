import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LANGUAGES } from '../../i18n/core';
import { taskActionLabels } from './task-action-labels';

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('./client', () => ({ requireClient: () => ({ rpc }) }));
import { manageTask, taskActionErrorCode, taskNeedsReconciliation } from './task-actions';

const input = { orgId: 'org-a', taskId: 'task-a', expectedStatus: 'completed', action: 'delete' } as const;
const receipt = { id: input.taskId, organization_id: input.orgId, action: input.action, status: input.expectedStatus };
beforeEach(() => rpc.mockReset());

describe('task lifecycle affected-row confirmation', () => {
  it('scopes the server action to company, task and observed status', async () => {
    rpc.mockResolvedValue({ data: receipt, error: null });
    await expect(manageTask(input)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith('manage_task', { p_org: 'org-a', p_task: 'task-a', p_expected_status: 'completed', p_action: 'delete', p_status: null });
  });
  it.each([null, {}, { ...receipt, id: 'other' }, { ...receipt, organization_id: 'org-b' }, { ...receipt, action: 'cancel' }, { ...receipt, status: 'running' }])('never reports success for a missing or mismatched affected row (%j)', async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(manageTask(input)).rejects.toMatchObject({ code: 'changed' });
  });
  it('allows removal of a pending task only through the atomic cancel-and-remove RPC', async () => {
    rpc.mockResolvedValue({ data: { ...receipt, status: 'cancelled' }, error: null });
    await expect(manageTask({ ...input, expectedStatus: 'pending' })).resolves.toBeUndefined();
    expect(rpc.mock.calls[0][1].p_expected_status).toBe('pending');
  });
  it('confirms a cancellation separately from removal', async () => {
    rpc.mockResolvedValue({ data: { ...receipt, action: 'cancel', status: 'cancelled' }, error: null });
    await expect(manageTask({ ...input, expectedStatus: 'awaiting_approval', action: 'cancel' })).resolves.toBeUndefined();
  });
  it('confirms recovery only when the backend has blocked the task for reconciliation', async () => {
    rpc.mockResolvedValue({ data: { ...receipt, action: 'recover', status: 'blocked', reconcile_required: true }, error: null });
    await expect(manageTask({ ...input, expectedStatus: 'running', action: 'recover' })).resolves.toBeUndefined();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_expected_status: 'running', p_action: 'recover' });
  });
  it.each([false, undefined])('rejects a recovery without the reconciliation barrier (%j)', async (reconcile_required) => {
    rpc.mockResolvedValue({ data: { ...receipt, action: 'recover', status: 'blocked', reconcile_required }, error: null });
    await expect(manageTask({ ...input, expectedStatus: 'running', action: 'recover' })).rejects.toMatchObject({ code: 'changed' });
  });
  it('does not attempt to recover a non-running task', async () => {
    await expect(manageTask({ ...input, action: 'recover' })).rejects.toMatchObject({ code: 'changed' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('never attempts to cancel/remove a running model or command', async () => {
    await expect(manageTask({ ...input, expectedStatus: 'running' })).rejects.toMatchObject({ code: 'in_progress' });
    await expect(manageTask({ ...input, expectedStatus: 'running', action: 'cancel' })).rejects.toMatchObject({ code: 'in_progress' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(['running', 'awaiting_approval', 'cancelled'] as const)('rejects synthetic manual status %s', async (status) => {
    await expect(manageTask({ ...input, action: 'set_status', status })).rejects.toMatchObject({ code: 'failed' });
    expect(rpc).not.toHaveBeenCalled();
  });
  it('confirms the actual resulting status for a manual update', async () => {
    rpc.mockResolvedValue({ data: { ...receipt, action: 'set_status', status: 'blocked' }, error: null });
    await expect(manageTask({ ...input, action: 'set_status', status: 'blocked' })).resolves.toBeUndefined();
  });
  it('has no unsafe REST fallback when the RPC is not published yet', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'Could not find the function public.manage_task in the schema cache' } });
    await expect(manageTask(input)).rejects.toMatchObject({ code: 'unavailable' });
    expect(rpc).toHaveBeenCalledOnce();
  });
  it.each([['task_in_progress', 'in_progress'], ['task_not_stalled', 'not_stalled'], ['task_active_jobs', 'in_progress'], ['task_active_workflow', 'in_progress'], ['task_changed', 'changed'], ['task_not_executable', 'changed'], ['task_has_dependents', 'dependents'], ['forbidden', 'forbidden'], ['database unavailable', 'failed']])('surfaces %s as %s without false success', async (message, code) => {
    rpc.mockResolvedValue({ data: null, error: { message } });
    await expect(manageTask(input)).rejects.toMatchObject({ code });
    expect(taskActionErrorCode({ message })).toBe(code);
  });
});

describe('task action labels', () => {
  it.each(LANGUAGES)('covers confirmations and failure messages in $code', ({ code }) => {
    expect(Object.keys(taskActionLabels[code]).sort()).toEqual(Object.keys(taskActionLabels.en).sort());
    expect(Object.values(taskActionLabels[code]).every((value) => value.trim().length > 0)).toBe(true);
  });
});

describe('task execution reconciliation', () => {
  it('keeps a recovered task blocked from retries without hiding its report', () => {
    const result = { report: 'Existing evidence', reconcile_required: true };
    expect(taskNeedsReconciliation({ result })).toBe(true);
    expect(result.report).toBe('Existing evidence');
  });
  it.each([null, undefined, {}, { report: 'Completed' }])('allows ordinary results without a reconciliation barrier (%j)', (result) => {
    expect(taskNeedsReconciliation({ result })).toBe(false);
  });
});
