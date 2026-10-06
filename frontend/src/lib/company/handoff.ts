// The CEO can put the owner through to the employee who did a piece of work. Its reply then ends with
// "[[ask:<agent id>]] <question>" (written by the server, never by the model); the app shows it as a button.
const MARK = /\n*\[\[ask:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]\s*([\s\S]*)$/i;

// The CEO can also give an employee a task ("[[task:<agent id>]] <title>\n<details>") or call a meeting
// ("[[meet:<id>,<id>]] <topic>"); both are written by the server and shown as buttons the owner presses.
const TASK = /\n*\[\[task:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]\s*([\s\S]*)$/i;
const MEET = /\n*\[\[meet:((?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12},?){0,5})\]\]\s*([\s\S]*)$/i;

export interface Handoff { agentId: string; question: string }
export interface TaskOffer { agentId: string; title: string; details: string }
export interface MeetingOffer { topic: string; participants: string[] }

/** The reply text to show and speak, and the hand-over, task and meeting the CEO offers (each at most once). */
export function parseHandoff(content: string): { text: string; ask: Handoff | null; task: TaskOffer | null; meet: MeetingOffer | null } {
  const out: { text: string; ask: Handoff | null; task: TaskOffer | null; meet: MeetingOffer | null } = { text: content, ask: null, task: null, meet: null };
  // Markers are the last paragraphs of the reply; peel them off from the end.
  for (let i = 0; i < 3; i++) {
    const m = MARK.exec(out.text);
    const t = TASK.exec(out.text);
    const g = MEET.exec(out.text);
    const last = [m, t, g].filter((x): x is RegExpExecArray => !!x).sort((a, b) => b.index - a.index)[0];
    if (!last) break;
    if (last === m && !out.ask) out.ask = { agentId: m[1].toLowerCase(), question: m[2].trim().slice(0, 400) };
    else if (last === t && !out.task) {
      const [title, ...rest] = t[2].trim().split('\n');
      out.task = { agentId: t[1].toLowerCase(), title: title.trim().slice(0, 160), details: rest.join('\n').trim().slice(0, 1500) };
    } else if (last === g && !out.meet) out.meet = { topic: g[2].trim().slice(0, 160), participants: g[1].split(',').filter(Boolean).map((x) => x.toLowerCase()) };
    out.text = out.text.slice(0, last.index).trimEnd();
  }
  return out;
}

/** Link that opens a meeting ready to start, with the topic and the employees the CEO proposed. */
export const meetingLink = (meet: MeetingOffer) => `/missions?${new URLSearchParams({ meet: meet.topic, ...(meet.participants.length ? { with: meet.participants.join(',') } : {}) })}`;

/** Link that opens the chat with that employee, the question ready to send. */
export const handoffLink = (ask: Handoff) => `/chat?${new URLSearchParams({ ask: ask.agentId, q: ask.question })}`;
