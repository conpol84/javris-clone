// The CEO can put the owner through to the employee who did a piece of work. Its reply then ends with
// "[[ask:<agent id>]] <question>" (written by the server, never by the model); the app shows it as a button.
const MARK = /\n*\[\[ask:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]\]\s*([\s\S]*)$/i;

export interface Handoff { agentId: string; question: string }

/** The reply text to show and speak, and the hand-over when there is one. */
export function parseHandoff(content: string): { text: string; ask: Handoff | null } {
  const m = MARK.exec(content);
  if (!m) return { text: content, ask: null };
  return { text: content.slice(0, m.index).trimEnd(), ask: { agentId: m[1].toLowerCase(), question: m[2].trim().slice(0, 400) } };
}

/** Link that opens the chat with that employee, the question ready to send. */
export const handoffLink = (ask: Handoff) => `/chat?${new URLSearchParams({ ask: ask.agentId, q: ask.question })}`;
