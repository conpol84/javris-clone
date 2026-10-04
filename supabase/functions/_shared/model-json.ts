// Reads the {summary, report, actions} JSON an agent is asked to return, even when the model wraps it in a code fence,
// puts code fences inside the report, or is cut off before the closing brace.

function decodeJsonString(raw: string): string {
  try { return JSON.parse(`"${raw}"`); } catch {
    // Cut off in the middle of an escape: keep the readable part.
    return raw.replace(/\\$/, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/** The complete {...} object that starts at `start`, respecting strings; ignores anything after it (models often add a stray brace). */
function objectAt(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

const hasAnswer = (o: Record<string, unknown>) => typeof o.report === 'string' || typeof o.summary === 'string';

export function extractModelJson(text: string): Record<string, unknown> | null {
  // Every complete top-level object; a model that thinks aloud first may mention other JSON before its answer.
  const objects: Record<string, unknown>[] = [];
  for (let start = text.indexOf('{'), seen = 0; start >= 0 && seen < 20; seen++) {
    const candidate = objectAt(text, start);
    if (!candidate) break;
    try {
      const o = JSON.parse(candidate);
      if (o && typeof o === 'object' && !Array.isArray(o)) objects.push(o as Record<string, unknown>);
    } catch { /* not JSON, keep looking */ }
    start = text.indexOf('{', start + candidate.length);
  }
  const answer = objects.find(hasAnswer);
  if (answer) return answer;
  const tries: string[] = [];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  // The widest {...} first: a fence inside the report must not cut the object short.
  if (first >= 0 && last > first) tries.push(text.slice(first, last + 1));
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const c = fenced[1];
    const f = c.indexOf('{');
    const l = c.lastIndexOf('}');
    if (f >= 0 && l > f) tries.push(c.slice(f, l + 1));
  }
  for (const candidate of tries) {
    try {
      const o = JSON.parse(candidate);
      if (o && typeof o === 'object' && !Array.isArray(o) && hasAnswer(o)) return o as Record<string, unknown>;
    } catch { /* try the next candidate */ }
  }
  if (objects.length) return objects[0];
  // Truncated or slightly broken JSON: recover the text fields one by one.
  const field = (name: string) => {
    const m = new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(text);
    return m ? decodeJsonString(m[1]) : undefined;
  };
  const summary = field('summary');
  const report = field('report');
  if (summary === undefined && report === undefined) return null;
  return { summary: summary ?? '', report: report ?? '' };
}
