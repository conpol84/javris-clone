// Reads the {summary, report, actions} JSON an agent is asked to return, even when the model wraps it in a code fence,
// puts code fences inside the report, or is cut off before the closing brace.

function decodeJsonString(raw: string): string {
  try { return JSON.parse(`"${raw}"`); } catch {
    // Cut off in the middle of an escape: keep the readable part.
    return raw.replace(/\\$/, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

/** The first complete {...} object, respecting strings; ignores anything after it (models often add a stray brace). */
function firstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
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

export function extractModelJson(text: string): Record<string, unknown> | null {
  const tries: string[] = [];
  const balanced = firstObject(text);
  if (balanced) tries.push(balanced);
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
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch { /* try the next candidate */ }
  }
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
