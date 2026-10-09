import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { BrowserTaskComposer } from './BrowserTaskComposer';
import { LANGUAGES } from '../../i18n/core';
import { browserTaskLabels } from '../../lib/company/browser-task-labels';

describe('browser evidence controls', () => {
  it('offers accessibility and local screenshot steps in the task composer', () => {
    const html = renderToStaticMarkup(<BrowserTaskComposer disabled={false} onSubmit={vi.fn()} />);
    expect(html).toContain('Accessibility snapshot');
    expect(html).toContain('Save visible screenshot');
    expect(html).toContain('value="snapshot"');
    expect(html).toContain('value="screenshot"');
  });

  it('has both capture labels in all eight product languages', () => {
    for (const { code } of LANGUAGES) {
      const labels = browserTaskLabels(code);
      expect(labels.snapshot.trim(), code).not.toBe('');
      expect(labels.screenshot.trim(), code).not.toBe('');
    }
  });
});
