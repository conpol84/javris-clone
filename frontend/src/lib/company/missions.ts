import { cleanTaskResult } from './taskResult';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';
import { computerExecutionOf, refreshComputerOutcome, RunError, runTask, type RunOutcome } from './runner';
import type { TaskResult, TaskStatus } from './types';

export interface MissionRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: string;
  result: TaskResult | null;
  /** `{ meeting: true, participants }` for a meeting the CEO chairs. */
  metadata?: Record<string, unknown> | null;
}

export interface StepRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  assigned_agent_id: string | null;
  created_at: string;
  result: TaskResult | null;
}

const MISSION_COLS = 'id, title, description, status, created_at, result, metadata';

export async function listMissions(orgId: string): Promise<MissionRow[]> {
  const { data, error } = await requireClient()
    .from('tasks')
    .select(MISSION_COLS)
    .eq('organization_id', orgId)
    .eq('kind', 'mission')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as MissionRow[];
}

export async function createMission(orgId: string, userId: string, goal: string, details: string): Promise<MissionRow> {
  const { data, error } = await requireClient()
    .from('tasks')
    .insert({ organization_id: orgId, created_by: userId, kind: 'mission', title: goal.trim().slice(0, 160), description: details.trim() || null, priority: 'high' })
    .select(MISSION_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as MissionRow;
}

/** True for a meeting (a mission the CEO chairs with invited employees) rather than a step-by-step mission. */
export const isMeeting = (m: Pick<MissionRow, 'metadata'> | null | undefined) => m?.metadata?.meeting === true;

/** A meeting: the topic, the agenda and up to five invited employees (none: the CEO invites the right ones). */
export async function createMeeting(orgId: string, userId: string, topic: string, agenda: string, participants: string[]): Promise<MissionRow> {
  const { data, error } = await requireClient()
    .from('tasks')
    .insert({ organization_id: orgId, created_by: userId, kind: 'mission', title: topic.trim().slice(0, 160), description: agenda.trim() || null, priority: 'high',
      metadata: { meeting: true, participants: participants.slice(0, 5) } })
    .select(MISSION_COLS)
    .single();
  if (error) throw new Error(error.message);
  return data as unknown as MissionRow;
}

export async function listSteps(missionId: string, orgId?: string): Promise<StepRow[]> {
  let query = requireClient()
    .from('tasks')
    .select('id, title, description, status, assigned_agent_id, created_at, result')
    .eq('parent_task_id', missionId);
  if (orgId) query = query.eq('organization_id', orgId);
  const { data, error } = await query.order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as StepRow[]).map((s) => (s.result ? { ...s, result: cleanTaskResult(s.result) } : s));
}

export async function getMission(id: string, orgId?: string): Promise<MissionRow | null> {
  let query = requireClient().from('tasks').select(MISSION_COLS).eq('id', id);
  if (orgId) query = query.eq('organization_id', orgId);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as MissionRow | null;
}

async function call(action: 'plan' | 'synthesize' | 'meet', missionId: string, lang: string): Promise<void> {
  const { error } = await requireClient().functions.invoke('mission-runner', { body: { action, mission_id: missionId, lang } });
  if (error) {
    let code: RunError['code'] = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try {
        const b = await error.context.json();
        if (['not_configured', 'budget_exceeded', 'rate_limited', 'no_agent', 'not_runnable', 'forbidden', 'model_error'].includes(b?.error)) code = b.error;
      } catch {
        /* keep unknown */
      }
    }
    throw new RunError(code);
  }
}

export const planMission = (id: string, lang: string) => call('plan', id, lang);
export const synthesizeMission = (id: string, lang: string) => call('synthesize', id, lang);
/** Holds the meeting on the server: every invited employee speaks, the CEO writes the minutes and turns the action items into tasks. */
export const holdMeeting = (id: string, lang: string) => call('meet', id, lang);

/** What the team has produced so far, handed to the next employee as context (it is wrapped as untrusted data by the runner). */
function teamContext(done: StepRow[]): string {
  return done
    .filter((s) => !missionStepWaiting(s) && s.status !== 'pending')
    .filter((s) => s.result?.report || s.result?.summary)
    .map((s, i) => `Step ${i + 1} (${s.title}): ${String(s.result?.summary || s.result?.report || '').slice(0, 700)}`)
    .join('\n');
}

export interface MissionProgress {
  phase: 'planning' | 'working' | 'waiting' | 'reporting' | 'meeting' | 'done';
  steps: StepRow[];
  waiting?: 'running' | 'awaiting_approval';
  acknowledgement?: { stepId: string; outcome: RunOutcome };
}

/** A queued acknowledgement is not teammate output or permission to run a successor. */
export function missionStepWaiting(step: StepRow, acknowledged?: RunOutcome): boolean {
  if (step.status === 'running' || step.status === 'awaiting_approval') return true;
  const execution = computerExecutionOf(step.result);
  const marker = (step.result as (TaskResult & { computer_execution?: unknown }) | null)?.computer_execution;
  if (marker !== undefined && (!execution || execution.status === 'pending' || execution.status === 'unknown')) return true;
  if (acknowledged && step.status === 'pending') return true;
  if (acknowledged?.computer_execution) {
    const reconciled = refreshComputerOutcome(acknowledged, step.result);
    if (reconciled === acknowledged || reconciled.pending || reconciled.status === 'running' || reconciled.status === 'awaiting_approval') return true;
  }
  return false;
}

