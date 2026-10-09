// The CEO can put the owner through to the employee who did a piece of work. Its reply then ends with
// "[[ask:<agent id>]] <question>" (written by the server, never by the model); the app shows it as a button.
const MARK = /\n*\[\[ask:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]\s*([\s\S]*)$/i;

// The CEO can also give an employee a task ("[[task:<agent id>]] <title>\n<details>") or call a meeting
// ("[[meet:<id>,<id>]] <topic>"); both are written by the server and shown as buttons the owner presses.
const TASK = /\n*\[\[task:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]\s*([\s\S]*)$/i;
const MEET = /\n*\[\[meet:((?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},?){0,5})\]\]\s*([\s\S]*)$/i;
const APP = /\n*\[\[app:([a-z][a-z0-9_]{1,31})\]\]\s*([\s\S]*)$/i;

export const WORK_SOURCE_NAMES = {
  gdrive_read: 'Google Drive · read', gmail_read: 'Gmail · read', gcal_read: 'Google Calendar · read',
  outlook_read: 'Outlook · read', notion: 'Notion', github: 'GitHub',
} as const;
export type WorkSourceKind = keyof typeof WORK_SOURCE_NAMES;

export interface Handoff { agentId: string; question: string }
export interface TaskOffer { agentId: string; title: string; details: string }
export interface MeetingOffer { topic: string; participants: string[] }
export interface WorkSourceOffer { kind: WorkSourceKind; name: string; reason: string }

/** The reply text to show and speak, plus the hand-over, task, meeting and work-source setup the CEO offers. */
export function parseHandoff(content: string): { text: string; ask: Handoff | null; task: TaskOffer | null; meet: MeetingOffer | null; app: WorkSourceOffer | null } {
  const out: { text: string; ask: Handoff | null; task: TaskOffer | null; meet: MeetingOffer | null; app: WorkSourceOffer | null } = { text: content, ask: null, task: null, meet: null, app: null };
  // Markers are the last paragraphs of the reply; peel them off from the end.
  for (let i = 0; i < 4; i++) {
    const m = MARK.exec(out.text);
    const t = TASK.exec(out.text);
    const g = MEET.exec(out.text);
    const a = APP.exec(out.text);
    const last = [m, t, g, a].filter((x): x is RegExpExecArray => !!x).sort((left, right) => right.index - left.index)[0];
    if (!last) break;
    if (last === m && !out.ask) out.ask = { agentId: m[1].toLowerCase(), question: m[2].trim().slice(0, 400) };
    else if (last === t && !out.task) {
      const [title, ...rest] = t[2].trim().split('\n');
      out.task = { agentId: t[1].toLowerCase(), title: title.trim().slice(0, 160), details: rest.join('\n').trim().slice(0, 1500) };
    } else if (last === g && !out.meet) out.meet = { topic: g[2].trim().slice(0, 160), participants: g[1].split(',').filter(Boolean).map((x) => x.toLowerCase()) };
    else if (last === a && !out.app && a[1] in WORK_SOURCE_NAMES) {
      const kind = a[1] as WorkSourceKind;
      out.app = { kind, name: WORK_SOURCE_NAMES[kind], reason: a[2].trim().slice(0, 240) };
    }
    out.text = out.text.slice(0, last.index).trimEnd();
  }
  return out;
}

/** Link that opens a meeting ready to start, with the topic and the employees the CEO proposed. */
export const meetingLink = (meet: MeetingOffer) => `/missions?${new URLSearchParams({ meet: meet.topic, ...(meet.participants.length ? { with: meet.participants.join(',') } : {}) })}`;

/** Link that opens the chat with that employee, the question ready to send. */
export const handoffLink = (ask: Handoff) => `/chat?${new URLSearchParams({ ask: ask.agentId, q: ask.question })}`;

/** Opens the exact supported app setup. Consent still happens on the Integrations page. */
export const workSourceLink = (app: WorkSourceOffer) => `/integrations?${new URLSearchParams({ connect: app.kind })}`;
