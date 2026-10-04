// Reads the {summary, report, actions} JSON an agent is asked to return, even when the model wraps it in a code fence,
// puts code fences inside the report, or is cut off before the closing brace.

function decodeJsonString(raw: string): string {
  try { return JSON.parse(`"${raw}"`); } catch {
    // Cut off in the middle of an escape: keep the readable part.
    return raw.replace(/\\$/, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export function extractModelJson(text: string): Record<string, unknown> | null {
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
