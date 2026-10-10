import type { TKey } from '../../i18n/locales/en';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type RunErrorCode =
  | 'not_configured'
  | 'budget_exceeded'
  | 'rate_limited'
  | 'plan_limit'
  | 'agent_disabled'
  | 'no_agent'
  | 'not_runnable'
  | 'forbidden'
  | 'model_error'
  | 'too_long'
  | 'unknown';

export class RunError extends Error {
  constructor(public code: RunErrorCode, public reason?: string) {
    super(code);
  }
}

/** Customer text for a failed run; the server's short reason code (a-z, 0-9, _) is appended to ease support. */
export function runErrorText(t: (key: TKey) => string, err: unknown): string {
  const code = err instanceof RunError ? err.code : 'unknown';
  const base = t(`run.err.${code}` as TKey);
  return err instanceof RunError && err.reason ? `${base} [${err.reason}]` : base;
}

export interface ComputerWorkJob {
  job_id: string;
  request_id?: string;
  device_id: string;
  device_name: string;
  kind: string;
  status: 'queued' | 'running' | 'unknown' | 'done' | 'error' | 'cancelled';
  summary?: string;
  receipt?: { report_sha256: string; ok: boolean; finished_at?: string };
}

export interface ComputerExecution {
  contract: 'firbo-worker-execution/v1';
  status: 'pending' | 'unknown' | 'completed' | 'failed' | 'blocked';
  verified_success: boolean;
  jobs: ComputerWorkJob[];
}

export interface RunOutcome {
  status: 'completed' | 'awaiting_approval' | 'running' | 'blocked' | 'failed';
  queued: number;
  pending: boolean;
  computer_execution?: ComputerExecution;
}

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** Display only bounded, correlated job/receipt metadata. Model prose is never a receipt. */
export function computerExecutionOf(result: unknown): ComputerExecution | null {
  const marker = record(record(result)?.computer_execution);
  if (marker?.contract !== 'firbo-worker-execution/v1'
    || typeof marker.status !== 'string' || !['pending', 'unknown', 'completed', 'failed', 'blocked'].includes(marker.status)
    || !Array.isArray(marker.jobs) || marker.jobs.length < 1 || marker.jobs.length > 10) return null;
  const jobs: ComputerWorkJob[] = [];
  for (const value of marker.jobs) {
    const job = record(value);
    if (!job || typeof job.job_id !== 'string' || !UUID.test(job.job_id)
      || typeof job.device_id !== 'string' || !UUID.test(job.device_id)
      || typeof job.kind !== 'string' || !/^[a-z_]{1,40}$/.test(job.kind)
      || typeof job.status !== 'string' || !['queued', 'running', 'unknown', 'done', 'error', 'cancelled'].includes(job.status)
      || jobs.some(prior => prior.job_id === job.job_id)
      || (job.request_id !== undefined && job.request_id !== job.job_id)) return null;
    const receipt = record(job.receipt);
    if (job.receipt != null && (!receipt || receipt.contract !== 'firbo-execution-receipt/v1'
      || !['done', 'error', 'cancelled'].includes(String(job.status))
      || receipt.job_id !== job.job_id || receipt.device_id !== job.device_id || receipt.kind !== job.kind
      || typeof receipt.report_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(receipt.report_sha256)
      || typeof receipt.ok !== 'boolean' || (job.status === 'done' && receipt.ok !== true)
      || (job.status === 'error' && receipt.ok !== false))) return null;
    const observed = record(job.result);
    jobs.push({ job_id: job.job_id, device_id: job.device_id,
      device_name: typeof job.device_name === 'string' ? job.device_name.slice(0, 200) : job.device_id,
      kind: job.kind, status: job.status as ComputerWorkJob['status'],
      ...(typeof job.request_id === 'string' ? { request_id: job.request_id } : {}),
      ...(typeof observed?.summary === 'string' ? { summary: observed.summary.slice(0, 2000) } : {}),
      ...(receipt ? { receipt: { report_sha256: receipt.report_sha256 as string, ok: receipt.ok as boolean,
        ...(typeof receipt.finished_at === 'string' ? { finished_at: receipt.finished_at.slice(0, 50) } : {}) } } : {}) });
  }
  if (['failed', 'blocked'].includes(marker.status)
    && jobs.some(job => !['done', 'error', 'cancelled'].includes(job.status))) return null;
  const verified = marker.status === 'completed' && marker.verified_success === true
    && jobs.every(job => job.status === 'done' && job.receipt?.ok === true)
    && marker.jobs.every(value => {
      const job = record(value)!;
      const observed = record(job.result);
      return !['desktop_task', 'browser_task'].includes(String(job.kind)) || observed?.completed === true && observed.blocked !== true;
    });
  if (marker.status === 'completed' && !verified) return null;
  return { contract: marker.contract, status: marker.status as ComputerExecution['status'], verified_success: verified, jobs };
}

type RunTranslate = (key: TKey, vars?: Record<string, string | number>) => string;

