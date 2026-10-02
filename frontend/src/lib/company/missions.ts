import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';
import { RunError, runTask } from './runner';
import type { TaskResult, TaskStatus } from './types';

export interface MissionRow {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  created_at: string;
  result: TaskResult | null;
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

const MISSION_COLS = 'id, title, description, status, created_at, result';

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

export async function listSteps(missionId: string): Promise<StepRow[]> {
  const { data, error } = await requireClient()
    .from('tasks')
    .select('id, title, description, status, assigned_agent_id, created_at, result')
    .eq('parent_task_id', missionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as StepRow[];
}

export async function getMission(id: string): Promise<MissionRow | null> {
  const { data, error } = await requireClient().from('tasks').select(MISSION_COLS).eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as unknown as MissionRow | null;
}

async function call(action: 'plan' | 'synthesize', missionId: string, lang: string): Promise<void> {
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

/** What the team has produced so far, handed to the next employee as context (it is wrapped as untrusted data by the runner). */
function teamContext(done: StepRow[]): string {
  return done
    .filter((s) => s.result?.report || s.result?.summary)
    .map((s, i) => `Step ${i + 1} (${s.title}): ${String(s.result?.summary || s.result?.report || '').slice(0, 700)}`)
    .join('\n');
}

export interface MissionProgress {
  phase: 'planning' | 'working' | 'reporting' | 'done';
  steps: StepRow[];
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
): Promise<void> {
  const db = requireClient();
  if (mission.status === 'pending') {
    onProgress({ phase: 'planning', steps: [] });
    await planMission(mission.id, lang);
  }
  let steps = await listSteps(mission.id);
  onProgress({ phase: 'working', steps });
  for (const first of steps) {
    if (shouldStop()) return;
    steps = await listSteps(mission.id);
    const step = steps.find((s) => s.id === first.id);
    if (!step || !['pending', 'failed', 'blocked'].includes(step.status)) continue;
    const prior = teamContext(steps.filter((s) => s.created_at < step.created_at && s.status !== 'pending'));
    if (prior) {
      const base = (step.description ?? '').split('\n\nResults from teammates so far:')[0];
      await db.from('tasks').update({ description: `${base}\n\nResults from teammates so far:\n${prior}`.slice(0, 5000) }).eq('id', step.id);
    }
    onProgress({ phase: 'working', steps: steps.map((s) => (s.id === step.id ? { ...s, status: 'running' } : s)) });
    try {
      await runTask(step.id, lang);
    } catch (err) {
      // A missing model, budget or permission stops the whole mission; other failures only fail this step.
      if (err instanceof RunError && ['not_configured', 'budget_exceeded', 'forbidden', 'rate_limited'].includes(err.code)) throw err;
    }
    onProgress({ phase: 'working', steps: await listSteps(mission.id) });
  }
  if (shouldStop()) return;
  onProgress({ phase: 'reporting', steps: await listSteps(mission.id) });
  await synthesizeMission(mission.id, lang);
  onProgress({ phase: 'done', steps: await listSteps(mission.id) });
}
