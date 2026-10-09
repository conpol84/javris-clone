import { describe, expect, it } from 'vitest';
import { reportSources } from './ReportView';
import { reportSpeechText } from './ReportSpeakButton';

describe('reportSources', () => {
  it('collects unique http(s) links and trims trailing punctuation', () => {
    expect(reportSources('See https://a.example/x. Also (https://b.example) and https://a.example/x, ftp://no')).toEqual(['https://a.example/x', 'https://b.example']);
  });
  it('caps the list', () => {
    expect(reportSources(Array.from({ length: 20 }, (_, i) => `https://s${i}.example`).join(' '))).toHaveLength(12);
  });
});


describe('reportSpeechText', () => {
  it('turns markdown reports into bounded readable speech without URLs or markdown marks', () => {
    const spoken = reportSpeechText('## Summary\n**Growth** was 18%. See https://example.com/x.\n- Next step');
    expect(spoken).toContain('Summary');
    expect(spoken).toContain('Growth was 18%.');
    expect(spoken).toContain('Next step');
    expect(spoken).not.toContain('https://');
    expect(spoken).not.toContain('**');
  });
});