/** Upgrade an acknowledgement only from readback of those same worker jobs. */
export function refreshComputerOutcome(outcome: RunOutcome, result: unknown): RunOutcome {
  const latest = computerExecutionOf(result);
  const original = outcome.computer_execution;
  if (!latest || !original || latest.jobs.length !== original.jobs.length
    || latest.jobs.some(job => !original.jobs.some(prior => prior.job_id === job.job_id && prior.device_id === job.device_id && prior.kind === job.kind))) return outcome;
  const status = latest.status === 'pending' || latest.status === 'unknown' ? 'running' : latest.status;
  return { status, queued: 0, pending: status === 'running', computer_execution: latest };
}

/** A pending worker or approval is an acknowledgement, never a completed task. */
export function runOutcomeNotice(t: RunTranslate, outcome: RunOutcome): { tone: 'success' | 'message' | 'error'; text: string } {
  if (outcome.status === 'running') {
    const job = outcome.computer_execution?.jobs[0];
    return { tone: 'message', text: job
      ? `${t('run.worker.pending', { worker: job.device_name })} ${t('run.worker.job', { id: job.job_id })}`
      : t('run.pending') };
  }
  if (outcome.status === 'failed' || outcome.status === 'blocked') return { tone: 'error', text: t(`status.${outcome.status}`) };
  if (outcome.status === 'awaiting_approval' || outcome.queued > 0) return {
    tone: 'message', text: outcome.queued > 0 ? t('run.queued', { count: outcome.queued }) : t('status.awaiting_approval'),
  };
  return outcome.status === 'completed' ? { tone: 'success', text: t('run.completed') }
    : { tone: 'error', text: t('run.err.unknown') };
}

function runOutcome(data: unknown): RunOutcome {
  const value = record(data);
  if (!value || typeof value.status !== 'string' || !['completed', 'awaiting_approval', 'running', 'blocked', 'failed'].includes(value.status)
    || (value.queued !== undefined && (!Number.isSafeInteger(value.queued) || (value.queued as number) < 0))
    || (value.pending !== undefined && typeof value.pending !== 'boolean')
    || (value.pending === true && value.status !== 'running')) throw new RunError('unknown', 'invalid_run_outcome');
  const execution = computerExecutionOf(value);
  if (value.computer_execution !== undefined && !execution) throw new RunError('unknown', 'invalid_computer_receipt');
  if (execution && ((value.status === 'running' && !['pending', 'unknown'].includes(execution.status))
    || (['completed', 'failed', 'blocked'].includes(String(value.status)) && execution.status !== value.status))) throw new RunError('unknown', 'invalid_computer_status');
  if (value.status === 'completed' && execution && !execution.verified_success) throw new RunError('unknown', 'unverified_computer_result');
  return { status: value.status as RunOutcome['status'], queued: (value.queued as number | undefined) ?? 0,
    pending: value.status === 'running', ...(execution ? { computer_execution: execution } : {}) };
}

const KNOWN: RunErrorCode[] = ['not_configured', 'budget_exceeded', 'rate_limited', 'plan_limit', 'agent_disabled', 'no_agent', 'not_runnable', 'forbidden', 'model_error', 'too_long'];

/** Ask the agent-runner Edge Function to execute a task as its assigned agent. */
export async function runTask(taskId: string, lang: string): Promise<RunOutcome> {
  const { data, error } = await requireClient().functions.invoke('agent-runner', { body: { task_id: taskId, lang } });
  if (error) {
    let code: RunErrorCode = 'unknown';
    let reason: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (KNOWN.includes(body?.error)) code = body.error;
        if (typeof body?.reason === 'string' && /^[a-z0-9_]{1,60}$/.test(body.reason)) reason = body.reason;
      } catch {
        /* non-JSON failure: keep "unknown" */
      }
    }
    throw new RunError(code, reason);
  }
  return runOutcome(data);
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
  model?: string | null;
}

/** One chat turn with an AI employee through the agent-chat Edge Function. */
export async function sendChat(conversationId: string, message: string, lang: string, voice = false, signal?: AbortSignal, options?: { preferLocalBackup?: boolean }): Promise<{ user_message: ChatMessage; message: ChatMessage }> {
  const { data, error } = await requireClient().functions.invoke('agent-chat', { body: { conversation_id: conversationId, message, lang, request_id: crypto.randomUUID(), ...(voice ? { voice: true } : {}), ...(options?.preferLocalBackup === true ? { prefer_local_backup: true } : {}) }, signal });
  if (error) {
    let code: RunErrorCode = 'unknown';
    let reason: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (KNOWN.includes(body?.error)) code = body.error;
        if (typeof body?.reason === 'string' && /^[a-z0-9_]{1,60}$/.test(body.reason)) reason = body.reason;
      } catch {
        /* non-JSON failure: keep "unknown" */
      }
    }
    throw new RunError(code, reason);
  }
  return data as { user_message: ChatMessage; message: ChatMessage };
}
