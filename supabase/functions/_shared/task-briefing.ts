// Turns the results of finished tasks into a briefing an agent (usually the CEO) can read back to the owner.
// Pure functions: the caller loads the rows, this only shapes text. No secrets or user ids are put in the text.
import { extractModelJson } from './model-json.ts';

export interface BriefTask {
  title: string | null;
  status: string;
  assigned_agent_id: string | null;
  completed_at?: string | null;
  updated_at?: string | null;
  result: unknown;
}

interface Parts { summary: string; report: string; actions: string[]; error: string }

const FINISHED = new Set(['completed', 'awaiting_approval', 'blocked', 'failed']);
// Words that mean "task / report / result" in the 8 app languages (plus Greeklish), so "read me the last report" finds one.
const ASKS_FOR_RESULT = /task|report|result|finding|εργασ|αναφορ|αποτελεσ|ergasi|anafor|apotelesm|tarea|informe|resultado|tache|rapport|resultat|aufgabe|bericht|ergebnis|tarefa|relatorio|任务|报告|结果|مهمة|تقرير|نتيجة/;

const flat = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const clip = (v: unknown, n: number) => { const s = flat(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s: string) => new Set(fold(s).match(/[\p{L}\p{N}]{4,}/gu) ?? []);

function parseJson(text: string): Record<string, unknown> | null {
  const t = text.trim();
  return t.startsWith('{') || t.startsWith('```') ? extractModelJson(t) : null;
}

/** Reads summary, report, suggested actions and error from a task result, unwrapping a model reply that was saved as raw JSON. */
export function resultParts(result: unknown): Parts {
  let r: Record<string, unknown> = {};
  if (typeof result === 'string') r = parseJson(result) ?? { summary: result };
  else if (result && typeof result === 'object' && !Array.isArray(result)) r = result as Record<string, unknown>;
  let summary = typeof r.summary === 'string' ? r.summary : '';
  let report = typeof r.report === 'string' ? r.report : '';
  let actionsRaw: unknown = r.actions;
  const inner = parseJson(summary);
  if (inner) {
    summary = typeof inner.summary === 'string' ? inner.summary : '';
    if (!report && typeof inner.report === 'string') report = inner.report;
    if (!Array.isArray(actionsRaw) && Array.isArray(inner.actions)) actionsRaw = inner.actions;
  }
  const actions = (Array.isArray(actionsRaw) ? actionsRaw : [])
    .map(a => (typeof a === 'string' ? a : a && typeof a === 'object' ? (a as { action?: unknown }).action : ''))
    .filter((a): a is string => typeof a === 'string' && a.trim() !== '')
    .slice(0, 5);
  return { summary, report, actions, error: typeof r.error === 'string' ? r.error : '' };
}

const finished = (t: BriefTask) => {
  if (!FINISHED.has(t.status)) return false;
  const p = resultParts(t.result);
  return !!(p.summary || p.report || p.error);
};

/** The task the owner is asking about: best title match with their words, else the newest finished one if they ask for "a result". */
export function pickFocusTask(tasks: BriefTask[], userText: string): BriefTask | null {
  const done = tasks.filter(finished);
  if (done.length === 0) return null;
  const asked = words(userText);
  let best: BriefTask | null = null;
  let bestScore = 0;
  for (const t of done) {
    let score = 0;
    for (const w of words(t.title ?? '')) if (asked.has(w)) score++;
    if (score > bestScore) { best = t; bestScore = score; }
  }
  if (best) return best;
  return ASKS_FOR_RESULT.test(fold(userText)) ? done[0] : null;
}

/** A compact list of finished work plus the full report of the task in focus. Rows must be newest first. */
export function taskBriefing(tasks: BriefTask[], names: Map<string, string>, userText: string, opts: { items?: number; focusChars?: number } = {}): string {
  const done = tasks.filter(finished).slice(0, opts.items ?? 8);
  if (done.length === 0) return 'FINISHED TASKS: none yet.';
  const who = (t: BriefTask) => (t.assigned_agent_id ? names.get(t.assigned_agent_id) ?? 'an agent' : 'unassigned');
  const when = (t: BriefTask) => String(t.completed_at ?? t.updated_at ?? '').slice(0, 10);
  const state: Record<string, string> = { completed: 'done', awaiting_approval: 'done, waiting for your approval', blocked: 'needs more information', failed: 'failed' };
  const lines = done.map((t, i) => {
    const p = resultParts(t.result);
    const what = p.summary || p.report || p.error;
    return `${i + 1}. "${clip(t.title, 90)}" by ${who(t)}, ${state[t.status] ?? t.status}${when(t) ? ` ${when(t)}` : ''}: ${clip(what, 260)}`;
  });
  const out = ['FINISHED TASKS (newest first; this is your team\'s real work, read from it when asked and never invent results):', ...lines];
  const focus = pickFocusTask(done, userText);
  if (focus) {
    const p = resultParts(focus.result);
    out.push(
      '',
      `FULL RESULT of "${clip(focus.title, 90)}" by ${who(focus)} (${state[focus.status] ?? focus.status}):`,
      ...(p.summary ? [`Summary: ${clip(p.summary, 600)}`] : []),
      ...(p.report ? [`Report: ${clip(p.report, opts.focusChars ?? 3500)}`] : []),
      ...(p.error ? [`Problem: ${clip(p.error, 300)}`] : []),
      ...(p.actions.length ? [`Suggested next steps: ${p.actions.map(a => clip(a, 120)).join('; ')}`] : []),
    );
  }
  return out.join('\n');
}
