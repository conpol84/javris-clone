import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

export type RunErrorCode =
  | 'not_configured'
  | 'budget_exceeded'
  | 'rate_limited'
  | 'agent_disabled'
  | 'no_agent'
  | 'not_runnable'
  | 'forbidden'
  | 'model_error'
  | 'unknown';

export class RunError extends Error {
  constructor(public code: RunErrorCode) {
    super(code);
  }
}

export interface RunOutcome {
  status: 'completed' | 'awaiting_approval';
  queued: number;
}

const KNOWN: RunErrorCode[] = ['not_configured', 'budget_exceeded', 'rate_limited', 'agent_disabled', 'no_agent', 'not_runnable', 'forbidden', 'model_error'];

/** Ask the agent-runner Edge Function to execute a task as its assigned agent. */
export async function runTask(taskId: string, lang: string): Promise<RunOutcome> {
  const { data, error } = await requireClient().functions.invoke('agent-runner', { body: { task_id: taskId, lang } });
  if (error) {
    let code: RunErrorCode = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (KNOWN.includes(body?.error)) code = body.error;
      } catch {
        /* non-JSON failure: keep "unknown" */
      }
    }
    throw new RunError(code);
  }
  return data as RunOutcome;
}
