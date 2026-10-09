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
const ASKS_FOR_RESULT = /task|report|result|finding|did you|have you done|εκανε|ekane|βρηκε|vrike|hiciste|hizo|fizeste|fez|gemacht|fait|做了|فعلت|εργασ|αναφορ|αποτελεσ|ergasi|anafor|apotelesm|tarea|informe|resultado|tache|rapport|resultat|aufgabe|bericht|ergebnis|tarefa|relatorio|任务|报告|结果|مهمة|تقرير|نتيجة/;

const flat = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const clip = (v: unknown, n: number) => { const s = flat(v); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
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
      ...workLog(focus.result),
    );
  }
  return out.join('\n');
}

const STEP_WORDS: Record<string, string> = {
  web_search: 'searched the web for', read_page: 'read the page', memory_search: 'looked in company memory for', knowledge_search: 'searched company documents for',
  server_task: 'ran a job on the server:', calculator: 'calculated', weather: 'checked the weather for', exchange_rate: 'converted', analyze_image: 'looked at the image',
  generate_image: 'created an image of', think: 'planned:',
};

/** Curated integrations the CEO may suggest as read-only company work sources. */
export const WORK_SOURCE_APPS = [
  { kind: 'gdrive_read', name: 'Google Drive · read' },
  { kind: 'gmail_read', name: 'Gmail · read' },
  { kind: 'gcal_read', name: 'Google Calendar · read' },
  { kind: 'outlook_read', name: 'Outlook · read' },
  { kind: 'notion', name: 'Notion' },
  { kind: 'github', name: 'GitHub' },
] as const;
export interface WorkSourceApp { kind: string; name: string }

/** What the employee actually did on a task, step by step, from the saved result (newest runner only). */
export function workLog(result: unknown): string[] {
  const r = result && typeof result === 'object' && !Array.isArray(result) ? result as Record<string, unknown> : {};
  const steps = Array.isArray(r.steps) ? r.steps as { action?: unknown; input?: unknown; ok?: unknown; out?: unknown }[] : [];
  if (!steps.length) return [];
  return ['WORK LOG (the steps this employee really took, in order; use it to explain how the work was done):',
    ...steps.slice(0, 10).map((st, i) => `${i + 1}. ${STEP_WORDS[String(st.action)] ?? String(st.action)} "${clip(st.input, 140)}"${st.ok === false ? ' (failed)' : ''}${typeof st.out === 'string' && st.out ? ` -> found: ${clip(st.out, 220)}` : ''}`)];
}

/** Marker a CEO reply carries when it hands the owner over to an employee: "[[ask:<agent id>]] question". */
export const HANDOFF = /\[\[ask:([0-9a-f-]{36})\]\]\s*(.*)$/s;

/**
 * Turns the CEO's last line "ASK: <employee name> | <question>" into the stored marker, for an employee of this company only.
 * An unknown name (or the CEO itself) is dropped, so the owner never gets a button that leads nowhere.
 */
