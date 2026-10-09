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

export interface RunOutcome {
  status: 'completed' | 'awaiting_approval';
  queued: number;
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
  return data as RunOutcome;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  created_at: string;
  model?: string | null;
}

/** One chat turn with an AI employee through the agent-chat Edge Function. */
export async function sendChat(conversationId: string, message: string, lang: string, voice = false, signal?: AbortSignal): Promise<{ user_message: ChatMessage; message: ChatMessage }> {
  const { data, error } = await requireClient().functions.invoke('agent-chat', { body: { conversation_id: conversationId, message, lang, request_id: crypto.randomUUID(), ...(voice ? { voice: true } : {}) }, signal });
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
