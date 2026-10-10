import { describe, expect, it } from 'vitest';
import { computerJobNeedsContinuation, formatComputerResult } from './computer-state';
import { computerManagerLabels } from './computer-manager-labels';

type CompletionJob = Parameters<typeof computerJobNeedsContinuation>[0];
const job = (
  kind: string, status: string, result: Record<string, unknown> | null
): CompletionJob => ({ kind, status, result });

describe('computer receipt delivery vs user goal completion', () => {
  it('shows needs continuation only for explicit incomplete advanced work', () => {
    expect(computerJobNeedsContinuation(job('desktop_task', 'done', {
      completed: false, summary: 'Screen locked; owner unlock required.',
    }))).toBe(true);
    expect(computerJobNeedsContinuation(job('browser_task', 'done', {
      completed: false, summary: 'Owner confirmation needed',
    }))).toBe(true);
  });

  it('never turns completed, unknown, or merely reported work into incomplete', () => {
    for (const result of [
      null, {}, { completed: true }, { completed: 'false' },
      { summary: 'Lock screen but completed flag was never reported' },
    ]) {
      expect(computerJobNeedsContinuation(job('desktop_task', 'done', result))).toBe(false);
    }
  });

  it('does not alter cancelled, error, queued or running jobs', () => {
    for (const status of ['cancelled', 'error', 'queued', 'running']) {
      expect(computerJobNeedsContinuation(job('desktop_task', status, {
        completed: false,
      }))).toBe(false);
    }
  });

  it('does not touch ordinary file, process, or open-browser receipt semantics', () => {
    for (const kind of ['list', 'read', 'write', 'exec', 'browser_open', 'shortcut', 'open_app']) {
      expect(computerJobNeedsContinuation(job(kind, 'done', {
        completed: false,
      }))).toBe(false);
    }
  });

  it('keeps the actual device summary in the existing result presentation', () => {
    const summary = 'Screen black with light-locker active. Need owner unlock session.';
    expect(formatComputerResult({
      kind: 'desktop_task', result: { completed: false, summary },
    })).toBe(summary);
  });

  it('all eight supported UI locales explain continuation truthfully', () => {
    const languages = ['en', 'el', 'es', 'pt-BR', 'de', 'fr', 'zh-CN', 'ar'] as const;
    for (const lang of languages) {
      const label = computerManagerLabels[lang].needsContinuation;
      expect(typeof label).toBe('string');
      expect(label.trim().length).toBeGreaterThan(4);
    }
    expect(computerManagerLabels.el.needsContinuation).toBe('Χρειάζεται συνέχεια');
    expect(computerManagerLabels.en.needsContinuation).toBe('Needs continuation');
  });
});
