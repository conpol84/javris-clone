import { requireClient } from './client';
import type { TaskRow, TaskStatus } from './types';

export const REMOVABLE_TASK_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];
export const CANCELLABLE_TASK_STATUSES: readonly TaskStatus[] = ['pending', 'blocked', 'awaiting_approval'];
export function taskNeedsReconciliation(task: Pick<TaskRow, 'result'>): boolean {
  return (task.result as (TaskRow['result'] & { reconcile_required?: boolean }))?.reconcile_required === true;
}
export type TaskAction = 'cancel' | 'delete' | 'set_status' | 'recover';
export type TaskActionErrorCode = 'in_progress' | 'not_stalled' | 'cancel_first' | 'changed' | 'dependents' | 'forbidden' | 'unavailable' | 'failed';

export class TaskActionError extends Error {
  constructor(readonly code: TaskActionErrorCode) {
    super(code);
    this.name = 'TaskActionError';
  }
}

export function taskActionErrorCode(error: unknown): TaskActionErrorCode {
  if (error instanceof TaskActionError) return error.code;
  const detail = String((error as { message?: string })?.message ?? '');
  if (/task_not_stalled/.test(detail)) return 'not_stalled';
  if (/task_in_progress|task_active_jobs|task_active_workflow/.test(detail)) return 'in_progress';
  if (/task_cancel_first|task_pending_approvals/.test(detail)) return 'cancel_first';
  if (/task_changed|task_not_found|task_not_executable|task_reconciliation_required|task_server_status|state_conflict/.test(detail)) return 'changed';
  if (/task_has_dependents/.test(detail)) return 'dependents';
  if (/forbidden|permission denied/.test(detail)) return 'forbidden';
  if (/function .*manage_task|Could not find.*manage_task/.test(detail)) return 'unavailable';
  return 'failed';
}

/** A locked, tenant-scoped RPC checks execution state and returns the affected row.
 * No REST fallback: an older backend must fail visibly rather than bypass safety.
 */
export async function manageTask(input: {
  orgId: string;
  taskId: string;
  expectedStatus: TaskStatus;
  action: TaskAction;
  status?: TaskStatus;
}): Promise<void> {
  if (!input.orgId || !input.taskId) throw new TaskActionError('changed');
  if (input.expectedStatus === 'running' && input.action !== 'recover') throw new TaskActionError('in_progress');
  if (input.action === 'recover' && input.expectedStatus !== 'running') throw new TaskActionError('changed');
  if (input.action === 'cancel' && !CANCELLABLE_TASK_STATUSES.includes(input.expectedStatus)) throw new TaskActionError('changed');
  if (input.action === 'set_status' && (!input.status || input.status === 'running' || input.status === 'awaiting_approval' || input.status === 'cancelled')) throw new TaskActionError('failed');
  const { data, error } = await requireClient().rpc('manage_task', {
    p_org: input.orgId,
    p_task: input.taskId,
    p_expected_status: input.expectedStatus,
    p_action: input.action,
    p_status: input.action === 'set_status' ? input.status : null,
  });
  if (error) throw new TaskActionError(taskActionErrorCode(error));
  const expected = input.action === 'recover' ? 'blocked' : input.action === 'set_status' ? input.status : input.action === 'cancel' || !REMOVABLE_TASK_STATUSES.includes(input.expectedStatus) ? 'cancelled' : input.expectedStatus;
  if (!data || data.id !== input.taskId || data.organization_id !== input.orgId || data.action !== input.action || data.status !== expected || (input.action === 'recover' && data.reconcile_required !== true)) {
    throw new TaskActionError('changed');
  }
}
