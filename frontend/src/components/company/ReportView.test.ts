import { describe, expect, it } from 'vitest';
import { reportSources } from './ReportView';

describe('reportSources', () => {
  it('collects unique http(s) links and trims trailing punctuation', () => {
    expect(reportSources('See https://a.example/x. Also (https://b.example) and https://a.example/x, ftp://no')).toEqual(['https://a.example/x', 'https://b.example']);
  });
  it('caps the list', () => {
    expect(reportSources(Array.from({ length: 20 }, (_, i) => `https://s${i}.example`).join(' '))).toHaveLength(12);
  });
});