/**
 * Drives a mission end to end from the browser: plan, run each step in order (each employee sees the earlier results),
 * then let the CEO write the final report. Keep the page open while it runs.
 */
export async function runMission(
  mission: MissionRow,
  lang: string,
  onProgress: (p: MissionProgress) => void,
  shouldStop: () => boolean,
  knownOutcomes: Readonly<Record<string, RunOutcome>> = {},
  orgId?: string,
): Promise<void> {
  if (shouldStop()) return;
  const db = requireClient();
  const acknowledged = { ...knownOutcomes };
  const waiting = (steps: StepRow[], receipt?: MissionProgress['acknowledgement']) => {
    const step = steps.find(s => missionStepWaiting(s, acknowledged[s.id]));
    if (!step) return false;
    onProgress({ phase: 'waiting', steps, waiting: step.status === 'awaiting_approval' || acknowledged[step.id]?.status === 'awaiting_approval' ? 'awaiting_approval' : 'running', ...(receipt ? { acknowledgement: receipt } : {}) });
    return true;
  };
  if (isMeeting(mission)) {
    onProgress({ phase: 'meeting', steps: [] });
    if (mission.status === 'pending') await holdMeeting(mission.id, lang);
    if (shouldStop()) return;
    const steps = await listSteps(mission.id, orgId);
    if (!shouldStop()) onProgress({ phase: 'done', steps });
    return;
  }
  if (mission.status === 'pending') {
    onProgress({ phase: 'planning', steps: [] });
    await planMission(mission.id, lang);
    if (shouldStop()) return;
  }
  let steps = await listSteps(mission.id, orgId);
  if (shouldStop() || waiting(steps)) return;
  onProgress({ phase: 'working', steps });
  for (const first of steps) {
    if (shouldStop()) return;
    steps = await listSteps(mission.id, orgId);
    if (shouldStop() || waiting(steps)) return;
    const step = steps.find((s) => s.id === first.id);
    if (!step || !['pending', 'failed', 'blocked'].includes(step.status)) continue;
    const prior = teamContext(steps.filter((s) => s.created_at < step.created_at && s.status !== 'pending'));
    if (prior) {
      const base = (step.description ?? '').split('\n\nResults from teammates so far:')[0];
      let update = db.from('tasks').update({ description: `${base}\n\nResults from teammates so far:\n${prior}`.slice(0, 5000) }).eq('id', step.id);
      if (orgId) update = update.eq('organization_id', orgId);
      await update;
      if (shouldStop()) return;
    }
    onProgress({ phase: 'working', steps: steps.map((s) => (s.id === step.id ? { ...s, status: 'running' } : s)) });
    let outcome: RunOutcome | undefined;
    try {
      outcome = await runTask(step.id, lang);
    } catch (err) {
      // A missing model, budget or permission stops the whole mission; other failures only fail this step.
      if (err instanceof RunError && ['not_configured', 'budget_exceeded', 'forbidden', 'rate_limited'].includes(err.code)) throw err;
    }
    if (shouldStop()) return;
    if (outcome) acknowledged[step.id] = outcome;
    steps = await listSteps(mission.id, orgId);
    if (shouldStop()) return;
    const receipt = outcome ? { stepId: step.id, outcome } : undefined;
    if (outcome && (outcome.status === 'running' || outcome.status === 'awaiting_approval' || outcome.pending || ['pending', 'unknown'].includes(outcome.computer_execution?.status ?? ''))) {
      onProgress({ phase: 'waiting', steps, waiting: outcome.status === 'awaiting_approval' ? 'awaiting_approval' : 'running', acknowledgement: receipt });
      return;
    }
    if (waiting(steps, receipt)) return;
    // Even a completed HTTP response must be reconciled with its persisted task.
    const fresh = steps.find(s => s.id === step.id);
    if (!fresh || fresh.status === 'pending') {
      onProgress({ phase: 'waiting', steps, waiting: 'running', ...(receipt ? { acknowledgement: receipt } : {}) });
      return;
    }
    onProgress({ phase: 'working', steps, ...(receipt ? { acknowledgement: receipt } : {}) });
  }
  if (shouldStop()) return;
  steps = await listSteps(mission.id, orgId);
  if (shouldStop() || waiting(steps)) return;
  if (steps.some(s => s.status === 'pending')) { onProgress({ phase: 'waiting', steps, waiting: 'running' }); return; }
  onProgress({ phase: 'reporting', steps });
  await synthesizeMission(mission.id, lang);
  if (shouldStop()) return;
  steps = await listSteps(mission.id, orgId);
  if (!shouldStop()) onProgress({ phase: 'done', steps });
}
