// Data for the company knowledge base, skills, workflows and report feedback.
// Reads go straight to the tables (row-level security keeps each company apart); work that needs the server
// (reading a link or an app, starting a workflow, the webhook link) goes through the edge functions.
import { FunctionsHttpError } from '@supabase/supabase-js';
import { requireClient } from './client';

/** Calls an edge function and turns its JSON error into an Error whose message is the error code. */
async function fn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireClient().functions.invoke(name, { body });
  if (error) {
    let code = 'unknown';
    if (error instanceof FunctionsHttpError) {
      try { code = String((await error.context.json())?.error ?? code); } catch { /* keep unknown */ }
    }
    throw new Error(code);
  }
  return data as T;
}

// ------------------------------------------------------------------ knowledge
export interface KnowledgeSource {
  id: string;
  name: string;
  type: string;
  url: string | null;
  status: string;
  item_count: number | null;
  last_synced_at: string | null;
  last_error: string | null;
  integration_id: string | null;
  created_at: string;
}
export interface KnowledgeHit { title: string; url: string | null; content: string; score: number }

/** Connected apps the knowledge base can read (read-only sign-ins and token apps). */
export const READABLE_APPS = ['notion', 'github', 'gdrive_read', 'gmail_read', 'gcal_read', 'outlook_read'] as const;

export async function listKnowledge(orgId: string): Promise<KnowledgeSource[]> {
  const { data, error } = await requireClient().from('knowledge_sources')
    .select('id, name, type, url, status, item_count, last_synced_at, last_error, integration_id, created_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as KnowledgeSource[];
}
export const addKnowledgeText = (orgId: string, name: string, text: string, upload = false) =>
  fn<{ source_id: string }>('knowledge', { action: 'add_text', organization_id: orgId, name, text, kind: upload ? 'upload' : 'text' });
export const addKnowledgeUrl = (orgId: string, url: string, name = '') =>
  fn<{ source_id: string }>('knowledge', { action: 'add_url', organization_id: orgId, url, name });
export const addKnowledgeApp = (orgId: string, integrationId: string) =>
  fn<{ source_id: string }>('knowledge', { action: 'add_app', organization_id: orgId, integration_id: integrationId });
export const syncKnowledge = (sourceId: string) => fn<unknown>('knowledge', { action: 'sync', source_id: sourceId });
export const deleteKnowledge = (sourceId: string) => fn<{ ok: true }>('knowledge', { action: 'delete', source_id: sourceId });
export const searchKnowledge = (orgId: string, query: string) =>
  fn<{ results: KnowledgeHit[]; semantic: boolean }>('knowledge', { action: 'search', organization_id: orgId, query });

// ------------------------------------------------------------------ skills
export interface SkillRow {
  id: string;
  agent_id: string | null;
  slug: string | null;
  name: string;
  description: string | null;
  instructions: string;
  source: string | null;
  enabled: boolean;
  created_at: string;
}
export async function listSkills(orgId: string): Promise<SkillRow[]> {
  const { data, error } = await requireClient().from('skills').select('id, agent_id, slug, name, description, instructions, source, enabled, created_at')
    .eq('organization_id', orgId).order('created_at');
  if (error) throw error;
  return (data ?? []) as SkillRow[];
}
export async function addSkill(orgId: string, userId: string, s: { name: string; instructions: string; description?: string; slug?: string; agentId?: string | null; source?: string }) {
  const { error } = await requireClient().from('skills').insert({
    organization_id: orgId, created_by: userId, name: s.name.slice(0, 80), instructions: s.instructions.slice(0, 4000),
    description: s.description?.slice(0, 300) ?? null, slug: s.slug ?? null, agent_id: s.agentId ?? null, source: s.source ?? 'custom', enabled: true,
  });
  if (error) throw error;
}
export async function setSkillEnabled(id: string, enabled: boolean) {
  const { error } = await requireClient().from('skills').update({ enabled }).eq('id', id);
  if (error) throw error;
}
export async function deleteSkill(id: string) {
  const { error } = await requireClient().from('skills').delete().eq('id', id);
  if (error) throw error;
}

// ------------------------------------------------------------------ workflows
export type WorkflowTrigger = 'manual' | 'schedule' | 'webhook';
export interface WorkflowStep { id?: string; position: number; agent_id: string | null; action: string }
export interface WorkflowRow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: WorkflowTrigger;
  trigger_config: { cadence?: 'hourly' | 'daily' | 'weekly'; hour?: number; minute?: number; weekday?: number; tz?: string; input?: string } | null;
  next_run_at: string | null;
  created_at: string;
  workflow_steps?: WorkflowStep[];
}
export interface WorkflowRunRow {
  id: string;
  workflow_id: string;
  status: string;
  step: number;
  task_id: string | null;
  trigger: string;
  input: string | null;
  result: { summary?: string; error?: string; step?: number } | null;
  created_at: string;
  finished_at: string | null;
}

export async function listWorkflows(orgId: string): Promise<WorkflowRow[]> {
  const { data, error } = await requireClient().from('workflows')
    .select('id, name, description, enabled, trigger_type, trigger_config, next_run_at, created_at, workflow_steps(id, position, agent_id, action)')
    .eq('organization_id', orgId).order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as WorkflowRow[]).map(w => ({ ...w, workflow_steps: [...(w.workflow_steps ?? [])].sort((a, b) => a.position - b.position) }));
}
export async function listWorkflowRuns(orgId: string): Promise<WorkflowRunRow[]> {
  const { data, error } = await requireClient().from('workflow_runs')
    .select('id, workflow_id, status, step, task_id, trigger, input, result, created_at, finished_at')
    .eq('organization_id', orgId).order('created_at', { ascending: false }).limit(40);
  if (error) throw error;
  return (data ?? []) as WorkflowRunRow[];
}

