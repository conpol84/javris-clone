import type { TaskResult } from './types';

// Same recovery as the server's _shared/model-json.ts: some older results were saved with the model's raw JSON
// as the summary (a code fence inside the report, or a reply cut off before the closing brace). Show them readably.
function decode(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replace(/\\$/, '').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

export function extractModelJson(text: string): Record<string, unknown> | null {
  const tries: string[] = [];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) tries.push(text.slice(first, last + 1));
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) {
    const f = fenced[1].indexOf('{');
    const l = fenced[1].lastIndexOf('}');
    if (f >= 0 && l > f) tries.push(fenced[1].slice(f, l + 1));
  }
  for (const candidate of tries) {
    try {
      const o: unknown = JSON.parse(candidate);
      if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      /* next candidate */
    }
  }
  const field = (name: string) => {
    const m = new RegExp(`"${name}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)`).exec(text);
    return m ? decode(m[1]) : undefined;
  };
  const summary = field('summary');
  const report = field('report');
  if (summary === undefined && report === undefined) return null;
  return { summary: summary ?? '', report: report ?? '' };
}

const looksLikeJson = (v: unknown): v is string => typeof v === 'string' && /^\s*(\{|```)/.test(v);

/** Returns the result with a readable summary and report when either was stored as raw model JSON. */
export function cleanTaskResult<T extends TaskResult | null | undefined>(result: T): T {
  if (!result || (!looksLikeJson(result.summary) && !looksLikeJson(result.report))) return result;
  const source = looksLikeJson(result.report) ? result.report : (result.summary as string);
  const o = extractModelJson(source) ?? (looksLikeJson(result.summary) ? extractModelJson(result.summary) : null);
  if (!o) return result;
  const summary = typeof o.summary === 'string' && o.summary.trim() ? o.summary : looksLikeJson(result.summary) ? '' : result.summary;
  const report = typeof o.report === 'string' && o.report.trim() ? o.report : looksLikeJson(result.report) ? '' : result.report;
  return { ...result, summary, report };
}
