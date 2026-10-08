import { describe, expect, it } from 'vitest';
import { cleanTaskResult } from './taskResult';

describe('cleanTaskResult', () => {
  it('leaves a normal result alone', () => {
    const r = { summary: 'Done', report: 'Full text' };
    expect(cleanTaskResult(r)).toBe(r);
  });
  it('unwraps a summary and report saved as raw, cut-off JSON', () => {
    const raw = '{\n  "summary": "Need your competitor matrix",\n  "report": "Step 1: collect.\\nStep 2: comp';
    const r = cleanTaskResult({ summary: raw.slice(0, 200), report: raw });
    expect(r.summary).toBe('Need your competitor matrix');
    expect(r.report).toBe('Step 1: collect.\nStep 2: comp');
  });
  it('keeps a code fence that is inside the report', () => {
    const raw = '```json\n{"summary":"Plan","report":"Template:\\n```csv\\na,b\\n```","actions":[]}\n```';
    const r = cleanTaskResult({ summary: raw.slice(0, 200), report: raw });
    expect(r.summary).toBe('Plan');
    expect(r.report).toContain('```csv');
  });
  it('handles null', () => expect(cleanTaskResult(null)).toBeNull());
});