export function handoffFrom(reply: string, agents: { id: string; name: string }[], selfId: string): { text: string; agentId: string | null; question: string } {
  const m = /(?:^|\n)[ \t*_]*ASK:\s*([^|\n]{1,80}?)\s*\|\s*([^\n]{1,400})\s*$/i.exec(reply.trimEnd());
  if (!m) return { text: reply, agentId: null, question: '' };
  const text = reply.trimEnd().slice(0, m.index).trimEnd();
  const want = fold(m[1].replace(/[*_"«»]/g, '').trim());
  const agent = agents.find(a => a.id !== selfId && fold(a.name) === want) ?? agents.find(a => a.id !== selfId && (fold(a.name).includes(want) || want.includes(fold(a.name))) && want.length >= 3);
  const question = m[2].replace(/[*_]+$/g, '').trim();
  if (!agent || !question) return { text, agentId: null, question: '' };
  return { text: `${text}\n\n[[ask:${agent.id}]] ${question}`, agentId: agent.id, question };
}

/**
 * Turns the CEO's last line "MEETING: <topic> | <employee>, <employee>" into the stored marker
 * "[[meet:<id>,<id>]] <topic>", with this company's employees only (unknown names are dropped; none left: the CEO
 * invites people when the meeting starts). The app shows it as a button that opens the meeting ready to start.
 */
export function meetingFrom(reply: string, agents: { id: string; name: string }[], selfId: string): { text: string; topic: string; ids: string[] } {
  const m = /(?:^|\n)[ \t*_]*MEETING:\s*([^|\n]{3,160}?)\s*(?:\|\s*([^\n]{0,400}))?\s*$/i.exec(reply.trimEnd());
  if (!m) return { text: reply, topic: '', ids: [] };
  const text = reply.trimEnd().slice(0, m.index).trimEnd();
  const topic = m[1].replace(/[*_"«»\[\]]/g, '').trim();
  const ids: string[] = [];
  for (const raw of (m[2] ?? '').split(/[,;]| και | and /)) {
    const want = fold(raw.replace(/[*_"«»]/g, '').trim());
    if (want.length < 3) continue;
    const agent = agents.find(a => a.id !== selfId && fold(a.name) === want) ?? agents.find(a => a.id !== selfId && (fold(a.name).includes(want) || want.includes(fold(a.name))));
    if (agent && !ids.includes(agent.id) && ids.length < 5) ids.push(agent.id);
  }
  if (!topic) return { text, topic: '', ids: [] };
  return { text: `${text}\n\n[[meet:${ids.join(',')}]] ${topic}`, topic, ids };
}

/**
 * Turns the CEO's last line "TASK: <employee> | <title> | <what exactly to deliver>" into the stored marker
 * "[[task:<id>]] <title>\n<details>", for an employee of this company (never the CEO itself). The app shows it as a
 * button that gives the task to that employee; nothing starts until the owner presses it.
 */
export function taskFrom(reply: string, agents: { id: string; name: string }[], selfId: string): { text: string; agentId: string | null; title: string } {
  const m = /(?:^|\n)[ \t*_]*TASK:\s*([^|\n]{1,80}?)\s*\|\s*([^|\n]{3,140}?)\s*(?:\|\s*([^\n]{0,900}))?\s*$/i.exec(reply.trimEnd());
  if (!m) return { text: reply, agentId: null, title: '' };
  const text = reply.trimEnd().slice(0, m.index).trimEnd();
  const want = fold(m[1].replace(/[*_"«»]/g, '').trim());
  const agent = agents.find(a => a.id !== selfId && fold(a.name) === want) ?? agents.find(a => a.id !== selfId && (fold(a.name).includes(want) || want.includes(fold(a.name))) && want.length >= 3);
  const title = m[2].replace(/[*_"«»\[\]]/g, '').trim();
  if (!agent || !title) return { text, agentId: null, title: '' };
  const details = (m[3] ?? '').replace(/[*_]+$/g, '').trim();
  return { text: `${text}\n\n[[task:${agent.id}]] ${title}${details ? `\n${details}` : ''}`, agentId: agent.id, title };
}

/**
 * Turns "APP: <supported kind or name> | <why it helps>" into a setup marker. The caller passes only
 * work sources that are not already connected, so the CEO can neither invent a provider nor claim an
 * existing connection is missing. Opening setup never grants consent or connects an account.
 */
export function appFrom(reply: string, apps: WorkSourceApp[]): { text: string; kind: string | null; reason: string } {
  const m = /(?:^|\n)[ \t*_]*APP:\s*([^|\n]{2,80}?)\s*\|\s*([^\n]{3,300})\s*$/i.exec(reply.trimEnd());
  if (!m) return { text: reply, kind: null, reason: '' };
  const text = reply.trimEnd().slice(0, m.index).trimEnd();
  // Underscores are part of canonical kinds such as gdrive_read; only remove presentation markup.
  const want = fold(m[1].replace(/[*"«»]/g, '').trim());
  const app = apps.find(a => fold(a.kind) === want || fold(a.name) === want);
  const reason = m[2].replace(/[*_]+$/g, '').trim().slice(0, 240);
  if (!app || !reason || !/^[a-z][a-z0-9_]{1,31}$/.test(app.kind)) return { text, kind: null, reason: '' };
  return { text: `${text}\n\n[[app:${app.kind}]] ${reason}`, kind: app.kind, reason };
}

/**
 * All the action lines the CEO ended its reply with (ASK, TASK, MEETING and APP, in any order, up to four) as stored
 * markers after the text, one per paragraph. Lines naming no real employee are dropped.
 */
export function ceoActions(reply: string, agents: { id: string; name: string }[], selfId: string, apps: WorkSourceApp[] = []): string {
  let rest = reply.trimEnd();
  const marks: string[] = [];
  for (let round = 0; round < 4; round++) {
    let changed = false;
    for (const convert of [
      (value: string) => handoffFrom(value, agents, selfId),
      (value: string) => taskFrom(value, agents, selfId),
      (value: string) => meetingFrom(value, agents, selfId),
      (value: string) => appFrom(value, apps),
    ]) {
      const out = convert(rest).text;
      if (out === rest) continue;
      const at = out.search(/\n\n\[\[(?:ask|task|meet|app):/);
      if (at >= 0) { marks.unshift(out.slice(at + 2)); rest = out.slice(0, at).trimEnd(); }
      else rest = out.trimEnd();
      changed = true;
      break;
    }
    if (!changed) break;
  }
  return [rest, ...marks].join('\n\n');
}

/** The record of the task the owner is asking about (result + work log), to put right next to the question:
 * smaller models follow the latest user message far better than a long system prompt. Empty when no task matches. */
export function focusBriefing(tasks: BriefTask[], names: Map<string, string>, userText: string, chars = 2500): string {
  const brief = taskBriefing(tasks, names, userText, { focusChars: chars });
  const at = brief.indexOf('\nFULL RESULT of ');
  return at < 0 ? '' : brief.slice(at + 1);
}