/** The next time a schedule fires, in UTC, for a cadence at hour:minute of the given IANA time zone. */
export function nextRunAt(cfg: { cadence?: string; hour?: number; minute?: number; weekday?: number; tz?: string }, now = new Date()): string {
  const tz = cfg.tz || 'UTC';
  const hour = Math.min(23, Math.max(0, cfg.hour ?? 9));
  const minute = Math.min(59, Math.max(0, cfg.minute ?? 0));
  // Offset of the zone at a given instant, in minutes (zone time minus UTC).
  const offset = (d: Date) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(d).map(x => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(d.getTime() / 60_000) * 60_000) / 60_000;
  };
  if (cfg.cadence === 'hourly') {
    const at = new Date(now);
    at.setUTCSeconds(0, 0);
    at.setUTCMinutes(minute);
    if (at.getTime() <= now.getTime()) at.setUTCHours(at.getUTCHours() + 1);
    return at.toISOString();
  }
  for (let day = 0; day < 9; day++) {
    const local = new Date(now.getTime() + offset(now) * 60_000);
    const candidateLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + day, hour, minute);
    const at = new Date(candidateLocal - offset(new Date(candidateLocal)) * 60_000);
    const weekday = new Date(candidateLocal).getUTCDay();
    if (at.getTime() <= now.getTime()) continue;
    if (cfg.cadence === 'weekly' && weekday !== (cfg.weekday ?? 1)) continue;
    return at.toISOString();
  }
  return new Date(now.getTime() + 86_400_000).toISOString();
}

/** Saves a workflow and its steps (replacing the old steps). Returns the workflow id. */
export async function saveWorkflow(orgId: string, userId: string, w: { id?: string; name: string; description?: string; trigger_type: WorkflowTrigger; trigger_config: WorkflowRow['trigger_config']; enabled: boolean; steps: WorkflowStep[] }): Promise<string> {
  const db = requireClient();
  const row = {
    organization_id: orgId, name: w.name.slice(0, 120), description: w.description?.slice(0, 500) ?? null, enabled: w.enabled,
    trigger_type: w.trigger_type, trigger_config: w.trigger_config ?? {}, updated_at: new Date().toISOString(),
    next_run_at: w.trigger_type === 'schedule' && w.enabled ? nextRunAt(w.trigger_config ?? {}) : null,
  };
  let id = w.id;
  if (id) {
    const { error } = await db.from('workflows').update(row).eq('id', id);
    if (error) throw error;
    const { error: delError } = await db.from('workflow_steps').delete().eq('workflow_id', id);
    if (delError) throw delError;
  } else {
    const { data, error } = await db.from('workflows').insert({ ...row, created_by: userId }).select('id').single();
    if (error) throw error;
    id = (data as { id: string }).id;
  }
  const steps = w.steps.filter(s => s.action.trim() && s.agent_id).map((s, i) => ({ organization_id: orgId, workflow_id: id, position: i, agent_id: s.agent_id, action: s.action.slice(0, 3000) }));
  if (steps.length) {
    const { error } = await db.from('workflow_steps').insert(steps);
    if (error) throw error;
  }
  return id!;
}
export async function deleteWorkflow(id: string) {
  const { error } = await requireClient().from('workflows').delete().eq('id', id);
  if (error) throw error;
}
export const startWorkflow = (workflowId: string, input = '') => fn<{ run_id: string }>('workflow-runner', { action: 'start', workflow_id: workflowId, input });
export const workflowHook = (workflowId: string) => fn<{ url: string }>('workflow-runner', { action: 'set_hook', workflow_id: workflowId });

// ------------------------------------------------------------------ report feedback
export interface FeedbackRow { id: string; task_id: string; rating: number; note: string | null }
export async function myFeedback(taskId: string, userId: string): Promise<FeedbackRow | null> {
  const { data } = await requireClient().from('report_feedback').select('id, task_id, rating, note').eq('task_id', taskId).eq('user_id', userId).maybeSingle();
  return (data as FeedbackRow | null) ?? null;
}
/** One rating per person per report: a new click replaces the old one. */
export async function rateReport(orgId: string, userId: string, task: { id: string; agentId: string | null; model?: string | null }, rating: 1 | -1, note: string) {
  const db = requireClient();
  await db.from('report_feedback').delete().eq('task_id', task.id).eq('user_id', userId);
  const { error } = await db.from('report_feedback').insert({ organization_id: orgId, task_id: task.id, agent_id: task.agentId, user_id: userId, rating, note: note.trim().slice(0, 500) || null, model: task.model ?? null });
  if (error) throw error;
}

// ------------------------------------------------------------------ two-way chat channels
export const enableInbound = (integrationId: string, extra: Record<string, string> = {}) =>
  fn<{ ok: true; callback_url?: string; verify_token?: string }>('channel-inbound', { action: 'enable', integration_id: integrationId, ...extra });
export const disableInbound = (integrationId: string) => fn<{ ok: true }>('channel-inbound', { action: 'disable', integration_id: integrationId });
